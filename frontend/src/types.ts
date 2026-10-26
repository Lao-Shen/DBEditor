import type { Cell, ColumnInfo } from "../bindings/dbeditor";

/** Frontend view of a table/view with a guaranteed column list. */
export interface DBObject {
  name: string;
  type: string;
  sql: string;
  hasRowId: boolean;
  columns: ColumnInfo[];
}

/** Frontend view of the database schema with guaranteed arrays. */
export interface DBSchema {
  path: string;
  name: string;
  size: number;
  tables: DBObject[];
  views: DBObject[];
  indexes: DBObject[];
  triggers: DBObject[];
  openedAt: string;
}

export interface TableRow {
  rowId: number;
  cells: Cell[];
}

/** Frontend view of one page of rows with guaranteed arrays. */
export interface TablePage {
  columns: ColumnInfo[];
  rows: TableRow[];
  total: number;
  offset: number;
  limit: number;
  hasRowId: boolean;
  elapsedMs: number;
}

export interface CellSelection {
  table: string;
  rowId: number;
  hasRowId: boolean;
  column: string;
  columnType: string;
  cell: Cell;
}

export interface TableStatus {
  table: string;
  total: number;
  offset: number;
  limit: number;
  rowCount: number;
  elapsedMs: number;
  hasRowId: boolean;
}
