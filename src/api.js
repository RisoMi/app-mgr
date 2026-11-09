import { invoke } from '@tauri-apps/api/core'

// 迁移自 quicklaunch 的 electronAPI：旧版是 window.electronAPI 上的白名单 getter，
// 这里把同名能力收进 invoke 封装。A 档 Vue 组件 / store 搬过来时只需换 import，
// 调用点基本不用动 —— 这是「精简架构」里最重要的一条边界：平台差异只留在这一层。
const api = {
  getPlatform: () => invoke('get_platform'),
  ping: () => invoke('ping'),
  loadData: () => invoke('load_data'),
  saveData: (data) => invoke('save_data', { data }),
  launchItem: (path) => invoke('launch_item', { path }),
  setAlwaysOnTop: (on) => invoke('set_always_on_top', { on })
}

export default api
export const tauriAPI = api
