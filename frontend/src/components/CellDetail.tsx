import { useEffect, useState } from "react";
import { Alert, App as AntdApp, Button, Descriptions, Empty, Input, Spin, Tag, Typography, theme } from "antd";
import { CopyOutlined } from "@ant-design/icons";
import { Clipboard } from "@wailsio/runtime";
import type { CellValue } from "../../bindings/dbeditor";
import { getCellValue } from "../api";
import { errorMessage } from "../util";
import type { CellSelection } from "../types";

function formatHex(hex: string): string {
  const lines: string[] = [];
  for (let i = 0; i < hex.length; i += 32) {
    const chunk = hex.slice(i, i + 32);
    const bytes = chunk.match(/.{1,2}/g) ?? [];
    lines.push(`${(i / 2).toString(16).padStart(8, "0")}  ${bytes.join(" ")}`);
  }
  return lines.join("\n") || "(空)";
}

function kindLabel(kind: string): string {
  switch (kind) {
    case "null":
      return "NULL";
    case "integer":
      return "整数";
    case "real":
      return "实数";
    case "text":
      return "文本";
    case "blob":
      return "二进制";
    default:
      return kind;
  }
}

interface CellDetailProps {
  selection: CellSelection | null;
}

export function CellDetail({ selection }: CellDetailProps) {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const [value, setValue] = useState<CellValue | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selection) {
      setValue(null);
      setError(null);
      setLoading(false);
      return;
    }
    if (!selection.hasRowId) {
      const preview: CellValue = {
        kind: selection.cell.kind,
        text: selection.cell.preview,
        hex: "",
        length: selection.cell.length,
      };
      setValue(preview);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getCellValue(selection.table, selection.rowId, selection.column)
      .then((result) => {
        if (!cancelled) {
          setValue(result);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setValue(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  const copyText = value ? (value.kind === "blob" ? value.hex : value.text) : "";
  const canCopy = Boolean(selection && value && value.kind !== "null");

  const handleCopy = () => {
    void Clipboard.SetText(copyText).then(() => message.success("已复制到剪贴板"));
  };

  return (
    <div className="pane">
      <div className="pane-header">
        <Typography.Text strong style={{ fontSize: 13 }}>
          单元格详情
        </Typography.Text>
        <div style={{ flex: "1 1 auto" }} />
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined />}
          disabled={!canCopy}
          onClick={handleCopy}
        >
          复制
        </Button>
      </div>

      <div className="pane-scroll" style={{ padding: "0 12px 12px" }}>
        {!selection ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="点击单元格查看完整内容"
            style={{ marginTop: 48 }}
          />
        ) : (
          <>
            <Descriptions
              size="small"
              column={1}
              bordered
              items={[
                { key: "row", label: "行", children: selection.hasRowId ? String(selection.rowId) : "—" },
                { key: "column", label: "列", children: selection.column },
                { key: "type", label: "类型", children: selection.columnType || "—" },
                {
                  key: "kind",
                  label: "值类型",
                  children: <Tag style={{ marginInlineEnd: 0 }}>{kindLabel(value?.kind ?? selection.cell.kind)}</Tag>,
                },
                { key: "length", label: "长度", children: value ? String(value.length) : String(selection.cell.length) },
              ]}
            />

            <div style={{ marginTop: 12 }}>
              {loading ? (
                <div style={{ padding: 24, textAlign: "center" }}>
                  <Spin />
                </div>
              ) : error ? (
                <Alert type="error" showIcon message={error} />
              ) : value?.kind === "null" ? (
                <Tag color="default" style={{ fontSize: 13, padding: "4px 10px" }}>
                  NULL
                </Tag>
              ) : value?.kind === "blob" ? (
                <div
                  style={{
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: token.borderRadius,
                    padding: 8,
                    maxHeight: 420,
                    overflow: "auto",
                  }}
                >
                  <pre className="hex-view">{formatHex(value.hex)}</pre>
                </div>
              ) : (
                <Input.TextArea
                  readOnly
                  value={value?.text ?? ""}
                  autoSize={{ minRows: 4, maxRows: 18 }}
                  style={{ fontFamily: "ui-monospace, Consolas, monospace", fontSize: 12 }}
                />
              )}
            </div>

            {!selection.hasRowId && selection.cell.truncated ? (
              <Typography.Text type="warning" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                该对象没有 rowid，只能显示上面的预览内容（已截断）。
              </Typography.Text>
            ) : null}
            {value && value.kind === "blob" && value.hex.length < value.length * 2 ? (
              <Typography.Text type="warning" style={{ display: "block", marginTop: 6, fontSize: 12 }}>
                仅显示前 {Math.floor(value.hex.length / 2)} 字节（共 {value.length} 字节）。
              </Typography.Text>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
