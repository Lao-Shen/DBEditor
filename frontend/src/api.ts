import { DBService } from "../bindings/dbeditor";
import type { CellValue, ObjectInfo, PageResult, QueryOptions, Schema } from "../bindings/dbeditor";
import type { DBObject, DBSchema, TablePage } from "./types";

function normalizeObject(object: ObjectInfo): DBObject {
  return {
    name: object.name,
    type: object.type,
    sql: object.sql,
    hasRowId: object.hasRowId,
    columns: object.columns ?? [],
  };
}

function normalizeSchema(schema: Schema): DBSchema {
  return {
    path: schema.path,
    name: schema.name,
    size: schema.size,
    openedAt: schema.openedAt,
    tables: (schema.tables ?? []).map(normalizeObject),
    views: (schema.views ?? []).map(normalizeObject),
    indexes: (schema.indexes ?? []).map(normalizeObject),
    triggers: (schema.triggers ?? []).map(normalizeObject),
  };
}

function normalizePage(page: PageResult): TablePage {
  return {
    columns: page.columns ?? [],
    rows: (page.rows ?? []).map((row) => ({ rowId: row.rowId, cells: row.cells ?? [] })),
    total: page.total,
    offset: page.offset,
    limit: page.limit,
    hasRowId: page.hasRowId,
    elapsedMs: page.elapsedMs,
  };
}

export async function openDatabase(path: string): Promise<DBSchema> {
  const schema = await DBService.OpenDatabase(path);
  if (!schema) {
    throw new Error("打开数据库失败");
  }
  return normalizeSchema(schema);
}

export async function listSchema(): Promise<DBSchema> {
  const schema = await DBService.ListSchema();
  if (!schema) {
    throw new Error("读取结构失败");
  }
  return normalizeSchema(schema);
}

export async function getTableRows(table: string, opts: QueryOptions): Promise<TablePage> {
  const page = await DBService.GetTableRows(table, opts);
  if (!page) {
    throw new Error("查询失败");
  }
  return normalizePage(page);
}

export async function getCellValue(table: string, rowID: number, column: string): Promise<CellValue> {
  const value = await DBService.GetCellValue(table, rowID, column);
  if (!value) {
    throw new Error("无法读取单元格");
  }
  return value;
}

export function closeDatabase(): Promise<void> {
  return DBService.CloseDatabase();
}
