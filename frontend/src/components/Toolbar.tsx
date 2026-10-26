import { Button, Flex, Space, Tag, Tooltip, Typography, theme } from "antd";
import {
  FolderOpenOutlined,
  MoonOutlined,
  ReloadOutlined,
  SettingOutlined,
  SunOutlined,
} from "@ant-design/icons";
import { formatSize } from "../util";
import type { DBSchema } from "../types";
import type { ThemeMode } from "../theme";

interface ToolbarProps {
  schema: DBSchema | null;
  mode: ThemeMode;
  loading: boolean;
  onOpen: () => void;
  onToggleTheme: () => void;
  onRefreshSchema: () => void;
  onOpenSettings: () => void;
}

export function Toolbar({
  schema,
  mode,
  loading,
  onOpen,
  onToggleTheme,
  onRefreshSchema,
  onOpenSettings,
}: ToolbarProps) {
  const { token } = theme.useToken();
  const isDark = mode === "dark";

  return (
    <div
      className="app-toolbar"
      style={{ borderBottomColor: token.colorBorderSecondary, background: token.colorBgContainer }}
    >
      <Button type="primary" icon={<FolderOpenOutlined />} onClick={onOpen} loading={loading}>
        打开数据库
      </Button>

      {schema ? (
        <Space size={8}>
          <Typography.Text strong>{schema.name}</Typography.Text>
          <Typography.Text type="secondary">{formatSize(schema.size)}</Typography.Text>
          <Tag color="blue" style={{ marginInlineEnd: 0 }}>
            只读
          </Tag>
          <Tooltip title="重新读取结构">
            <Button size="small" type="text" icon={<ReloadOutlined />} onClick={onRefreshSchema} />
          </Tooltip>
        </Space>
      ) : (
        <Typography.Text type="secondary">尚未打开数据库</Typography.Text>
      )}

      <Flex flex="1 1 auto" />

      <Tooltip title="设置 / 关于">
        <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} />
      </Tooltip>
      <Tooltip title={isDark ? "切换到浅色" : "切换到深色"}>
        <Button
          type="text"
          icon={isDark ? <SunOutlined /> : <MoonOutlined />}
          onClick={onToggleTheme}
        />
      </Tooltip>
    </div>
  );
}
