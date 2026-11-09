# 架构说明

## 一句话

**业务状态全在渲染层，Rust 只做系统能力。** 这是从 QuickLaunch 继承下来的最核心约定，
换成 Tauri 后依然成立，也是数据不会打架的原因。

```
┌─────────────────────────────────────────────────────────┐
│ Vue 渲染层（src/）                                        │
│  store.js 单一 reactive 状态 · 12 个组件 · themes.js        │
│  所有写盘经 persist() → api.saveData()                     │
└───────────────────────┬─────────────────────────────────┘
                        │ src/api.js（唯一平台边界）
        ┌───────────────┴────────────────┐
        │                                │
┌───────▼────────┐              ┌───────▼──────────────┐
│ Tauri JS API   │              │ Rust 命令（invoke）   │
│ 窗口 / mini /  │              │ 数据 / 图标 / 启动 /  │
│ 置顶 / 拖放 /  │              │ 定位 / 导入 / 托盘    │
│ 事件订阅       │              │ src-tauri/src/lib.rs │
└────────────────┘              └──────────────────────┘
```

## 平台边界：`src/api.js`

旧版所有组件都写 `import { electronAPI } from './api'`。新 `api.js` **保留同名导出**，
调用形状一一对应，所以 A 档约 6500 行代码几乎零改动就搬过来了。
`main.js` 再挂 `window.electronAPI = electronAPI`，兼容少数直接读全局的组件。

尽量能用 Tauri JS API 做的就不绕 Rust：

| 能力 | 实现位置 |
| --- | --- |
| 交通灯 / 最大化 / 置顶 | `getCurrentWindow()` |
| mini 形态切换、几何记忆 | `setSize` / `setMinSize` / `setPosition` / `onResized` / `onMoved` |
| 无边框拖拽 | `startDragging()`（Tauri 不认 `-webkit-app-region`） |
| 拖入路径 | `getCurrentWebview().onDragDropEvent()` → 自定义 DOM 事件 |
| 事件订阅 | `listen()` 包装成同步返回 unlisten |
| 图标透明边裁剪 | Canvas（纯前端，零 Rust 依赖） |

> mini 退出时**先把 `inMini` 置 false 再改窗口尺寸**，否则恢复完整态的 resize 会把
> 1120×740 回传渲染层写进 `settings.mini.w/h`，下次进 mini 就不缩小了。这个坑旧版踩过。

## Rust 命令（`invoke`）

| 命令 | 作用 |
| --- | --- |
| `load_data` / `save_data` | 读写 `app.json`；写用 `.tmp` + `rename` 原子落盘 |
| `extract_icon(path)` | 返回图标 data URL（见下） |
| `import_files(paths, categoryId)` | 批量抽图标 → `items-progress` → `items-added` |
| `launch_item(payload)` | 按平台启动，含参数与工作目录 |
| `reveal_item(path)` | `explorer /select,` / `open -R` |
| `dnd_log(msg)` | 调试日志 |

**推送事件**：`items-progress`（`{done,total,name,phase}`）、`items-added`（`{items,skipped}`）。
渲染层只负责显示与追加，绝不整份替换状态——整份替换会冲掉尚未落盘的改动。

## 图标抽取（旧版最重的一块，已重写为纯 Rust / 系统命令）

| 平台 | 路径 |
| --- | --- |
| Windows | 纯 Rust 解析 PE 资源目录，取 `RT_GROUP_ICON` + `RT_ICON` 拼成 ICO → data URL；`.lnk` 先轻量扫出目标路径 |
| macOS | 读 `.app/Contents/Info.plist` 的 `CFBundleIconFile` → `.icns` → 系统 `sips` 转 PNG → data URL |
| 其它 / 无资源 | 返回 `null`，前端用字母兜底 |

浏览器原生支持 ICO / PNG 的 data URL，所以**不需要图像 crate、不需要子进程抽图标
（Windows）、不需要落盘单独文件、不需要自定义协议**。旧版那套 C# P/Invoke + 预编译 DLL
缓存 + 快捷方式 COM 解析（约 1130 行）整块消失。

`cargo test` 里有一条用真实系统 exe 验证 PE 解析链的测试。

## 启动

`launch_item` 收到 `{ path, args, type, workDir }`：

- Windows：目录 / `.lnk` / `.url` → `cmd /c start`；`.bat/.cmd` → `cmd /c`；
  `.vbs` → `wscript`；带参数直接起进程，非 PE 失败时降级到 ShellExecute
- macOS：`.app` / 目录 → `open`；`.sh/.command` → `/bin/sh`；`.scpt` → `osascript`；
  失败降级 `open`
- 其他平台：`xdg-open`

参数用支持引号的简单分词，工作目录传给 `current_dir`。

## 托盘与关闭

`setup_tray()` 在 `setup` 里建托盘菜单（显示窗口 / 退出）；
`on_window_event` 拦截 `CloseRequested` → `prevent_close()` + `hide()`。
只有托盘「退出」会真结束进程。渲染层点交通灯关闭只是发 `close()`，
由这个拦截统一收进后台。

## 数据目录

- Windows：`current_exe().parent()/data`，写入探针文件验可写；不可写回退 `app_data_dir()`
- macOS：`app_data_dir()`（Application Support）

`app.json` 结构：`version` / `categories` / `items` / `groups` / `favorites` / `settings`。
`settings` 含主题、明暗、卡片样式、图标尺寸、上次分类、`topMost`、`mini`（几何与置顶）。
`items[].logo` 是 data URL 或 `null`；`path` 是各平台原生路径。

## 设计令牌

`themes.js` 的 `modernVars(themeId, mode)` 合成后由 `applyTheme()` 写到 `:root`：

- `NEUTRAL[mode]`：中性底 / 文字 / 半透明容器阶 / 发丝线
- `GLASS[mode]`：`--md-glow-a/b/c` 光晕、`--md-glass*` 玻璃层与投影
- 6 套主题只贡献一个 accent（取各自 `light/dark.primary`）

`paletteOf()` 与 `applyTheme()` 共用同一函数，设置面板预览不会和实际界面两套颜色。
样式表末尾的「v0.4 表面层补丁」只改视觉，**几何、拖拽、落点指示线、滚动条宽度
一律不动**——`.content` 与 `.fav-body` 靠同一个 10px 槽位逐列对齐，改宽度会错位。

## 刻意不做的事

- 不用系统半透明材质（平台表现不同，且会透深色壁纸发灰）
- 不用 `appres://` 自定义协议（图标直接存 data URL）
- 不引入图像 / PE 解析 / 文件对话框以外的第三方 crate
- Windows 不生成 MSI / NSIS 安装器

## 验证

```bash
cargo test                       # Rust 单元测试（在 src-tauri 目录）
pnpm build                        # 前端构建
pnpm tauri build --no-bundle       # Windows 便携版
```

CI 见 `.github/workflows/build.yml`（windows-latest + macos-latest 双 job）。
视觉基线：`design/preview.html`，截图 `design/probe/shots-ui-*.png`。
