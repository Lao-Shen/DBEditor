package main

import (
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const (
	defaultPageSize = 100
	maxPageSize     = 5000
	maxPreviewRunes = 200
	maxBlobHexBytes = 1 << 20 // 1 MiB
)

// ColumnInfo describes a single column of a table or view.
type ColumnInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	NotNull    bool   `json:"notNull"`
	Default    string `json:"default"`
	HasDefault bool   `json:"hasDefault"`
	PrimaryKey int    `json:"primaryKey"` // 1-based position within the PK, 0 if not part of it
}

// ObjectInfo describes a table, view, index or trigger.
type ObjectInfo struct {
	Name     string       `json:"name"`
	Type     string       `json:"type"` // table | view | index | trigger
	Sql      string       `json:"sql"`
	HasRowID bool         `json:"hasRowId"`
	Columns  []ColumnInfo `json:"columns"`

	// rowIDAlias is the usable implicit-rowid alias for this table. It is not
	// serialized; it exists because a user column named "rowid" (or "oid" /
	// "_rowid_") shadows the built-in one.
	rowIDAlias string
}

// Schema is a snapshot of the opened database structure.
type Schema struct {
	Path      string       `json:"path"`
	Name      string       `json:"name"`
	Size      int64        `json:"size"`
	Tables    []ObjectInfo `json:"tables"`
	Views     []ObjectInfo `json:"views"`
	Indexes   []ObjectInfo `json:"indexes"`
	Triggers  []ObjectInfo `json:"triggers"`
	OpenedAt  string       `json:"openedAt"`
}

// Cell is a lightweight representation of a grid cell (preview only).
type Cell struct {
	Kind      string `json:"kind"` // null | integer | real | text | blob
	Preview   string `json:"preview"`
	Length    int    `json:"length"`
	Truncated bool   `json:"truncated"`
}

// Row is a single row in a page result.
type Row struct {
	RowID int64  `json:"rowId"` // 0 when the table has no rowid
	Cells []Cell `json:"cells"`
}

// QueryOptions controls sorting and pagination for a page request.
type QueryOptions struct {
	Sort   string `json:"sort"`
	Dir    string `json:"dir"` // asc | desc
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}

// PageResult is one page of table data.
type PageResult struct {
	Columns   []ColumnInfo `json:"columns"`
	Rows      []Row        `json:"rows"`
	Total     int64        `json:"total"`
	Offset    int          `json:"offset"`
	Limit     int          `json:"limit"`
	HasRowID  bool         `json:"hasRowId"`
	ElapsedMs int64        `json:"elapsedMs"`
}

// CellValue is the full value of a single cell.
type CellValue struct {
	Kind   string `json:"kind"` // null | integer | real | text | blob
	Text   string `json:"text"`
	Hex    string `json:"hex"`
	Length int    `json:"length"`
}

// DBService is the Wails-bound service that exposes an open SQLite database.
type DBService struct {
	mu     sync.Mutex
	db     *sql.DB
	path   string
	schema *Schema
}

// OpenDatabase opens a SQLite file read-only and returns its schema.
func (s *DBService) OpenDatabase(path string) (*Schema, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("无法打开文件: %w", err)
	}
	if info.IsDir() {
		return nil, errors.New("所选路径是一个目录")
	}

	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	// Keep a small pool; a single connection is plenty for a local viewer.
	db.SetMaxOpenConns(1)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("不是有效的 SQLite 文件: %w", err)
	}
	// Enforce read-only at the SQLite level so the file is never modified.
	if _, err := db.Exec("PRAGMA query_only = ON"); err != nil {
		db.Close()
		return nil, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		s.db.Close()
	}
	s.db = db
	s.path = path

	schema, err := s.loadSchemaLocked()
	if err != nil {
		db.Close()
		s.db = nil
		s.schema = nil
		s.path = ""
		return nil, err
	}
	s.schema = schema
	return schema, nil
}

// ListSchema re-reads the schema of the currently open database.
func (s *DBService) ListSchema() (*Schema, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, errors.New("尚未打开数据库")
	}
	schema, err := s.loadSchemaLocked()
	if err != nil {
		return nil, err
	}
	s.schema = schema
	return schema, nil
}

// CloseDatabase closes the currently open database.
func (s *DBService) CloseDatabase() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db != nil {
		err := s.db.Close()
		s.db = nil
		s.schema = nil
		s.path = ""
		return err
	}
	return nil
}

func (s *DBService) loadSchemaLocked() (*Schema, error) {
	// The connection pool is capped at one connection, so collect all object
	// rows up front and close the result set before issuing the per-object
	// PRAGMA queries below (nested queries while iterating would deadlock).
	type rawObject struct {
		name string
		typ  string
		sql  string
	}
	var raw []rawObject

	rows, err := s.db.Query(
		`SELECT name, type, COALESCE(sql, '') FROM sqlite_master ` +
			`WHERE type IN ('table','view','index','trigger') ` +
			`AND name NOT LIKE 'sqlite_%' ORDER BY type, name`)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var obj rawObject
		if err := rows.Scan(&obj.name, &obj.typ, &obj.sql); err != nil {
			rows.Close()
			return nil, err
		}
		raw = append(raw, obj)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	schema := &Schema{
		Path:     s.path,
		Name:     baseName(s.path),
		Size:     fileSize(s.path),
		OpenedAt: time.Now().Format(time.RFC3339),
	}

	for _, r := range raw {
		obj := ObjectInfo{Name: r.name, Type: r.typ, Sql: r.sql}
		if r.typ == "table" || r.typ == "view" {
			cols, err := s.loadColumns(r.name)
			if err != nil {
				return nil, err
			}
			obj.Columns = cols
			if r.typ == "table" {
				obj.rowIDAlias = s.detectRowIDAlias(r.name, cols)
				obj.HasRowID = obj.rowIDAlias != ""
			}
		}
		switch r.typ {
		case "table":
			schema.Tables = append(schema.Tables, obj)
		case "view":
			schema.Views = append(schema.Views, obj)
		case "index":
			schema.Indexes = append(schema.Indexes, obj)
		case "trigger":
			schema.Triggers = append(schema.Triggers, obj)
		}
	}
	return schema, nil
}

func (s *DBService) loadColumns(table string) ([]ColumnInfo, error) {
	rows, err := s.db.Query("PRAGMA table_info(" + quoteIdent(table) + ")")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cols []ColumnInfo
	for rows.Next() {
		var cid, notNull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notNull, &dflt, &pk); err != nil {
			return nil, err
		}
		cols = append(cols, ColumnInfo{
			Name:       name,
			Type:       ctype,
			NotNull:    notNull == 1,
			Default:    dflt.String,
			HasDefault: dflt.Valid,
			PrimaryKey: pk,
		})
	}
	return cols, rows.Err()
}

// detectRowIDAlias returns an implicit-rowid alias ("rowid", "oid" or
// "_rowid_") that is not shadowed by one of the table's own columns and that
// the SQLite engine accepts. It returns "" when the table has no usable rowid
// (for example a WITHOUT ROWID table, or one whose columns shadow every alias).
func (s *DBService) detectRowIDAlias(table string, cols []ColumnInfo) string {
	shadowed := make(map[string]bool, len(cols))
	for _, c := range cols {
		shadowed[strings.ToLower(c.Name)] = true
	}
	for _, alias := range []string{"rowid", "oid", "_rowid_"} {
		if shadowed[alias] {
			continue
		}
		rows, err := s.db.Query("SELECT " + alias + " FROM " + quoteIdent(table) + " LIMIT 0")
		if err != nil {
			return ""
		}
		rows.Close()
		if rows.Err() != nil {
			return ""
		}
		return alias
	}
	return ""
}

// GetTableRows returns a page of rows for the given table.
func (s *DBService) GetTableRows(table string, opts QueryOptions) (*PageResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, errors.New("尚未打开数据库")
	}
	obj, ok := s.findObjectLocked(table)
	if !ok {
		return nil, fmt.Errorf("表不存在: %s", table)
	}

	start := time.Now()
	limit := opts.Limit
	if limit <= 0 {
		limit = defaultPageSize
	}
	if limit > maxPageSize {
		limit = maxPageSize
	}
	offset := opts.Offset
	if offset < 0 {
		offset = 0
	}

	// COUNT(*) gives the exact total for the pagination control.
	var total int64
	if err := s.db.QueryRow("SELECT COUNT(*) FROM " + quoteIdent(obj.Name)).Scan(&total); err != nil {
		return nil, err
	}

	selectParts := make([]string, 0, len(obj.Columns)+1)
	if obj.HasRowID {
		selectParts = append(selectParts, obj.rowIDAlias)
	}
	for _, c := range obj.Columns {
		selectParts = append(selectParts, quoteIdent(c.Name))
	}

	query := "SELECT " + strings.Join(selectParts, ", ") + " FROM " + quoteIdent(obj.Name)
	query += s.orderClause(obj, opts)
	query += " LIMIT ? OFFSET ?"

	rows, err := s.db.Query(query, limit, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := &PageResult{
		Columns:  obj.Columns,
		Total:    total,
		Offset:   offset,
		Limit:    limit,
		HasRowID: obj.HasRowID,
		Rows:     []Row{},
	}

	for rows.Next() {
		dest := make([]any, len(selectParts))
		ptrs := make([]any, len(dest))
		for i := range dest {
			ptrs[i] = &dest[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}

		var row Row
		cellStart := 0
		if obj.HasRowID {
			if id, ok := dest[0].(int64); ok {
				row.RowID = id
			}
			cellStart = 1
		}
		row.Cells = make([]Cell, 0, len(obj.Columns))
		for i := range obj.Columns {
			row.Cells = append(row.Cells, makeCell(dest[cellStart+i]))
		}
		result.Rows = append(result.Rows, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	result.ElapsedMs = time.Since(start).Milliseconds()
	return result, nil
}

func (s *DBService) orderClause(obj ObjectInfo, opts QueryOptions) string {
	tiebreak := strings.Join(keyColumns(obj), " ASC, ")
	if tiebreak != "" {
		tiebreak += " ASC"
	}

	if opts.Sort != "" && s.isValidColumn(obj, opts.Sort) {
		dir := "ASC"
		if strings.EqualFold(opts.Dir, "desc") {
			dir = "DESC"
		}
		// Always append a stable tiebreaker so pagination cannot drop or
		// duplicate rows when the sort column has repeated values.
		clause := " ORDER BY " + quoteIdent(opts.Sort) + " " + dir
		if tiebreak != "" {
			clause += ", " + tiebreak
		}
		return clause
	}

	if tiebreak != "" {
		return " ORDER BY " + tiebreak
	}
	return ""
}

// keyColumns returns the columns that uniquely order rows: the implicit rowid
// when available, otherwise the primary key columns (WITHOUT ROWID tables have
// a mandatory primary key).
func keyColumns(obj ObjectInfo) []string {
	if obj.HasRowID {
		return []string{obj.rowIDAlias}
	}

	type pk struct {
		pos  int
		name string
	}
	var keys []pk
	for _, c := range obj.Columns {
		if c.PrimaryKey > 0 {
			keys = append(keys, pk{c.PrimaryKey, c.Name})
		}
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i].pos < keys[j].pos })

	names := make([]string, 0, len(keys))
	for _, k := range keys {
		names = append(names, quoteIdent(k.name))
	}
	return names
}

// GetCellValue returns the full content of one cell, identified by rowid.
func (s *DBService) GetCellValue(table string, rowID int64, column string) (*CellValue, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil, errors.New("尚未打开数据库")
	}
	obj, ok := s.findObjectLocked(table)
	if !ok {
		return nil, fmt.Errorf("表不存在: %s", table)
	}
	if !s.isValidColumn(obj, column) {
		return nil, fmt.Errorf("列不存在: %s", column)
	}
	if !obj.HasRowID {
		return nil, errors.New("该表没有 rowid，暂不支持查看完整单元格")
	}

	query := "SELECT " + quoteIdent(column) + " FROM " + quoteIdent(obj.Name) + " WHERE " + obj.rowIDAlias + " = ?"
	var raw any
	if err := s.db.QueryRow(query, rowID).Scan(&raw); err != nil {
		return nil, err
	}
	return makeCellValue(raw), nil
}

func (s *DBService) findObjectLocked(name string) (ObjectInfo, bool) {
	if s.schema == nil {
		return ObjectInfo{}, false
	}
	for _, list := range [][]ObjectInfo{s.schema.Tables, s.schema.Views} {
		for _, o := range list {
			if o.Name == name {
				return o, true
			}
		}
	}
	return ObjectInfo{}, false
}

func (s *DBService) isValidColumn(obj ObjectInfo, name string) bool {
	for _, c := range obj.Columns {
		if c.Name == name {
			return true
		}
	}
	return false
}

func makeCell(v any) Cell {
	kind, preview, length := describeValue(v)
	truncated := false
	if kind == "text" && utf8.RuneCountInString(preview) > maxPreviewRunes {
		preview = string([]rune(preview)[:maxPreviewRunes])
		truncated = true
	}
	if kind == "blob" {
		// Blob previews are always abbreviated; full content lives in the detail pane.
		truncated = length > 0
	}
	return Cell{Kind: kind, Preview: preview, Length: length, Truncated: truncated}
}

func makeCellValue(v any) *CellValue {
	kind, text, length := describeValue(v)
	cv := &CellValue{Kind: kind, Length: length}
	switch kind {
	case "blob":
		b := toBytes(v)
		if len(b) > maxBlobHexBytes {
			b = b[:maxBlobHexBytes]
		}
		cv.Hex = hex.EncodeToString(b)
	case "null":
		// nothing
	default:
		cv.Text = text
	}
	return cv
}

func describeValue(v any) (kind, text string, length int) {
	switch t := v.(type) {
	case nil:
		return "null", "", 0
	case int64:
		s := fmt.Sprintf("%d", t)
		return "integer", s, len(s)
	case float64:
		// Match SQLite's own "%.15g" text rendering instead of Go's %g, which
		// switches to scientific notation far too eagerly (1000000 -> 1e+06).
		s := strconv.FormatFloat(t, 'g', 15, 64)
		return "real", s, len(s)
	case bool:
		if t {
			return "integer", "1", 1
		}
		return "integer", "0", 1
	case []byte:
		return "blob", fmt.Sprintf("<BLOB %d bytes>", len(t)), len(t)
	case string:
		return "text", t, utf8.RuneCountInString(t)
	case time.Time:
		s := t.Format(time.RFC3339)
		return "text", s, len(s)
	default:
		s := fmt.Sprintf("%v", t)
		return "text", s, len(s)
	}
}

func toBytes(v any) []byte {
	switch t := v.(type) {
	case []byte:
		return t
	case string:
		return []byte(t)
	default:
		return []byte(fmt.Sprintf("%v", t))
	}
}

func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

func baseName(path string) string {
	path = strings.ReplaceAll(path, "\\", "/")
	if i := strings.LastIndex(path, "/"); i >= 0 {
		return path[i+1:]
	}
	return path
}

func fileSize(path string) int64 {
	if info, err := os.Stat(path); err == nil {
		return info.Size()
	}
	return 0
}
