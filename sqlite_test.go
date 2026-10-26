package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func createTestDB(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer db.Close()

	stmts := []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT, note BLOB)`,
		`INSERT INTO users (name, email, note) VALUES ('张三', 'a@b.com', x'0102ff')`,
		`INSERT INTO users (name, email) VALUES ('李四', NULL)`,
		`INSERT INTO users (name, email) VALUES ('王五', 'c@d.com')`,
		`CREATE VIEW user_names AS SELECT name FROM users`,
		`CREATE INDEX idx_users_email ON users(email)`,
		`CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID`,
		`INSERT INTO kv VALUES ('a', '1'), ('b', '2')`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("exec %q: %v", stmt, err)
		}
	}
	return path
}

func TestOpenAndSchema(t *testing.T) {
	svc := &DBService{}
	defer svc.CloseDatabase()

	schema, err := svc.OpenDatabase(createTestDB(t))
	if err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}
	if schema.Name != "test.db" {
		t.Errorf("name = %q, want test.db", schema.Name)
	}
	if len(schema.Tables) != 2 {
		t.Fatalf("tables = %d, want 2", len(schema.Tables))
	}
	if len(schema.Views) != 1 {
		t.Errorf("views = %d, want 1", len(schema.Views))
	}
	if len(schema.Indexes) != 1 {
		t.Errorf("indexes = %d, want 1", len(schema.Indexes))
	}

	var users ObjectInfo
	for _, tbl := range schema.Tables {
		if tbl.Name == "users" {
			users = tbl
		}
	}
	if !users.HasRowID {
		t.Error("users should have rowid")
	}
	if len(users.Columns) != 4 {
		t.Fatalf("users columns = %d, want 4", len(users.Columns))
	}
	if users.Columns[0].PrimaryKey != 1 {
		t.Errorf("id should be PK, got pk=%d", users.Columns[0].PrimaryKey)
	}
	if !users.Columns[1].NotNull {
		t.Error("name should be NOT NULL")
	}
}

func TestGetTableRowsPagination(t *testing.T) {
	svc := &DBService{}
	defer svc.CloseDatabase()
	if _, err := svc.OpenDatabase(createTestDB(t)); err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}

	page, err := svc.GetTableRows("users", QueryOptions{Limit: 2, Offset: 0, Dir: "asc"})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	if page.Total != 3 {
		t.Errorf("total = %d, want 3", page.Total)
	}
	if len(page.Rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(page.Rows))
	}
	if !page.HasRowID {
		t.Error("expected HasRowID")
	}
	if page.Rows[0].RowID == 0 {
		t.Error("first row should have a rowid")
	}
	if page.Rows[0].Cells[1].Preview != "张三" {
		t.Errorf("first name = %q, want 张三", page.Rows[0].Cells[1].Preview)
	}
	// note column of row 1 is a blob.
	if page.Rows[0].Cells[3].Kind != "blob" {
		t.Errorf("note kind = %q, want blob", page.Rows[0].Cells[3].Kind)
	}
	// email of row 2 (李四) is NULL.
	if page.Rows[1].Cells[2].Kind != "null" {
		t.Errorf("email kind = %q, want null", page.Rows[1].Cells[2].Kind)
	}

	page2, err := svc.GetTableRows("users", QueryOptions{Limit: 2, Offset: 2, Dir: "asc"})
	if err != nil {
		t.Fatalf("GetTableRows page2: %v", err)
	}
	if len(page2.Rows) != 1 {
		t.Fatalf("page2 rows = %d, want 1", len(page2.Rows))
	}
}

func TestGetTableRowsSortDesc(t *testing.T) {
	svc := &DBService{}
	defer svc.CloseDatabase()
	if _, err := svc.OpenDatabase(createTestDB(t)); err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}
	page, err := svc.GetTableRows("users", QueryOptions{Sort: "id", Dir: "desc", Limit: 10, Offset: 0})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	if page.Rows[0].Cells[1].Preview != "王五" {
		t.Errorf("first row by id desc = %q, want 王五", page.Rows[0].Cells[1].Preview)
	}
}

func TestGetCellValue(t *testing.T) {
	svc := &DBService{}
	defer svc.CloseDatabase()
	if _, err := svc.OpenDatabase(createTestDB(t)); err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}
	page, err := svc.GetTableRows("users", QueryOptions{Limit: 1, Dir: "asc"})
	if err != nil {
		t.Fatalf("GetTableRows: %v", err)
	}
	rowID := page.Rows[0].RowID

	blob, err := svc.GetCellValue("users", rowID, "note")
	if err != nil {
		t.Fatalf("GetCellValue note: %v", err)
	}
	if blob.Kind != "blob" || blob.Hex != "0102ff" {
		t.Errorf("blob = %+v, want hex 0102ff", blob)
	}

	name, err := svc.GetCellValue("users", rowID, "name")
	if err != nil {
		t.Fatalf("GetCellValue name: %v", err)
	}
	if name.Kind != "text" || name.Text != "张三" {
		t.Errorf("name = %+v, want 张三", name)
	}

	if _, err := svc.GetCellValue("users", rowID, "does_not_exist"); err == nil {
		t.Error("expected error for unknown column")
	}
}

func TestWithoutRowIDTable(t *testing.T) {
	svc := &DBService{}
	defer svc.CloseDatabase()
	schema, err := svc.OpenDatabase(createTestDB(t))
	if err != nil {
		t.Fatalf("OpenDatabase: %v", err)
	}
	var kv ObjectInfo
	for _, tbl := range schema.Tables {
		if tbl.Name == "kv" {
			kv = tbl
		}
	}
	if kv.HasRowID {
		t.Error("kv should be WITHOUT ROWID")
	}
	page, err := svc.GetTableRows("kv", QueryOptions{Limit: 10})
	if err != nil {
		t.Fatalf("GetTableRows kv: %v", err)
	}
	if len(page.Rows) != 2 {
		t.Errorf("kv rows = %d, want 2", len(page.Rows))
	}
	if page.Rows[0].RowID != 0 {
		t.Errorf("kv rowid = %d, want 0", page.Rows[0].RowID)
	}
	if _, err := svc.GetCellValue("kv", 1, "v"); err == nil {
		t.Error("expected error for WITHOUT ROWID cell detail")
	}
}
