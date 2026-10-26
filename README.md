# DBEditor

一个基于 **Wails3** 的 SQLite 数据库查看工具（个人项目）。打开 `.db / .sqlite` 文件，左侧浏览结构、中间分页查看表数据、右侧查看单元格完整内容。

> 更新日志见 [changelog.json](changelog.json)（格式见文末「更新日志」一节）。

## 功能（v1 · 只读）

- 打开 SQLite 文件（原生文件对话框），以 `PRAGMA query_only` 保证不修改原文件
- 左侧结构树：表 / 视图 / 索引 / 触发器，表节点可展开查看列（类型、PK、NOT NULL）
- 表名搜索过滤
- 右键或悬浮 `SQL` 查看建表语句
- 多标签页打开多张表
- 数据网格：列头排序、当前页筛选、键盘方向键导航
- **分页自适应视口**：按可视区高度自动装满整行，表格自身不滚动，翻页交给分页控件
- **分页控件常驻**：固定在表格底部，加载 / 出错 / 空表时也始终可见
- 单元格显示：`NULL` 灰色斜体、BLOB 显示 `<BLOB n bytes>`、长文本截断
- 右侧单元格详情：**仅在选中单元格时出现**（未选中/翻页/排序后收起），显示行 rowid / 列 / 类型 / 长度，文本或十六进制（BLOB），一键复制
- 深色 / 浅色主题切换（记忆偏好，默认深色）
- **内置自动更新**：设置里查看版本 / 检查更新 / 下载安装，可开关「启动时自动检查」

## 技术栈

| 层 | 选型 |
| --- | --- |
| 桌面框架 | Wails3 (`v3.0.0-beta.24`) |
| 后端 | Go 1.26 |
| SQLite 驱动 | `modernc.org/sqlite`（纯 Go，免 CGO） |
| 前端 | React 18 + TypeScript + Vite |
| UI 库 | Ant Design 6 |

## 运行 / 构建

```bash
# 开发模式（热重载）
wails3 dev

# 生产构建，产物在 bin/
wails3 build

# 仅后端测试
go test .

# 仅前端构建
cd frontend && npm run build
```

## 目录结构

```
.
├── main.go            # 应用入口，注册 DBService / UpdateService
├── sqlite.go          # 后端核心：打开库、读取结构、分页查询、单元格读取
├── sqlite_test.go     # 后端测试
├── changelog.json     # 更新日志（按日期分组，供自动版本号计算）
├── update.go          # 更新器初始化（内置 updater + endpoint 更新源 + 启动静默检查）
├── updateservice.go   # 绑定给前端的更新/设置服务
├── settings.go        # 本地设置（自动更新开关）落盘
├── updater.pub        # 更新签名验签公钥（Ed25519 PKIX PEM，随构建固定）
├── build/             # Wails3 各平台打包配置
└── frontend/
    ├── bindings/      # Wails 自动生成的 TS 绑定（勿手改）
    └── src/
        ├── App.tsx                 # 布局与全局状态
        ├── api.ts                  # 绑定封装 + 数据归一化
        ├── types.ts                # 前端类型
        ├── theme.ts                # 主题配置
        ├── hooks.ts / util.ts
        └── components/
            ├── Toolbar.tsx
            ├── SchemaTree.tsx      # 左侧结构树
            ├── TableView.tsx       # 中间数据网格 + 分页
            ├── CellDetail.tsx      # 右侧单元格详情
            ├── SettingsDialog.tsx  # 设置 / 关于 / 检查更新
            └── StatusBar.tsx
```

## 后端接口（Wails 绑定）

```
OpenDatabase(path) -> Schema        打开数据库并读取结构
ListSchema()       -> Schema        重新读取结构
GetTableRows(table, QueryOptions)   分页查询（sort/dir/limit/offset）
GetCellValue(table, rowID, column)  读取单元格完整内容
CloseDatabase()                     关闭

CurrentVersion()            -> string      当前版本号
AutoUpdateEnabled()         -> bool        是否启动时自动检查
SetAutoUpdateEnabled(bool)  -> error       设置自动更新开关
CheckUpdate()               -> UpdateInfo  仅检查是否有新版本
StartInstall()              -> error       下载并安装（弹内置更新窗口）
```

## 更新模块

基于 Wails3 内置 `pkg/updater`（endpoint 更新源 + Ed25519 签名校验），参考 TermHub 的做法：

- **启动静默检查**：启动后延迟 4s，仅当开启自动更新、当前版本非 `dev`、且确有新版本时，才发事件通知前端打开设置并自动检查一次
- **检查与下载分离**：`CheckUpdate()` 只检查；用户确认后 `StartInstall()` 调 `CheckAndInstall()`，由框架弹出内置更新窗口展示进度与重启
- **入口**：工具栏右侧齿轮 → 设置（通用：自动更新开关；关于：当前版本 / 检查更新 / 下载并安装）

**版本号注入**（已加在 `build/{windows,darwin,linux}/Taskfile.yml` 的 ldflags）：

```bash
wails3 build PM_VERSION=1.0.0     # 未指定时注入 dev
```

**更新源与签名**

- 清单地址见 `update.go` 的 `updateManifestURL`（默认 `https://www.earwind.top/api/v1/update/check?fullname=DBEditor`）；换服务器只需改这一行
- 信任根见 `updater.pub`（Ed25519 PKIX 公钥）。发布端用对应私钥给清单与产物签名，客户端只认这把公钥；更换密钥时重新生成并替换
- 服务端尚未发布 DBEditor 清单时返回 HTTP 204，客户端视为「已是最新」，不会报错
- 发布一个可安装版本需要：注入版本号构建 → 签名产物 → 在更新源发布 `fullname=DBEditor` 的清单（`version` / `artifacts[].url` / `digest` / `signature`）

**设置落盘**：`%APPDATA%/DBEditor/settings.json`（字段 `auto_update`，默认开启）

## 更新日志

见 [changelog.json](changelog.json)。**格式**：按日期分组（key 为 `YYYY-MM-DD`），每条为 `{id, tag, text}`，`tag ∈ {fix, new, milestone}`（fix = 修 bug / new = 新功能 / milestone = 里程碑·不兼容重大变更）。`id` 形如 `YYYY-MM-DD-N`。该结构供项目管理工具对比上一版 changelog 自动计算版本号：有 `milestone` → 主版本 +1，否则有 `new` → 次版本 +1，否则有 `fix` → 修订 +1。

## 已知限制

- **只读**：编辑功能（改单元格 / 增删行）计划放在 v2
- `WITHOUT ROWID` 表：可以浏览分页，但右侧「完整单元格」暂不支持（依据 rowid 定位）
- 分页使用 `LIMIT/OFFSET`，深页速度会随 offset 增大而下降
- 总行数使用精确 `COUNT(*)`，超大表可能偏慢
- 当前页筛选是前端过滤，未下推到 SQL `WHERE`

## 路线图

- [ ] v2：单元格编辑、新增 / 删除行、事务提交与回滚
- [ ] 服务器端 WHERE 过滤与全文搜索
- [ ] 大表 `COUNT(*)` 估算或延迟统计
- [ ] `WITHOUT ROWID` 表的单元格详情（基于主键定位）
- [ ] 导出 CSV / JSON
