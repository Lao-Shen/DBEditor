import { Tag, Typography, theme } from "antd";
import type { DBSchema, TableStatus } from "../types";
import { formatNumber, formatSize } from "../util";

interface StatusBarProps {
  schema: DBSchema | null;
  status: TableStatus | null;
}

export function StatusBar({ schema, status }: StatusBarProps) {
  const { token } = theme.useToken();

  let text = "未打开数据库";
  if (schema) {
    text = `${schema.name} · ${formatSize(schema.size)}`;
  }

  return (
    <div
      className="app-status"
      style={{ borderTopColor: token.colorBorderSecondary, background: token.colorBgContainer }}
    >
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {text}
      </Typography.Text>

      {status && (
        <>
          <Tag style={{ marginInlineEnd: 0 }}>{status.table}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            第 {status.offset + 1}-{status.offset + status.rowCount} 条 / 共 {formatNumber(status.total)} 条
            {" · "}
            {Math.floor(status.offset / status.limit) + 1} 页
            {" · "}
            查询 {status.elapsedMs}ms
          </Typography.Text>
          {!status.hasRowId && (
            <Typography.Text type="warning" style={{ fontSize: 12 }}>
              该表无 rowid
            </Typography.Text>
          )}
        </>
      )}
    </div>
  );
}
