import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Alert, Button, Flex, Input, Pagination, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import type { TableProps } from "antd";
import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import type { Cell } from "../../bindings/dbeditor";
import { getTableRows } from "../api";
import { errorMessage, isNumericType } from "../util";
import { useDebouncedValue, useSize } from "../hooks";
import type { CellSelection, DBObject, TablePage, TableRow, TableStatus } from "../types";

interface TableViewProps {
  object: DBObject;
  onSelectCell: (selection: CellSelection) => void;
  onClearSelection: (table: string) => void;
  onStatus: (status: TableStatus) => void;
}

interface GridRow {
  row: TableRow;
  index: number;
}

type Columns = NonNullable<TableProps<GridRow>["columns"]>;

/** Used before a real data row has been rendered and measured. */
const FALLBACK_ROW_HEIGHT = 39;
/** Never ask for less than one row, and stay bounded on very tall screens. */
const MIN_AUTO_ROWS = 1;
const MAX_AUTO_ROWS = 500;
/** Wait this long after a resize before recomputing the page size. */
const RESIZE_DEBOUNCE_MS = 80;
/** Slack for the table's own borders so no vertical scrollbar appears. */
const BORDER_SLACK = 4;

/** Geometry measured from the rendered grid, so a page can be sized to fit. */
interface GridMetrics {
  headerHeight: number;
  rowHeight: number;
  horizontalScrollbar: number;
}

const EMPTY_METRICS: GridMetrics = {
  headerHeight: 0,
  rowHeight: FALLBACK_ROW_HEIGHT,
  horizontalScrollbar: 0,
};

function renderCell(cell: Cell | undefined) {
  if (!cell) {
    return null;
  }
  if (cell.kind === "null") {
    return <span className="cell-null">NULL</span>;
  }
  if (cell.kind === "blob") {
    return <span className="cell-blob">{cell.preview}</span>;
  }
  return <span className="cell-text">{cell.preview}</span>;
}

export function TableView({ object, onSelectCell, onClearSelection, onStatus }: TableViewProps) {
  const { token } = theme.useToken();
  const { ref: wrapRef, size } = useSize<HTMLDivElement>();

  // Debounced viewport height: dragging the splitter / resizing the window must
  // not fire a request for every intermediate pixel.
  const viewportHeight = useDebouncedValue(size.height, RESIZE_DEBOUNCE_MS);

  // `offset` is the anchor: the index of the first row we want on screen. It is
  // kept across viewport resizes, so growing/shrinking the window does not throw
  // the user back to the first page.
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState("");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [data, setData] = useState<TablePage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ index: number; colIndex: number } | null>(null);
  const [filterText, setFilterText] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [metrics, setMetrics] = useState<GridMetrics>(EMPTY_METRICS);

  const onSelectRef = useRef(onSelectCell);
  const onClearRef = useRef(onClearSelection);
  const onStatusRef = useRef(onStatus);
  const pending = useRef<{ index: number; colIndex: number } | null>(null);

  useEffect(() => {
    onSelectRef.current = onSelectCell;
  }, [onSelectCell]);
  useEffect(() => {
    onClearRef.current = onClearSelection;
  }, [onClearSelection]);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  // Reset the anchor whenever we switch to a different table.
  useEffect(() => {
    setOffset(0);
    setSel(null);
    pending.current = null;
  }, [object.name]);

  // ---- viewport-derived page size -----------------------------------------
  // Fill the visible area with as many whole rows as fit, so the grid itself
  // never needs to scroll vertically: the pagination control does the
  // navigation instead.
  const rowHeight = metrics.rowHeight > 0 ? metrics.rowHeight : FALLBACK_ROW_HEIGHT;
  const availableBody = Math.max(
    viewportHeight - metrics.headerHeight - metrics.horizontalScrollbar - BORDER_SLACK,
    0,
  );
  const pageSize =
    viewportHeight > 0
      ? Math.min(Math.max(Math.floor(availableBody / rowHeight), MIN_AUTO_ROWS), MAX_AUTO_ROWS)
      : 0;
  // antd measures the body box including the horizontal scrollbar, so add it
  // back (plus a little slack for the table borders) to get exactly `pageSize`
  // visible rows and no vertical scrollbar.
  const scrollY = pageSize > 0 ? pageSize * rowHeight + metrics.horizontalScrollbar + BORDER_SLACK : undefined;

  const page = pageSize > 0 ? Math.floor(offset / pageSize) + 1 : 1;
  const alignedOffset = pageSize > 0 ? (page - 1) * pageSize : 0;
  const ready = pageSize > 0 && metrics.headerHeight > 0;

  // Measure the real header/row/scrollbar sizes after every render. State only
  // changes when a measurement actually differs, so this settles immediately.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) {
      return;
    }
    const header =
      el.querySelector<HTMLElement>(".ant-table-header") ?? el.querySelector<HTMLElement>(".ant-table-thead");
    const row = el.querySelector<HTMLElement>(".ant-table-tbody tr.ant-table-row");
    const body = el.querySelector<HTMLElement>(".ant-table-body");
    const next: GridMetrics = {
      headerHeight: header?.offsetHeight ?? 0,
      rowHeight: row?.offsetHeight ?? FALLBACK_ROW_HEIGHT,
      horizontalScrollbar: body ? Math.max(body.offsetHeight - body.clientHeight, 0) : 0,
    };
    setMetrics((prev) =>
      prev.headerHeight === next.headerHeight &&
      prev.rowHeight === next.rowHeight &&
      prev.horizontalScrollbar === next.horizontalScrollbar
        ? prev
        : next,
    );
  });

  const applySelection = (result: TablePage, index: number, colIndex: number) => {
    const column = result.columns[colIndex];
    const row = result.rows[index];
    if (!column || !row) {
      return;
    }
    setSel({ index, colIndex });
    onSelectRef.current({
      table: object.name,
      rowId: row.rowId,
      hasRowId: result.hasRowId,
      column: column.name,
      columnType: column.type,
      cell: row.cells[colIndex],
    });
  };

  useEffect(() => {
    if (!ready) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    getTableRows(object.name, { sort, dir, limit: pageSize, offset: alignedOffset })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setData(result);
        onStatusRef.current({
          table: object.name,
          total: result.total,
          offset: result.offset,
          limit: result.limit,
          rowCount: result.rows.length,
          elapsedMs: result.elapsedMs,
          hasRowId: result.hasRowId,
        });
        const p = pending.current;
        if (p && result.rows.length) {
          pending.current = null;
          const index = Math.min(Math.max(p.index, 0), result.rows.length - 1);
          const colIndex = Math.min(Math.max(p.colIndex, 0), Math.max(result.columns.length - 1, 0));
          applySelection(result, index, colIndex);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(errorMessage(e));
          setData(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, object.name, pageSize, alignedOffset, sort, dir, reloadToken]);

  // If the row count shrank (refresh, filter, schema change) pull the anchor back
  // into range instead of showing an empty page.
  useEffect(() => {
    if (!data || pageSize <= 0) {
      return;
    }
    const maxPage = Math.max(1, Math.ceil(data.total / pageSize));
    if (page > maxPage) {
      setOffset((maxPage - 1) * pageSize);
    }
  }, [data, page, pageSize]);

  const visible = useMemo<GridRow[]>(() => {
    const rows = data?.rows ?? [];
    const mapped = rows.map((row, index) => ({ row, index }));
    const query = filterText.trim().toLowerCase();
    if (!query) {
      return mapped;
    }
    return mapped.filter(({ row }) => row.cells.some((c) => c.preview.toLowerCase().includes(query)));
  }, [data, filterText]);

  const columns = useMemo<Columns>(() => {
    const cols = data?.columns ?? object.columns ?? [];
    const list: Columns = [];

    if (data?.hasRowId) {
      list.push({
        title: "rowid",
        key: "__rowid",
        width: 84,
        fixed: "left",
        align: "right",
        render: (_value, record) => (
          <span className="mono" style={{ opacity: 0.6, fontSize: 12 }}>
            {record.row.rowId}
          </span>
        ),
      });
    }

    cols.forEach((column, idx) => {
      list.push({
        title: (
          <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
            <span>{column.name}</span>
            {column.primaryKey > 0 ? (
              <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: "15px", padding: "0 4px" }}>
                PK
              </Tag>
            ) : null}
          </span>
        ),
        key: column.name,
        sorter: true,
        sortOrder: sort === column.name ? (dir === "asc" ? "ascend" : "descend") : null,
        ellipsis: true,
        width: 180,
        align: isNumericType(column.type) ? "right" : "left",
        render: (_value, record) => renderCell(record.row.cells[idx]),
        onCell: (record) => ({
          className: sel?.index === record.index && sel.colIndex === idx ? "cell-selected" : "",
          style: { cursor: "pointer" },
          onClick: () => {
            if (data) {
              applySelection(data, record.index, idx);
            }
          },
        }),
      });
    });

    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, object, sort, dir, sel]);

  const handleTableChange: TableProps<GridRow>["onChange"] = (_pagination, _filters, sorter) => {
    const single = Array.isArray(sorter) ? sorter[0] : sorter;
    if (single && single.order) {
      setSort(String(single.columnKey));
      setDir(single.order === "ascend" ? "asc" : "desc");
    } else {
      setSort("");
      setDir("asc");
    }
    setOffset(0);
    setSel(null);
    onClearRef.current(object.name);
  };

  const goToPage = (nextPage: number) => {
    if (pageSize <= 0) {
      return;
    }
    // A keyboard move that crosses a page boundary sets `pending` and will
    // re-select a cell on the new page; don't clear the detail in that case.
    if (!pending.current) {
      onClearRef.current(object.name);
    }
    setOffset(Math.max(nextPage - 1, 0) * pageSize);
    setSel(null);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!data || !visible.length || pageSize <= 0) {
      return;
    }
    const maxCol = Math.max((data.columns?.length ?? 1) - 1, 0);
    const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

    // With nothing selected yet, any arrow key just selects the first cell
    // instead of moving away from it.
    if (!sel) {
      e.preventDefault();
      applySelection(data, visible[0].index, 0);
      return;
    }

    const currentPos = visible.findIndex((v) => v.index === sel.index);
    let pos = currentPos < 0 ? 0 : currentPos;
    let colIndex = sel.colIndex;

    switch (e.key) {
      case "ArrowUp":
        if (pos > 0) {
          pos -= 1;
        } else if (page > 1) {
          pending.current = { index: Number.MAX_SAFE_INTEGER, colIndex };
          setSel(null);
          goToPage(page - 1);
          e.preventDefault();
          return;
        } else {
          return;
        }
        break;
      case "ArrowDown":
        if (pos < visible.length - 1) {
          pos += 1;
        } else if (page < totalPages) {
          pending.current = { index: 0, colIndex };
          setSel(null);
          goToPage(page + 1);
          e.preventDefault();
          return;
        } else {
          return;
        }
        break;
      case "ArrowLeft":
        if (colIndex > 0) {
          colIndex -= 1;
        } else {
          return;
        }
        break;
      case "ArrowRight":
        if (colIndex < maxCol) {
          colIndex += 1;
        } else {
          return;
        }
        break;
      default:
        return;
    }

    e.preventDefault();
    applySelection(data, visible[pos].index, colIndex);
  };

  const selectedRowLabel = sel && data?.columns[sel.colIndex] ? `行 ${sel.index + 1} · ${data.columns[sel.colIndex].name}` : null;
  const total = data?.total ?? 0;

  return (
    <div className="pane">
      <div className="pane-header">
        <Space size={8}>
          <Input
            size="small"
            allowClear
            prefix={<SearchOutlined />}
            placeholder="当前页筛选"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            style={{ width: 180 }}
          />
          <Tooltip title="刷新">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => setReloadToken((t) => t + 1)} />
          </Tooltip>
        </Space>
        <Flex flex="1 1 auto" />
        {selectedRowLabel ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {selectedRowLabel}
          </Typography.Text>
        ) : null}
      </div>

      <div
        ref={wrapRef}
        className="table-wrap"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onMouseDown={() => wrapRef.current?.focus()}
        style={{ outline: "none" }}
      >
        {error ? (
          <Alert type="error" showIcon message={error} style={{ marginTop: 8 }} />
        ) : (
          <Table<GridRow>
            size="small"
            bordered
            loading={loading}
            columns={columns}
            dataSource={visible}
            rowKey={(record) => (record.row.rowId ? `r${record.row.rowId}` : `i${record.index}`)}
            pagination={false}
            scroll={{ x: "max-content", y: scrollY }}
            onChange={handleTableChange}
          />
        )}
      </div>

      {/* Always rendered so the pagination control is permanently visible. */}
      <div className="table-footer" style={{ borderTopColor: token.colorBorderSecondary }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {pageSize > 0 ? `每页 ${pageSize} 行 · 自适应视口` : "正在适配视口…"}
        </Typography.Text>
        <Flex flex="1 1 auto" />
        <Pagination
          size="small"
          current={page}
          pageSize={pageSize > 0 ? pageSize : 1}
          total={total}
          showSizeChanger={false}
          showQuickJumper
          disabled={pageSize <= 0}
          showTotal={(count, range) => `${range[0]}-${range[1]} / 共 ${count} 行`}
          onChange={goToPage}
        />
      </div>
    </div>
  );
}
