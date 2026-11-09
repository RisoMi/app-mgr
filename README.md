# AppMgr

轻量化跨平台桌面启动器：把 **App、文件夹、脚本、快捷方式** 收进同一张图标网格，
用分类、分组、收藏夹管起来，双击即启动。Windows 与 macOS 共用同一套界面与业务代码。

本项目由 QuickLaunch（Electron 版，仅 Windows）迁移重构而来：保留全部产品能力，
把运行时从 Electron 换成 Tauri 2，并把 Windows 专属能力按平台重写。

| | QuickLaunch (Electron) | AppMgr (Tauri 2) |
| --- | --- | --- |
| Windows 产物 | 安装包 + 便携版（约 100 MB 量级） | **仅便携版 exe，约 4.5 MiB** |
| macOS | 不支持 | 支持（dmg，当前未签名） |
| 运行时依赖 | Electron + Chromium | 系统 WebView2 / WKWebView |
| 前端运行时依赖 | Vue 3 | Vue 3 + Tauri 官方 API + 1 个官方 dialog 插件（无其它第三方库） |

## 功能

- **组织**：无限分类侧栏、拖拽排序、拖到分类归类、停住 650ms 吸附成组、收藏夹抽屉、当前视图搜索
- **批量操作**：长按进编辑模式、多选 / 全选、批量分组 / 收藏 / 删除
- **外观**：6 套主题 × 明暗、3 种卡片样式（卡片 / 原生 / 仅图标）、3 档图标尺寸
- **窗口**：自绘交通灯、窗口置顶、**mini 只读模式**（只显示收藏、可缩放、几何记忆）
- **导入**：从资源管理器拖入文件/文件夹，自动抽图标、逐项进度、按路径去重
- **启动**：启动参数、工作目录、脚本按平台交给宿主执行；「打开位置」跨平台定位
- **常驻**：关闭窗口收进托盘/菜单栏，双击或右键「显示窗口」唤回
- **记忆**：上次分类、窗口形态、mini 几何与置顶偏好都持久化

## 技术栈

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 界面 | Vue 3 + Vite 7 | A 档约 6500 行渲染层代码从旧版原样复用 |
| 平台边界 | `src/api.js` | 导出同名 `electronAPI`，旧组件一行不改 |
| 窗口 / mini / 拖放 / 事件 | `@tauri-apps/api` JS API | 平台差异由 Tauri 吸收，Rust 侧不重复实现 |
| 系统能力 | Rust（Tauri 2） | 数据读写、图标抽取、启动、定位、导入队列、托盘 |
| 文件对话框 | `tauri-plugin-dialog` | 唯一新增依赖，Tauri 无内置能力 |

Rust 侧只有 `tauri` / `serde` / `serde_json` / `tauri-plugin-dialog` 四个 crate。

## 快速开始

前置：Node 22、pnpm 12、Rust stable；Windows 需 WebView2（Win11 自带），macOS 需 Xcode Command Line Tools。

```bash
pnpm install
pnpm tauri:dev              # 开发
pnpm build                  # 仅构建前端
pnpm tauri build --no-bundle    # Windows 便携 exe
pnpm tauri build --bundles dmg  # macOS dmg
```

`pnpm tauri build --no-bundle` 只产出 `src-tauri/target/release/app-mgr.exe`，
**不生成 MSI / NSIS 安装器**（Lei 明确要求 Windows 只出便携版）。

## 数据目录

| 平台 | 位置 |
| --- | --- |
| Windows 便携版 | exe 同级 `data/app.json`（整个目录拷走即带走配置） |
| Windows 回退 | 系统 AppData（exe 所在目录不可写时） |
| macOS | `~/Library/Application Support/com.risomi.appmgr/app.json` |

**渲染层是唯一写盘方**：`store.js` 200ms 防抖后把整份 JSON 交给 Rust，
Rust 先写 `.tmp` 再 `rename` 原子落盘，避免中途退出写坏数据。
图标以 data URL 直接存在 `app.json` 里，不需要额外的 logos 目录或自定义协议。

## 打包与 CI

`.github/workflows/build.yml` 两个 job：

- `windows-latest`：`pnpm tauri build --no-bundle` → `AppMgr-portable.exe`
- `macos-latest`：`pnpm tauri build --bundles dmg` → `.dmg`

产物都作为 Actions artifact 上传。**macOS 包当前未签名、未公证**，可用于真机验证，
但不能直接对外分发。要分发需 Apple 开发者账号并配置以下 secrets：
`APPLE_CERTIFICATE`、`APPLE_CERTIFICATE_PASSWORD`、`APPLE_ID`、
`APPLE_PASSWORD`、`APPLE_TEAM_ID`。

## 设计语言：柔光玻璃（v0.4）

界面不贴 Fluent 也不贴 Aqua，**不用任何系统半透明材质**
（`setBackgroundMaterial` / `vibrancy` / `backdrop-filter` 一律不用）：
柔和光晕、半透明玻璃层、亮色发丝边、柔和投影全部由应用内纯 CSS 绘制。
因此 Windows 与 macOS 渲染的是同一套渐变，观感一致，也不会透出深色壁纸发灰。

- 6 套主题 = 6 种强调色，中性玻璃底共用；令牌由 `themes.js` 的 `modernVars()` 注入
- 明暗两态各有一套光晕与玻璃参数（`GLASS` 表）
- **mini 面板保持纯色不透明**，柔光只铺在完整态

`design/preview.html` 是引用真实 CSS + `themes.js` 的静态视觉基线；
明暗截图见 `design/probe/shots-ui-light.png` / `shots-ui-dark.png`。
直接用浏览器打开预览页时建议起本地静态服务（需允许 ES module 加载）。

## 已知限制与后续

- macOS 真机观感（自绘交通灯、菜单栏图标、WKWebView 下的 CSS 表现）尚未验证
- 旧 Electron 版的 650 条 CDP 断言不适用于 Tauri；当前验收是 `cargo test` 4 个单测
  （含真实系统 exe 的 PE 图标抽取）+ 前端构建 + 双平台 CI 构建
- `.lnk` 目标解析采用轻量路径扫描（非完整 Shell Link 解析）；无图标资源的条目走字母兜底
- macOS 图标通过读 `Info.plist` 的 `CFBundleIconFile` 后用系统 `sips` 转 PNG

更细的模块划分、IPC 契约与数据流见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。
