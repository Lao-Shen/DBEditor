import { useCallback, useEffect, useState } from "react";
import {
  App as AntdApp,
  Button,
  Divider,
  Flex,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
} from "antd";
import {
  CheckCircleOutlined,
  CloudDownloadOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import * as Update from "../../bindings/dbeditor/updateservice";
import { errorMessage, formatSize } from "../util";

interface SettingsDialogProps {
  open: boolean;
  /** 打开时自动检查一次更新（启动静默检查发现新版时用） */
  autoCheck: boolean;
  onClose: () => void;
}

// 设置弹窗：通用（自动更新）+ 关于（版本 / 检查更新 / 下载安装）
export function SettingsDialog({ open, autoCheck, onClose }: SettingsDialogProps) {
  const { message } = AntdApp.useApp();
  const [version, setVersion] = useState("");
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateSize, setUpdateSize] = useState(0);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    Update.CurrentVersion().then(setVersion).catch(() => {});
    Update.AutoUpdateEnabled().then(setAutoUpdate).catch(() => {});
  }, [open]);

  const doCheck = useCallback(async () => {
    setChecking(true);
    setStatus("");
    setUpdateVersion("");
    setUpdateSize(0);
    setNotes("");
    try {
      const info = await Update.CheckUpdate();
      if (info?.available) {
        setUpdateVersion(info.version);
        setUpdateSize(info.size);
        setNotes(info.notes || "");
        setStatus(`发现新版本 ${info.version}`);
      } else {
        setStatus("已是最新版本");
      }
    } catch (e) {
      setStatus(`检查更新失败：${errorMessage(e)}`);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (open && autoCheck) {
      void doCheck();
    }
  }, [open, autoCheck, doCheck]);

  const install = async () => {
    setInstalling(true);
    try {
      await Update.StartInstall();
      setStatus("正在下载更新，请在弹出的更新窗口中完成安装…");
    } catch (e) {
      setStatus(`启动更新失败：${errorMessage(e)}`);
      setInstalling(false);
    }
  };

  const toggleAuto = async (value: boolean) => {
    setAutoUpdate(value);
    try {
      await Update.SetAutoUpdateEnabled(value);
    } catch (e) {
      setAutoUpdate(!value);
      message.error(errorMessage(e));
    }
  };

  return (
    <Modal open={open} title="设置" footer={null} width={520} onCancel={onClose}>
      <Typography.Text type="secondary">通用</Typography.Text>
      <Flex align="center" justify="space-between" style={{ marginTop: 8 }}>
        <Typography.Text>自动更新（启动时检查）</Typography.Text>
        <Switch checked={autoUpdate} onChange={(v) => void toggleAuto(v)} />
      </Flex>

      <Divider style={{ margin: "16px 0" }} />

      <Typography.Text type="secondary">关于</Typography.Text>
      <Flex align="center" justify="space-between" style={{ marginTop: 8 }}>
        <Typography.Text>当前版本</Typography.Text>
        <Typography.Text className="mono">{version || "—"}</Typography.Text>
      </Flex>
      <Flex align="center" justify="space-between" style={{ marginTop: 12 }}>
        <Typography.Text>检查更新</Typography.Text>
        <Button
          size="small"
          icon={<SyncOutlined />}
          loading={checking}
          onClick={() => void doCheck()}
        >
          检查更新
        </Button>
      </Flex>

      {updateVersion ? (
        <Flex
          align="center"
          justify="space-between"
          style={{ marginTop: 12, padding: "8px 10px", borderRadius: 6, background: "rgba(106,141,255,0.12)" }}
        >
          <Space size={8}>
            <Tag color="blue" style={{ marginInlineEnd: 0 }}>
              {updateVersion}
            </Tag>
            {updateSize > 0 ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {formatSize(updateSize)}
              </Typography.Text>
            ) : null}
          </Space>
          <Button
            type="primary"
            size="small"
            icon={<CloudDownloadOutlined />}
            loading={installing}
            onClick={() => void install()}
          >
            下载并安装
          </Button>
        </Flex>
      ) : null}

      {notes ? (
        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 10, marginBottom: 0, whiteSpace: "pre-line", fontSize: 12 }}
        >
          {notes}
        </Typography.Paragraph>
      ) : null}

      {status ? (
        <Space size={6} style={{ marginTop: 10 }}>
          {status === "已是最新版本" ? (
            <CheckCircleOutlined style={{ color: "#52c41a" }} />
          ) : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {status}
          </Typography.Text>
        </Space>
      ) : null}
    </Modal>
  );
}
