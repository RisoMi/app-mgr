import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { LogicalSize, LogicalPosition } from '@tauri-apps/api/dpi'
import { open as openDialog } from '@tauri-apps/plugin-dialog'

// 迁移自 quicklaunch 的 electronAPI：所有 A 档组件/store 都 import { electronAPI }，
// 这里保留同名导出，调用形状一一对应，平台差异只留在这一个文件里。
// 能用 Tauri JS API 直接做的（窗口 / mini / 拖放 / 事件）不再绕 Rust 命令，
// 只有读盘、抽图标、启动、打开位置这些系统能力才 invoke。

const win = () => getCurrentWindow()
let inMini = false
let normalBounds = null
let normalTopMost = false

function clampSize(n, dflt, lo, hi) {
  const v = Number(n)
  return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt
}

async function winState() {
  const w = win()
  try {
    return { maximized: await w.isMaximized(), focused: await w.isFocused() }
  } catch {
    return { maximized: false, focused: true }
  }
}

// 事件订阅包装：Tauri 的 listen 是异步的，但旧代码拿返回值当 unlisten 同步用。
function on(event, cb) {
  let disposed = false
  let un = () => {}
  listen(event, (e) => {
    if (!disposed) {
      try { cb(e.payload) } catch (err) { console.error('[event]', event, err) }
    }
  }).then((fn) => {
    if (disposed) fn()
    else un = fn
  }).catch(() => {})
  return () => { disposed = true; un() }
}

// 裁掉图标自带透明边距（仅「仅图标」样式用），纯 Canvas 实现，零 Rust 依赖。
async function trimLogo(src) {
  if (!src || !src.startsWith('data:')) return src
  try {
    const img = new Image()
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = src })
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    if (!c.width || !c.height) return src
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)
    let l = width, t = height, r = -1, b = -1
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (data[(y * width + x) * 4 + 3] > 8) {
          if (x < l) l = x
          if (x > r) r = x
          if (y < t) t = y
          if (y > b) b = y
        }
      }
    }
    if (r < 0 || (l === 0 && t === 0 && r === width - 1 && b === height - 1)) return src
    const out = document.createElement('canvas')
    out.width = r - l + 1
    out.height = b - t + 1
    out.getContext('2d').drawImage(c, l, t, out.width, out.height, 0, 0, out.width, out.height)
    return out.toDataURL('image/png')
  } catch {
    return src
  }
}

// ---- mini 形态（同一扇窗，逻辑对齐旧 mini-window.js）----
// ⚠️ 退出时先把 inMini 置 false 再改尺寸：否则恢复完整态的 resize 会把
// 1120x740 回传渲染层写进 settings.mini.w/h，下次进 mini 就不缩小了。
async function miniEnter(pref = {}) {
  if (inMini) return { ok: true }
  const w = win()
  normalTopMost = pref.normalTopMost === true
  try {
    const sf = await w.scaleFactor()
    const s = await w.outerSize()
    const p = await w.outerPosition()
    normalBounds = { width: s.width / sf, height: s.height / sf, x: p.x / sf, y: p.y / sf }
    if (await w.isMaximized()) await w.unmaximize()
    const width = clampSize(pref.w, 380, 240, 820)
    const height = clampSize(pref.h, 520, 320, 560)
    await w.setMinSize(new LogicalSize(240, 320))
    if (typeof pref.x === 'number' && typeof pref.y === 'number') {
      await w.setPosition(new LogicalPosition(pref.x, pref.y))
    }
    await w.setSize(new LogicalSize(width, height))
    await w.setAlwaysOnTop(pref.alwaysOnTop !== false)
    inMini = true
  } catch (e) {
    return { ok: false, error: String(e) }
  }
  return { ok: true }
}

async function miniExit() {
  const w = win()
  if (!inMini) return { ok: true }
  inMini = false
  try {
    if (normalBounds) {
      await w.setMinSize(new LogicalSize(820, 560))
      await w.setSize(new LogicalSize(normalBounds.width, normalBounds.height))
      await w.setPosition(new LogicalPosition(normalBounds.x, normalBounds.y))
    } else {
      await w.setMinSize(new LogicalSize(820, 560))
    }
    await w.setAlwaysOnTop(normalTopMost)
  } catch (e) {
    return { ok: false, error: String(e) }
  }
  return { ok: true }
}

function geometrySubscribers(cb) {
  let disposed = false
  const push = async () => {
    if (disposed || !inMini) return
    try {
      const w = win()
      const sf = await w.scaleFactor()
      const s = await w.outerSize()
      const p = await w.outerPosition()
      cb({
        width: Math.round(s.width / sf),
        height: Math.round(s.height / sf),
        x: Math.round(p.x / sf),
        y: Math.round(p.y / sf)
      })
    } catch { /* 窗口正在变化时忽略 */ }
  }
  let unR = () => {}, unM = () => {}
  win().onResized(() => push()).then((f) => { if (disposed) f(); else unR = f }).catch(() => {})
  win().onMoved(() => push()).then((f) => { if (disposed) f(); else unM = f }).catch(() => {})
  return () => { disposed = true; unR(); unM() }
}

export const electronAPI = {
  // ---- 数据 ----
  loadData: () => invoke('load_data'),
  saveData: (data) => invoke('save_data', { data }),

  // ---- 文件选择（官方 dialog 插件）----
  pickFile: async () => {
    const p = await openDialog({ multiple: false, directory: false })
    return typeof p === 'string' ? p : null
  },
  pickFolder: async () => {
    const p = await openDialog({ multiple: false, directory: true })
    return typeof p === 'string' ? p : null
  },

  // 图标直接以 data URL 存在 app.json 里，不再单独落盘、不需要自定义协议。
  saveLogo: async (dataUrl) => dataUrl,
  removeLogo: async () => true,
  extractIcon: (path) => invoke('extract_icon', { path }),
  trimLogo,
  pathInfo: async () => ({}),

  // ---- 启动 / 定位 ----
  launchItem: (payload) => invoke('launch_item', { payload }),
  revealItem: (path) => invoke('reveal_item', { path }),
  prewarmTarget: async () => {},

  // ---- 自绘交通灯 ----
  winMinimize: () => win().minimize(),
  winToggleMaximize: async () => {
    await win().toggleMaximize()
    return winState()
  },
  winClose: () => win().close(),
  winState,
  onWinState: (cb) => {
    let disposed = false
    const push = async () => { if (!disposed) cb(await winState()) }
    let unF = () => {}, unR = () => {}
    win().onFocusChanged(() => push()).then((f) => { if (disposed) f(); else unF = f }).catch(() => {})
    win().onResized(() => push()).then((f) => { if (disposed) f(); else unR = f }).catch(() => {})
    return () => { disposed = true; unF(); unR() }
  },
  winToggleTop: (on) => win().setAlwaysOnTop(!!on),

  // ---- mini ----
  miniEnter,
  miniExit,
  miniToggleTop: (flag) => win().setAlwaysOnTop(!!flag),
  onMiniGeometry: geometrySubscribers,

  // ---- 拖入导入 ----
  getPathForFile: () => '',
  notifyFilesDropped: (paths, categoryId) => invoke('import_files', { paths, categoryId }),
  dndLog: (msg) => console.log('[QL]', msg),
  onItemsAdded: (cb) => on('items-added', cb),
  onItemsProgress: (cb) => on('items-progress', cb)
}

export default electronAPI
