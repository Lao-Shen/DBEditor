import { useEffect, useMemo, useState } from "react";
import { Dropdown, Empty, Input, Tag, Tree, Typography, theme } from "antd";
import type { TreeProps } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { Clipboard } from "@wailsio/runtime";
import type { ColumnInfo } from "../../bindings/dbeditor";
import type { DBObject, DBSchema } from "../types";

interface SchemaTreeProps {
  schema: DBSchema | null;
  filter: string;
  onFilterChange: (value: string) => void;
  onOpenObject: (obj: DBObject) => void;
  onShowSql: (obj: DBObject) => void;
}

type TreeNode = NonNullable<TreeProps["treeData"]>[number];

const GROUP_KEYS = ["grp:tables", "grp:views", "grp:indexes", "grp:triggers"];

function ObjectNodeTitle({ object, onShowSql }: { object: DBObject; onShowSql: (o: DBObject) => void }) {
  const { token } = theme.useToken();
  const menu = {
    items: [
      { key: "sql", label: "查看建表 SQL" },
      { key: "copy", label: "复制名称" },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === "sql") {
        onShowSql(object);
      } else {
        void Clipboard.SetText(object.name);
      }
    },
  };
  return (
    <Dropdown menu={menu} trigger={["contextMenu"]}>
      <span className="tree-node">
        <span className="tree-node-name">{object.name}</span>
        {object.columns?.length ? (
          <span className="tree-node-meta tree-node-dim">{object.columns.length} 列</span>
        ) : null}
        <span
          className="tree-node-meta tree-sql-btn mono"
          style={{ color: token.colorPrimary }}
          onClick={(e) => {
            e.stopPropagation();
            onShowSql(object);
          }}
        >
          SQL
        </span>
      </span>
    </Dropdown>
  );
}

function ColumnNodeTitle({ column }: { column: ColumnInfo }) {
  return (
    <span className="tree-node">
      <span className="tree-node-name">{column.name}</span>
      {column.type ? <span className="tree-node-meta tree-node-dim">{column.type}</span> : null}
      {column.primaryKey > 0 ? (
        <Tag color="gold" style={{ marginInlineEnd: 0, fontSize: 10, lineHeight: "15px", padding: "0 4px" }}>
          PK
        </Tag>
      ) : null}
      {column.notNull ? <span className="tree-node-meta tree-node-dim">NOT NULL</span> : null}
    </span>
  );
}

function GroupTitle({ label, count }: { label: string; count: number }) {
  return (
    <span>
      {label} <span style={{ opacity: 0.45, fontSize: 11 }}>{count}</span>
    </span>
  );
}

export function SchemaTree({ schema, filter, onFilterChange, onOpenObject, onShowSql }: SchemaTreeProps) {
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);

  useEffect(() => {
    if (schema) {
      setExpandedKeys(["root", ...GROUP_KEYS]);
    }
  }, [schema]);

  const normalized = filter.trim().toLowerCase();

  const treeData = useMemo<TreeNode[]>(() => {
    if (!schema) {
      return [];
    }
    const groups: { key: string; label: string; list: DBObject[] }[] = [
      { key: "grp:tables", label: "表", list: schema.tables },
      { key: "grp:views", label: "视图", list: schema.views },
      { key: "grp:indexes", label: "索引", list: schema.indexes },
      { key: "grp:triggers", label: "触发器", list: schema.triggers },
    ];

    const groupNodes: TreeNode[] = groups.map((group) => {
      const list = normalized
        ? group.list.filter((o) => o.name.toLowerCase().includes(normalized))
        : group.list;

      const objectNodes: TreeNode[] = list.map((object) => {
        const columns = object.columns ?? [];
        return {
          key: `obj:${object.type}:${object.name}`,
          title: <ObjectNodeTitle object={object} onShowSql={onShowSql} />,
          children: columns.length
            ? columns.map((column) => ({
                key: `col:${object.type}:${object.name}:${column.name}`,
                title: <ColumnNodeTitle column={column} />,
                isLeaf: true,
                selectable: false,
              }))
            : undefined,
        };
      });

      return {
        key: group.key,
        title: <GroupTitle label={group.label} count={list.length} />,
        selectable: false,
        children: objectNodes,
      };
    });

    return [
      {
        key: "root",
        title: (
          <span className="tree-node">
            <span className="tree-node-name">
              <Typography.Text strong>{schema.name}</Typography.Text>
            </span>
          </span>
        ),
        selectable: false,
        children: groupNodes,
      },
    ];
  }, [schema, normalized, onShowSql]);

  // When filtering, expand the groups so matches are visible.
  useEffect(() => {
    if (normalized) {
      setExpandedKeys(["root", ...GROUP_KEYS]);
    }
  }, [normalized]);

  const handleSelect: TreeProps["onSelect"] = (_keys, info) => {
    const key = String(info.node.key);
    if (!key.startsWith("obj:") || !schema) {
      return;
    }
    const [, type, ...rest] = key.split(":");
    const name = rest.join(":");
    if (type !== "table" && type !== "view") {
      return;
    }
    const list = type === "table" ? schema.tables : schema.views;
    const object = list.find((o) => o.name === name);
    if (object) {
      onOpenObject(object);
    }
  };

  return (
    <div className="pane">
      <div className="pane-header">
        <Input
          allowClear
          size="small"
          placeholder="搜索表 / 视图…"
          prefix={<SearchOutlined />}
          value={filter}
          onChange={(e) => onFilterChange(e.target.value)}
        />
      </div>
      <div className="pane-scroll schema-tree" style={{ padding: "0 4px 8px" }}>
        {schema ? (
          <Tree
            showLine
            blockNode
            treeData={treeData}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys as React.Key[])}
            onSelect={handleSelect}
          />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="打开数据库后显示结构"
            style={{ marginTop: 48 }}
          />
        )}
      </div>
    </div>
  );
}
