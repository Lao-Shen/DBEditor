import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { App as AntdApp, ConfigProvider, Empty, Modal, Splitter, Tabs, theme as antdTheme } from "antd";
import { Dialogs, Events } from "@wailsio/runtime";
import type { DBObject, DBSchema, CellSelection, TableStatus } from "./types";
import { buildTheme, loadThemeMode, saveThemeMode } from "./theme";
import type { ThemeMode } from "./theme";
import { listSchema, openDatabase } from "./api";
import { errorMessage } from "./util";
import { Toolbar } from "./components/Toolbar";
import { SchemaTree } from "./components/SchemaTree";
import { TableView } from "./components/TableView";
import { CellDetail } from "./components/CellDetail";
import { StatusBar } from "./components/StatusBar";
import { SettingsDialog } from "./components/SettingsDialog";

interface WorkbenchProps {
  mode: ThemeMode;
  onToggleTheme: () => void;
}

/** 与后端 update.go 的 UpdateCheckEvent 保持一致。 */
const UPDATE_CHECK_EVENT = "app:update:check";

function Workbench({ mode, onToggleTheme }: WorkbenchProps) {
  const { token } = antdTheme.useToken();
  const { message } = AntdApp.useApp();

  const [schema, setSchema] = useState<DBSchema | null>(null);
  const [tabs, setTabs] = useState<DBObject[]>([]);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selections, setSelections] = useState<Record<string, CellSelection>>({});
  const [statuses, setStatuses] = useState<Record<string, TableStatus>>({});
  const [loading, setLoading] = useState(false);
  const [sqlModal, setSqlModal] = useState<{ name: string; sql: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsAutoCheck, setSettingsAutoCheck] = useState(false);

  // 后端启动静默检查发现新版本时通知前端，直接打开设置并自动检查一次。
  useEffect(() => {
    const off = Events.On(UPDATE_CHECK_EVENT, () => {
      setSettingsAutoCheck(true);
      setShowSettings(true);
    });
    return () => off();
  }, []);

  const handleOpen = async () => {
    try {
      const result = await Dialogs.OpenFile({
        Title: "选择 SQLite 数据库",
        CanChooseFiles: true,
        CanChooseDirectories: false,
        AllowsMultipleSelection: false,
        Filters: [
          { DisplayName: "SQLite 数据库", Pattern: "*.db;*.sqlite;*.sqlite3;*.db3" },
          { DisplayName: "所有文件", Pattern: "*.*" },
        ],
      });
      const path = Array.isArray(result) ? result[0] : result;
      if (!path) {
        return;
      }
      setLoading(true);
      const next = await openDatabase(path);
      setSchema(next);
      setTabs([]);
      setActiveKey(null);
      setSelections({});
      setStatuses({});
      setFilter("");
      message.success(`已打开 ${next.name}`);
    } catch (e) {
      message.error(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshSchema = async () => {
    try {
      const next = await listSchema();
      setSchema(next);
      message.success("结构已刷新");
    } catch (e) {
      message.error(errorMessage(e));
    }
  };

  const handleOpenObject = useCallback((obj: DBObject) => {
    setTabs((prev) => (prev.some((t) => t.name === obj.name) ? prev : [...prev, obj]));
    setActiveKey(obj.name);
  }, []);

  const handleSelectCell = useCallback((selection: CellSelection) => {
    setSelections((prev) => ({ ...prev, [selection.table]: selection }));
  }, []);

  const handleClearSelection = useCallback((table: string) => {
    setSelections((prev) => {
      if (!(table in prev)) {
        return prev;
      }
      const copy = { ...prev };
      delete copy[table];
      return copy;
    });
  }, []);

  const handleStatus = useCallback((status: TableStatus) => {
    setStatuses((prev) => ({ ...prev, [status.table]: status }));
  }, []);

  const handleShowSql = useCallback((obj: DBObject) => {
    setSqlModal({ name: obj.name, sql: obj.sql });
  }, []);

  const handleCloseTab = (key: string) => {
    const index = tabs.findIndex((t) => t.name === key);
    const next = tabs.filter((t) => t.name !== key);
    setTabs(next);
    if (activeKey === key) {
      const fallback = next[index - 1] ?? next[0];
      setActiveKey(fallback ? fallback.name : null);
    }
    setSelections((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    setStatuses((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const activeSelection = activeKey ? selections[activeKey] ?? null : null;
  const activeStatus = activeKey ? statuses[activeKey] ?? null : null;

  let center: ReactNode;
  if (!schema) {
    center = (
      <div className="tab-empty">
        <Empty description="请先打开一个 SQLite 数据库" />
      </div>
    );
  } else if (tabs.length === 0) {
    center = (
      <div className="tab-empty">
        <Empty description="从左侧结构树选择一张表" />
      </div>
    );
  } else {
    center = (
      <Tabs
        className="app-tabs"
        type="editable-card"
        hideAdd
        activeKey={activeKey ?? undefined}
        onChange={setActiveKey}
        onEdit={(targetKey, action) => {
          if (action === "remove" && typeof targetKey === "string") {
            handleCloseTab(targetKey);
          }
        }}
        items={tabs.map((t) => ({
          key: t.name,
          label: t.name,
          closable: true,
          // Belt and braces: give the pane a definite height so the pane's own
          // flex column (header / grid / footer) can pin the pagination bar to
          // the bottom, independent of antd's internal wrapper classes.
          style: { height: "100%", minHeight: 0, overflow: "hidden" },
          children: (
            <TableView
              object={t}
              onSelectCell={handleSelectCell}
              onClearSelection={handleClearSelection}
              onStatus={handleStatus}
            />
          ),
        }))}
      />
    );
  }

  return (
    <div className="app-shell" style={{ background: token.colorBgLayout, color: token.colorText }}>
      <Toolbar
        schema={schema}
        mode={mode}
        loading={loading}
        onOpen={handleOpen}
        onToggleTheme={onToggleTheme}
        onRefreshSchema={handleRefreshSchema}
        onOpenSettings={() => {
          setSettingsAutoCheck(false);
          setShowSettings(true);
        }}
      />

      <div style={{ flex: "1 1 auto", minHeight: 0 }}>
        <Splitter style={{ height: "100%" }}>
          <Splitter.Panel defaultSize="20%" min="12%" max="40%" style={{ background: token.colorBgContainer }}>
            <SchemaTree
              schema={schema}
              filter={filter}
              onFilterChange={setFilter}
              onOpenObject={handleOpenObject}
              onShowSql={handleShowSql}
            />
          </Splitter.Panel>
          <Splitter.Panel style={{ background: token.colorBgContainer }}>{center}</Splitter.Panel>
          {/* The cell detail pane only exists while a cell is selected. */}
          {activeSelection ? (
            <Splitter.Panel defaultSize="26%" min="16%" max="45%" style={{ background: token.colorBgContainer }}>
              <CellDetail selection={activeSelection} />
            </Splitter.Panel>
          ) : null}
        </Splitter>
      </div>

      <StatusBar schema={schema} status={activeStatus} />

      <SettingsDialog
        open={showSettings}
        autoCheck={settingsAutoCheck}
        onClose={() => {
          setShowSettings(false);
          setSettingsAutoCheck(false);
        }}
      />

      <Modal
        open={Boolean(sqlModal)}
        title={sqlModal ? `${sqlModal.name} · 建表 SQL` : ""}
        footer={null}
        width={640}
        onCancel={() => setSqlModal(null)}
      >
        <pre
          className="mono"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, maxHeight: 460, overflow: "auto" }}
        >
          {sqlModal?.sql || "(无)"}
        </pre>
      </Modal>
    </div>
  );
}

function Root() {
  const [mode, setMode] = useState<ThemeMode>(() => loadThemeMode());

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next: ThemeMode = prev === "dark" ? "light" : "dark";
      saveThemeMode(next);
      return next;
    });
  }, []);

  return (
    <ConfigProvider theme={buildTheme(mode)}>
      <AntdApp style={{ height: "100%" }}>
        <Workbench mode={mode} onToggleTheme={toggleTheme} />
      </AntdApp>
    </ConfigProvider>
  );
}

export default Root;
