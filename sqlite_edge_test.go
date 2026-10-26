package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func openWith(t *testing.T, stmts ...string) (*DBService, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "edge.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("exec %q: %v", stmt, err)
		}
	}
	db.Close()

	svc := &DBService{}
	if _, err := svc.OpenDatabase(path); err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}
	return svc, path
}

// A column literally named "rowid" shadows SQLite's implicit rowid, so the
// service must fall back to another alias (oid / _rowid_).
func TestShadowedRowIDColumn(t *testing.T) {
	svc, _ := openWith(t,
		`CREATE TABLE shadowed (rowid TEXT, name TEXT)`,
		`INSERT INTO shadowed VALUES ('not-a-rowid', '张三')`,
		`INSERT INTO shadowed VALUES ('also-not', '李四')`,
	)
	defer svc.CloseDatabase()

	schema, err := svc.ListSchema()
	if err != nil {
		t.Fatalf("ListSchema: %v", err)
	}
	var obj ObjectInfo
	for _, tbl := range schema.Tables {
		if tbl.Name == "shadowed" {
			obj = tbl
		}
	}
	if !obj.HasRowID {
		t.Fatal("shadowed table still has an implicit rowid")
	}

	page, err := svc.GetTableRows("shadowed", QueryOptions{Limit: 10})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	if len(page.Rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(page.Rows))
	}
	if page.Rows[0].RowID != 1 || page.Rows[1].RowID != 2 {
		t.Fatalf("rowids = %d,%d, want 1,2", page.Rows[0].RowID, page.Rows[1].RowID)
	}
	if page.Rows[0].Cells[0].Preview != "not-a-rowid" {
		t.Errorf("rowid column value = %q, want not-a-rowid", page.Rows[0].Cells[0].Preview)
	}
	if page.Rows[0].Cells[1].Preview != "张三" {
		t.Errorf("name = %q, want 张三", page.Rows[0].Cells[1].Preview)
	}

	// Cell detail must resolve by the real rowid, not the shadowing column.
	value, err := svc.GetCellValue("shadowed", 2, "name")
	if err != nil {
		t.Fatalf("GetCellValue: %v", err)
	}
	if value.Text != "李四" {
		t.Errorf("name for rowid 2 = %q, want 李四", value.Text)
	}
}

func TestWeirdIdentifiers(t *testing.T) {
	svc, _ := openWith(t,
		`CREATE TABLE "my table" ("select" TEXT, "a""b" INTEGER, "空格 列" TEXT)`,
		`INSERT INTO "my table" VALUES ('kw', 42, '值')`,
	)
	defer svc.CloseDatabase()

	page, err := svc.GetTableRows("my table", QueryOptions{Sort: "select", Dir: "asc", Limit: 10})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	if len(page.Rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(page.Rows))
	}
	if page.Rows[0].Cells[1].Preview != "42" {
		t.Errorf("a\"b = %q, want 42", page.Rows[0].Cells[1].Preview)
	}
	value, err := svc.GetCellValue("my table", page.Rows[0].RowID, `a"b`)
	if err != nil {
		t.Fatalf("GetCellValue: %v", err)
	}
	if value.Text != "42" {
		t.Errorf("a\"b detail = %q, want 42", value.Text)
	}
}

func TestEmptyTable(t *testing.T) {
	svc, _ := openWith(t, `CREATE TABLE empty (id INTEGER PRIMARY KEY, v TEXT)`)
	defer svc.CloseDatabase()

	page, err := svc.GetTableRows("empty", QueryOptions{Limit: 10})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	if page.Total != 0 || len(page.Rows) != 0 {
		t.Errorf("empty table: total=%d rows=%d", page.Total, len(page.Rows))
	}
}

func TestOffsetBeyondTotal(t *testing.T) {
	svc, _ := openWith(t,
		`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`,
		`INSERT INTO t VALUES (1, 'a')`,
	)
	defer svc.CloseDatabase()

	page, err := svc.GetTableRows("t", QueryOptions{Limit: 10, Offset: 999})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	if len(page.Rows) != 0 {
		t.Errorf("rows = %d, want 0", len(page.Rows))
	}
	if page.Total != 1 {
		t.Errorf("total = %d, want 1", page.Total)
	}
}

func TestViewPagination(t *testing.T) {
	svc, _ := openWith(t,
		`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`,
		`INSERT INTO t VALUES (1,'a'),(2,'b'),(3,'c')`,
		`CREATE VIEW v_odd AS SELECT id, v FROM t WHERE id % 2 = 1`,
	)
	defer svc.CloseDatabase()

	page, err := svc.GetTableRows("v_odd", QueryOptions{Limit: 10})
	if err != nil {
		t.Fatalf("GetTableRows view: %v", err)
	}
	if page.Total != 2 || len(page.Rows) != 2 {
		t.Errorf("view total=%d rows=%d, want 2/2", page.Total, len(page.Rows))
	}
	if page.HasRowID {
		t.Error("view should not report rowid")
	}
}

func TestReopenDatabase(t *testing.T) {
	svc, path := openWith(t,
		`CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)`,
		`INSERT INTO t VALUES (1, 'a')`,
	)
	defer svc.CloseDatabase()

	// Re-opening must not deadlock or leak the previous connection.
	if _, err := svc.OpenDatabase(path); err != nil {
		t.Fatalf("reopen: %v", err)
	}
	if _, err := svc.GetTableRows("t", QueryOptions{Limit: 10}); err != nil {
		t.Fatalf("query after reopen: %v", err)
	}
}

func TestInvalidFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "not-a-db.txt")
	if err := os.WriteFile(path, []byte("this is not sqlite"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}

	svc := &DBService{}
	defer svc.CloseDatabase()
	if _, err := svc.OpenDatabase(path); err == nil {
		t.Fatal("opening a non-sqlite file should fail")
	}
}

// Sorting a WITHOUT ROWID table by a non-unique column must still paginate
// without dropping or repeating rows, using the primary key as tiebreaker.
func TestWithoutRowIDStableSort(t *testing.T) {
	svc, _ := openWith(t,
		`CREATE TABLE w (grp TEXT, name TEXT, PRIMARY KEY (grp, name)) WITHOUT ROWID`,
		`INSERT INTO w VALUES ('a','z'),('a','y'),('a','x'),('b','n'),('b','m')`,
	)
	defer svc.CloseDatabase()

	seen := map[string]bool{}
	for offset := 0; offset < 5; offset += 2 {
		page, err := svc.GetTableRows("w", QueryOptions{Sort: "grp", Dir: "asc", Limit: 2, Offset: offset})
		if err != nil {
			t.Fatalf("GetTableRows offset=%d: %v", offset, err)
		}
		for _, row := range page.Rows {
			name := row.Cells[1].Preview
			if seen[name] {
				t.Fatalf("duplicate row across pages: %s", name)
			}
			seen[name] = true
		}
	}
	if len(seen) != 5 {
		t.Fatalf("seen %d rows, want 5", len(seen))
	}
}

// REAL values must not be rendered in scientific notation for ordinary
// magnitudes (SQLite shows 1000000, not 1e+06).
func TestRealFormatting(t *testing.T) {
	svc, _ := openWith(t,
		`CREATE TABLE r (v REAL)`,
		`INSERT INTO r VALUES (1000000.0)`,
		`INSERT INTO r VALUES (1234567.5)`,
		`INSERT INTO r VALUES (0.1)`,
		`INSERT INTO r VALUES (-123456.75)`,
	)
	defer svc.CloseDatabase()

	page, err := svc.GetTableRows("r", QueryOptions{Limit: 10, Sort: "v", Dir: "asc"})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	want := []string{"-123456.75", "0.1", "1000000", "1234567.5"}
	for i, w := range want {
		if got := page.Rows[i].Cells[0].Preview; got != w {
			t.Errorf("row %d real = %q, want %q", i, got, w)
		}
	}
}
