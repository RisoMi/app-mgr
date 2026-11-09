import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { electronAPI } from './api.js'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'

// 旧组件里有直接读 window.electronAPI 的地方（MiniPanel / App.vue 的 safeLog），
// 保留这个全局别名，A 档代码一行都不用改。
window.electronAPI = electronAPI

// 无边框窗口：Tauri 不认 CSS 的 -webkit-app-region，改用 startDragging()。
// 明确排除所有可交互元素，否则点按钮会被当成拖窗口（旧版踩过这个坑）。
window.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || !e.target || !e.target.closest) return
  if (e.target.closest('button, input, textarea, select, a, [contenteditable="true"], [data-no-drag]')) return
  if (e.target.closest('.titlebar, .top-app-bar, .mini-bar')) {
    getCurrentWindow().startDragging().catch(() => {})
  }
})

// Tauri 2 的拖放事件直接给绝对路径数组（不再有 Electron 的 File.path /
// webUtils.getPathForFile）。转成自定义 DOM 事件交给 App.vue 处理，
// 这样拖入高亮 + 导入仍是原来的那套渲染层逻辑。
getCurrentWebview().onDragDropEvent((event) => {
  const t = event.payload && event.payload.type
  if (t === 'enter' || t === 'over') window.dispatchEvent(new Event('ql-drag-enter'))
  else if (t === 'leave') window.dispatchEvent(new Event('ql-drag-leave'))
  else if (t === 'drop') {
    window.dispatchEvent(new CustomEvent('ql-files-drop', {
      detail: { paths: (event.payload && event.payload.paths) || [] }
    }))
  }
}).catch(() => {})

createApp(App).mount('#app')
