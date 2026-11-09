<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import {
  state,
  init,
  visibleItems,
  visibleNodes,
  showToast,
  setImportProgress,
  clearImportProgress,
  appendItems,
  currentCategoryId,
  openCtxMenu,
  closeCtxMenu,
  beginDrag,
  beginGroupDrag,
  markDrop,
  markGroupDrop,
  clearGroupDrop,
  setSnapTarget,
  commitDrop,
  endDrag,
  enterEdit,
  exitEdit,
  isSelected,
  toggleSelect,
  toggleSelectGroup,
  selectAllVisible,
  clearSelection,
  groupSelected,
  deleteSelected,
  toggleFavoriteSelected,
  combineIntoGroup,
  moveIntoGroup,
  removeFromGroup,
  groupMembers,
  closeGroup,
  setOpenGroup,
  persist
} from './store'
import { electronAPI } from './api'
import CategorySidebar from './components/CategorySidebar.vue'
import FavoritesDrawer from './components/FavoritesDrawer.vue'
import MiniPanel from './components/MiniPanel.vue'
import GroupCard from './components/GroupCard.vue'
import GroupModal from './components/GroupModal.vue'
import ItemCard from './components/ItemCard.vue'
import ItemEditDialog from './components/ItemEditDialog.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import ItemContextMenu from './components/ItemContextMenu.vue'
import HelpDialog from './components/HelpDialog.vue'
import MdIcon from './components/MdIcon.vue'

const showDialog = ref(false)
const showSettings = ref(false)
// 操作指南弹窗：给顶栏那个问号按钮用。
// 界面上不再散落「双击启动 / 拖动排序」这类常驻说明 —— 要看就来这一处（内容在 HelpDialog.vue 里）。
const showHelp = ref(false)
const editing = ref(null)
const dragging = ref(false)
// 批量删除的确认框（删除不可撤销，多个项目一次性删掉前必须让用户再确认一次）
const confirmDelete = ref(false)
let dragDepth = 0

// 图标区真正渲染的节点序列：未进组的卡片与组卡**交错**在同一条序列里。
// 「组卡排在哪」是算出来的（= 组内第一个成员的位置），所以分组不需要任何顺序字段。
const nodes = computed(() => visibleNodes())
// 扁平列表仍要留一份：数量文案与「全选」都按**项目数**算，而不是按画了几张卡算
// —— 组卡里装着几项，用户心里就把它们算作几项。
const items = computed(() => visibleItems())
// 分组弹窗当前要显示的那个组：openGroupId 指向的组 + 它在**当前视图**里的成员。
// 成员不足 2 项就不弹 —— 这种组在图标区里本来就不画成组卡（见 store.visibleNodes），
// 于是「弹窗开着」这件事永远对应一张看得见的组卡。
const openGroup = computed(() => {
  const gid = state.openGroupId
  if (!gid) return null
  const g = state.groups.find((x) => x.id === gid)
  if (!g) return null
  const members = groupMembers(gid, items.value)
  return members.length >= 2 ? { group: g, members } : null
})
// 整组成员是否都被选中（组卡在编辑模式下的「选中」外观按整组算，不按单张）
function isGroupSelected(members) {
  return members.length > 0 && members.every((m) => state.selectedIds.includes(m.id))
}
// 右键菜单当前作用于谁：项目卡或分组卡（菜单组件要拿到完整对象才能执行操作）
const ctxItem = computed(() => {
  const c = state.ctxMenu
  if (!c || !c.id) return null
  if (c.kind === 'group') return state.groups.find((g) => g.id === c.id) || null
  return state.items.find((i) => i.id === c.id) || null
})
const ctxKind = computed(() => (state.ctxMenu && state.ctxMenu.kind) || 'item')
const activeTitle = computed(() => {
  if ((state.search || '').trim()) return '搜索'
  if (state.activeCategoryId === 'all') return '全部'
  if (state.activeCategoryId === 'uncat') return '未分类'
  const c = state.categories.find((x) => x.id === state.activeCategoryId)
  return c ? c.name : '全部'
})
// 拖入的落点分类名。注意 store 的 currentCategoryId() 会把「全部 / 未分类」折算成空 id，
// 也就是实际落进「未分类」—— 提示语必须如实说去哪，否则用户会以为进了当前看的分类。
const dropTargetName = computed(() => {
  const id = state.activeCategoryId
  if (id === 'all' || id === 'uncat') return '未分类'
  const c = state.categories.find((x) => x.id === id)
  return c ? c.name : '未分类'
})

// ---------- 拖入导入的进度卡 ----------
// 拖十几个图标进来时，主进程要为**每个**图标起一个进程抽图标（每项 0.5–1.5s），
// 原先这十几秒界面上没有任何反馈，看起来就是"卡住了"。下面两个 computed 把
// 主进程推来的 { done, total, name, phase } 翻译成"进度条走到哪"和"现在在忙什么"。
const importPct = computed(() => {
  const it = state.importing
  if (!it || !it.total) return 0
  return Math.min(100, Math.round((it.done / it.total) * 100))
})
const importNote = computed(() => {
  const it = state.importing
  if (!it) return ''
  if (it.phase === 'queue') return '正在准备…'
  if (it.phase === 'finished') return '完成'
  return it.name ? '正在处理 · ' + it.name : '正在处理…'
})
// 收尾延时句柄：跑满 100% 之后要让进度卡再停一下（见 onItemsProgress 里的注释）
let importHideTimer = null

onMounted(async () => {
  // ⚠️ init() 内部 await loadData：下面「恢复 mini 模式」必须在它之后读 settings，
  // 否则读到的是默认值（mode:'normal'），重启恢复永远不生效。
  await init()

  // 主进程解析完拖入的文件后回传条目：这里**只追加**，绝不整份替换本地状态。
  // （整份替换会把渲染层尚未落盘的改动冲掉，且与主进程写盘形成竞态）
  electronAPI.onItemsAdded((payload) => {
    dragging.value = false
    dragDepth = 0
    const { added, dup } = appendItems(payload && payload.items)
    const bad = (payload && payload.skipped) || 0
    const skipped = dup + bad
    if (added && skipped) showToast(`已添加 ${added} 项，跳过 ${skipped} 项（已存在或路径无效）`)
    else if (added) showToast(`已添加 ${added} 项`)
    else if (skipped) showToast(`跳过 ${skipped} 项（已存在或路径无效）`)
  })

  // 导入进度：主进程每处理一项推一次，这里只负责显示。
  // 收尾的那一帧不立刻收掉，而是把条补到 100% 再停 600ms ——
  // 「停在 11/12 突然消失」比没有进度条更糟，看着像失败了；
  // 600ms 是"够看清跑满、又不至于赖着不走"的长度。
  electronAPI.onItemsProgress((payload) => {
    const p = payload || {}
    if (p.phase === 'finished') {
      setImportProgress({ done: p.total, total: p.total, phase: 'finished' })
      if (importHideTimer) clearTimeout(importHideTimer)
      importHideTimer = setTimeout(() => {
        importHideTimer = null
        clearImportProgress()
      }, 600)
      return
    }
    if (importHideTimer) {
      clearTimeout(importHideTimer)
      importHideTimer = null
    }
    setImportProgress(p)
  })

  // 切换分类时收起右键菜单 / 清拖拽残留 / 退出编辑模式：
  // 否则选中的项目可能已经不在当前视图里，选中态会悬在看不见的卡片上。
  watch(
    () => state.activeCategoryId,
    () => {
      closeCtxMenu()
      endDrag()
      exitEdit()
    }
  )

  // 拖入高亮 + 路径解析。
  // 路径解析走官方 API：把 drop 到的 File 交给 preload 的 webUtils.getPathForFile。
  // （File.path 自 Electron 32 已被官方移除，不能再依赖 f.path）
  window.addEventListener('dragenter', onWinDragEnter)
  window.addEventListener('dragleave', onWinDragLeave)
  window.addEventListener('drop', onWinDrop)
  window.addEventListener('keydown', onWinKeydown)

  // mini 模式：恢复上次退出时的窗口形态（与「记住上次分类」同一套路）。
  // init() 已把 settings.mini 补好默认值，这里照着设运行时状态 + 通知主进程改窗口。
  if (state.settings.mini && state.settings.mini.mode === 'mini') {
    state.miniMode = true
    electronAPI.miniEnter({ ...state.settings.mini, normalTopMost: !!state.settings.topMost })
  } else if (state.settings.topMost) {
    // 上次退出时完整态开着置顶：启动即恢复（顶栏图钉的 on 态由 settings.topMost 驱动）
    electronAPI.winToggleTop(true)
  }
  // mini 态 resize/move：主进程把新几何转来，落盘（persist 自带 200ms 防抖）。
  // 跨运行时下次进 mini 就落回用户调好的大小/位置。
  electronAPI.onMiniGeometry((g) => {
    const m = state.settings.mini
    if (!m || !g) return
    let changed = false
    if (g.width && Math.abs(g.width - m.w) > 1) {
      m.w = g.width
      changed = true
    }
    if (g.height && Math.abs(g.height - m.h) > 1) {
      m.h = g.height
      changed = true
    }
    if (Number.isFinite(g.x) && m.x !== g.x) {
      m.x = g.x
      changed = true
    }
    if (Number.isFinite(g.y) && m.y !== g.y) {
      m.y = g.y
      changed = true
    }
    if (changed) persist()
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('dragenter', onWinDragEnter)
  window.removeEventListener('dragleave', onWinDragLeave)
  window.removeEventListener('drop', onWinDrop)
  window.removeEventListener('keydown', onWinKeydown)
  if (importHideTimer) clearTimeout(importHideTimer)
})

function openNew() {
  editing.value = null
  showDialog.value = true
}
function openEdit(item) {
  editing.value = item
  showDialog.value = true
}
function onSaved() {
  showDialog.value = false
  editing.value = null
}

// 松手落到某张卡上，两条语义二选一：
// ① 在这张卡上**停住过**（卡面已张开成吸附态）→ 与它收成一个分组；
// ② 否则就是最普通的排序落点。
function onDropItem(mark) {
  if (state.snapTargetId && state.snapTargetId === mark.id) {
    const ids = state.dragIds.length ? state.dragIds.slice() : [state.dragId]
    const g = combineIntoGroup(mark.id, ids)
    endDrag()
    if (g) showToast(`已收进「${g.name}」（${groupMembers(g.id).length} 项）`)
    return
  }
  markDrop(mark)
  // commitDrop 返回实际移动的条数：编辑模式下拖整批选中项时会 > 1，提示要如实说
  const n = commitDrop()
  if (n > 1) showToast(`已调整 ${n} 项顺序`)
  else if (n === 1) showToast('已调整顺序')
}
// 拖到组卡上松手 → 并入这个组（组卡只表示「收纳口」，不判左右半）
function onDropIntoGroup(gid) {
  const ids = state.dragIds.length ? state.dragIds.slice() : [state.dragId]
  const n = moveIntoGroup(gid, ids)
  endDrag()
  const g = state.groups.find((x) => x.id === gid)
  if (n && g) showToast(`已收进「${g.name}」（${groupMembers(g.id).length} 项）`)
}
// 拖动经过某张卡：先把排序落点更新掉（吸附由卡片自己那个「停住计时」决定）
function onCardDragOver(mark) {
  markDrop(mark)
}
// 拖动经过组卡：高亮「要被吸进去了」
function onCardDragInto(gid) {
  markGroupDrop(gid)
}
// 指针从组卡上离开：把「收纳口」高亮收回（少了这一步它会一直亮着）
function onCardDragLeaveGroup() {
  clearGroupDrop()
}
// 卡片报告「在我这儿停住了」→ 立起吸附标记（空串 = 撤销）
function onSnapHover(id) {
  setSnapTarget(id)
}
// 整组拖动：拖的是组卡，但带走的仍是组内成员的 id 数组，
// 于是排序（commitDrop）与归类（moveItemToCategory）一行都不用改就支持整组。
function onGroupDragStart(gid) {
  beginGroupDrag(gid)
}
// 从分组弹窗里拖出来的卡片：记住来源组 —— 松手在弹窗之外（遮罩上）就是「移出分组」
function onModalItemDragStart({ id, groupId }) {
  beginDrag(id, groupId)
}
// 卡片右键 → 把菜单挂在鼠标位置（边界翻转与「点外面关掉」由菜单组件自己负责）
function onCardMenu({ id, x, y, kind }) {
  openCtxMenu(id, x, y, kind)
}

// —— 编辑模式（长按图标进入）——
// 长按任一张卡片 → 全部图标进入编辑态（抖动 + 可点选），主区底部浮出操作条。
// 在分组弹窗里长按也一样：弹窗**不关**，编辑的就是它里面那几张（见 store.enterEdit）。
function onCardLongPress() {
  enterEdit()
}
// 编辑模式下单击卡片 = 切换选中（启动/菜单都由卡片自己在非编辑模式下处理）
function onEditToggleSelect(id) {
  toggleSelect(id)
}
// 编辑模式下单击组卡 = 整组一起选中 / 取消 —— 分组是一个单位，整组移动要有抓手
function onGroupToggleSelect(gid) {
  toggleSelectGroup(gid)
}
// 编辑模式操作条上的「分组」：选中项收成一个组。
// 组卡在编辑模式下**不再摊平**，所以不退出编辑模式：刚建好的组卡就出现在原地，
// 想接着整组挪走、或顺手再收一个组，都不用重新长按一次。
function onGroupSelected() {
  const g = groupSelected()
  if (g) showToast(`已把 ${groupMembers(g.id).length} 项收进「${g.name}」`)
}
// 操作条上的「移出分组」（只在分组弹窗里出现）：把选中的成员退回图标区
function onRemoveSelectedFromGroup() {
  const n = removeFromGroup(state.selectedIds.slice())
  clearSelection()
  if (n) showToast(`已移出 ${n} 项`)
}
function onToggleGroup(gid) {
  setOpenGroup(gid)
}
// 关掉分组弹窗：它和「收工不编辑了」是同一件事，所以顺手退出编辑模式 ——
// 那次编辑模式本来就是为这一组开的，留着只会让操作条悬在一个已经关掉的弹窗上。
function onGroupModalClose() {
  closeGroup()
  exitEdit()
}
// 从弹窗里把卡片拖到窗口外松手 → 移出分组
function onModalRemoveMembers(ids) {
  endDrag()
  const n = removeFromGroup(ids)
  clearSelection() // 它们已经离开这一组了，选中态留在遮罩后面的卡片上毫无意义
  if (n) showToast(`已移出 ${n} 项`)
}
// 最近一次按下是不是落在「空白处」。初值取 true：没有 pointerdown 陪伴的 click
// （合成事件、脚本触发）沿用老行为 —— 按 target 判，不去猜按下的位置。
let pressInBlank = true
// 编辑模式下点「空白处」退出。卡片自身会冒泡到这里，用 closest 放过。
// 收藏夹抽屉（那枚小三角、抽屉里的卡片）同样要放过 —— 它不算「空白处」：
// 点它是在操作抽屉，顺手把编辑模式一起收掉会让人莫名其妙（选中的东西全没了）。
//
// ⚠️ 判据看的是**按下的那一刻落在哪**，不是松手时弹到哪（pressInBlank 那一对）。
// 编辑态的抖动是 transform 动画，卡片边缘会随着指针下那张卡微动，
// 松手瞬间 click 的 target 就可能落到 `.grid` 上、被当成「点了空白处」，
// 刚进去的编辑模式被自己这一下收掉（这条真踩过：长按后编辑模式只活了 200ms）。
// 按下时在卡片里，这一下就仍然算卡片点击；用户在空白处按下再松手，才是真的「点空白」。
function onMainPointerDown(e) {
  const t = e.target
  pressInBlank = !(t && t.closest && t.closest('.card, .fav-drawer'))
}
function onMainClick(e) {
  const t = e.target
  const inCard = !pressInBlank || !!(t && t.closest && t.closest('.card, .fav-drawer'))
  pressInBlank = true // 复位成「空白」，等下一次 pointerdown 重新判定
  if (!state.editMode) return
  if (inCard) return
  exitEdit()
}
function askDelete() {
  if (!state.selectedIds.length) return
  confirmDelete.value = true
}
// 选中项是不是**全都**已在收藏夹里 —— 决定操作条上那颗按钮的语义：
// 全都收藏了就显示「取消收藏」，否则显示「收藏」（部分已收藏时按「加进来」处理）。
const allSelectedFav = computed(
  () => state.selectedIds.length > 0 && state.selectedIds.every((id) => state.favorites.includes(id))
)
function onToggleFavorite() {
  const r = toggleFavoriteSelected()
  if (r.removed) showToast(`已从收藏夹移除 ${r.removed} 项`)
  else if (r.added) showToast(`已收藏 ${r.added} 项 · 点图标区顶部的小三角可查看`)
}
function doDelete() {
  const n = deleteSelected()
  confirmDelete.value = false
  if (n) showToast(`已删除 ${n} 项`)
}
// Esc：按「从外到里」的顺序逐层收 —— 操作指南 → 删除确认框 → 右键菜单 → 收藏夹抽屉 →
// 就地改名 → 分组弹窗 → 编辑模式。一次只收一层：菜单正开着时按 Esc，不该把底下的抽屉也一起收掉。
// （一层都没开时什么都不做，不会误退出/误关窗）
function onWinKeydown(e) {
  if (e.key !== 'Escape') return
  // 操作指南是最后盖上去的一层，所以最先被 Esc 收掉
  if (showHelp.value) {
    showHelp.value = false
    return
  }
  if (confirmDelete.value) {
    confirmDelete.value = false
    return
  }
  if (state.ctxMenu) {
    closeCtxMenu()
    return
  }
  if (state.favOpen) {
    // favOpen 由 store 持有（抽屉组件也读写它），这里直接置回去即可
    state.favOpen = false
    return
  }
  if (state.renameGroupId) {
    state.renameGroupId = null
    return
  }
  if (state.openGroupId) {
    // 分组弹窗是最内的一层：Esc 先收它（连带退出为它开的编辑模式）
    onGroupModalClose()
    return
  }
  if (state.editMode) exitEdit()
}

// ---- mini 模式（完整态 <-> mini 态切换，同一扇窗）----
// 进入：通知主进程收紧窗口 + 亚克力 + 置顶（几何/置顶参数来自持久化的 settings.mini）；
// 退出：放回窗口下限与不透明底色。界面切到哪一版由 state.miniMode 决定（模板 v-if）。
// 数据零同步成本 —— 两个形态是同一个 JS 实例、同一份 store，收藏变了界面直接跟着变。
function enterMini() {
  if (state.miniMode) return
  state.miniMode = true
  state.settings.mini.mode = 'mini'
  persist()
  // normalTopMost 一并带给主进程：退出 mini 时按它恢复完整态置顶，
  // 否则「完整态开着置顶进 mini」退出后置顶就丢了（见 mini-window.js）。
  electronAPI.miniEnter({ ...state.settings.mini, normalTopMost: !!state.settings.topMost })
}
function exitMini() {
  if (!state.miniMode) return
  state.miniMode = false
  state.settings.mini.mode = 'normal'
  persist()
  electronAPI.miniExit()
}
function onMiniToggleTop(flag) {
  state.settings.mini.alwaysOnTop = !!flag
  persist()
  electronAPI.miniToggleTop(!!flag)
}

// ---- 完整态置顶（顶栏图钉）----
// 与 mini 态置顶（settings.mini.alwaysOnTop）各自独立：两种形态的置顶偏好分开存，
// 进/退 mini 互不打扰（主进程侧见 mini-window.js 的 normalTopMost）。
function toggleTopMost() {
  const on = !state.settings.topMost
  state.settings.topMost = on
  persist()
  electronAPI.winToggleTop(on)
}

function hasFiles(dt) {
  return !!(dt && dt.types && Array.from(dt.types).includes('Files'))
}

function onWinDragEnter(e) {
  // mini 是只读面板：拖入请先返回完整模式（提示语在 onWinDrop）
  if (state.miniMode) return
  if (hasFiles(e.dataTransfer)) {
    dragDepth += 1
    dragging.value = true
  }
}
function onWinDragLeave() {
  if (state.miniMode) return
  dragDepth -= 1
  if (dragDepth <= 0) {
    dragDepth = 0
    dragging.value = false
  }
}
// 拖入落库：用官方 webUtils.getPathForFile 解析每个 File 的真实磁盘路径
function onWinDrop(e) {
  // mini 是只读面板（Lei 2026-10-26 拍板的边界）：拖入请先回完整模式。
  // 静默忽略比「能拖但半途出错」好，但给一句提示，否则用户只会以为程序坏了。
  if (state.miniMode) {
    try {
      e.preventDefault()
    } catch {}
    showToast('mini 模式下不能添加，请先点右上角返回完整模式')
    return
  }
  try {
    e.preventDefault()
  } catch {}
  dragging.value = false
  dragDepth = 0
  const dt = e.dataTransfer
  const files = dt && dt.files ? Array.from(dt.files) : []
  if (!files.length) return // 内部拖动排序，不涉及文件落库
  safeLog('[DnD] 渲染层 drop 文件数=' + files.length)
  const paths = []
  for (const f of files) {
    let p = ''
    try {
      p = electronAPI.getPathForFile(f)
    } catch (err) {
      safeLog('[DnD] getPathForFile 异常: ' + (err && err.message ? err.message : String(err)))
    }
    if (p) paths.push(p)
  }
  // 兜底：极少数情况 webUtils 返回空时，尝试 text/uri-list / text/plain
  if (!paths.length && dt && typeof dt.getData === 'function') {
    for (const key of ['text/uri-list', 'text/plain']) {
      const raw = dt.getData(key) || ''
      for (const line of raw.split(/\r?\n/)) {
        const s = line.trim()
        if (!s || s.startsWith('#')) continue
        if (s.startsWith('file://')) {
          const m = s.replace(/^file:\/\//, '').replace(/^\/([a-z]:)/i, '$1')
          paths.push(decodeURIComponent(m).replace(/\//g, '\\'))
        } else if (/^[a-z]:[\\/]/i.test(s)) {
          paths.push(s)
        }
      }
      if (paths.length) break
    }
  }
  safeLog('[DnD] 渲染层 drop 解析路径 -> ' + JSON.stringify(paths))
  if (paths.length) {
    try {
      // 带上当前分类（虚拟分类「全部/未分类」会被折算成空串，即未分类）
      electronAPI.notifyFilesDropped([...new Set(paths)], currentCategoryId())
    } catch (err) {
      safeLog('[DnD] notifyFilesDropped 异常: ' + (err && err.message ? err.message : String(err)))
    }
  }
}

// Tauri 2 的拖放事件由 api.js 转发成下面这几个自定义事件：
// 它直接给绝对路径数组，比 Electron 的 getPathForFile(File) 更可靠且无需协议。
function onTauriFilesDrop(paths) {
  dragging.value = false
  dragDepth = 0
  if (!Array.isArray(paths) || !paths.length) return
  safeLog('[DnD] Tauri drop 路径 -> ' + JSON.stringify(paths))
  try {
    electronAPI.notifyFilesDropped([...new Set(paths)], currentCategoryId())
  } catch (err) {
    safeLog('[DnD] notifyFilesDropped 异常: ' + (err && err.message ? err.message : String(err)))
  }
}
window.addEventListener('ql-files-drop', (e) => onTauriFilesDrop(e.detail && e.detail.paths))
window.addEventListener('ql-drag-enter', () => { dragging.value = true })
window.addEventListener('ql-drag-leave', () => { dragDepth = 0; dragging.value = false })

// 用实时 window.electronAPI 写日志，避免导入快照/桥调用静默失败导致无日志
function safeLog(msg) {
  try {
    const d = window.electronAPI && window.electronAPI.dndLog
    if (d) d(msg)
  } catch {}
}
</script>

<template>
  <div
    class="app"
    :data-style="state.settings.cardStyle"
    :data-icon-size="state.settings.iconSize"
    :class="{
      'drag-active': dragging,
      'edit-mode': state.editMode,
      'group-open': !!openGroup,
      'mini-on': state.miniMode
    }"
  >
    <!-- mini 模式：同一扇窗切成只读小窗（无侧边栏 + Win11 亚克力 + 只显示收藏 + 可置顶）。
         完整态的所有版块（侧栏 / 图标区 / 各浮层）整体在下面那个 v-else 里，
         两种形态的代码路径完全分开，互不污染。 -->
    <MiniPanel v-if="state.miniMode" @exit="exitMini" @toggle-top="onMiniToggleTop" />
    <template v-else>
      <CategorySidebar @open-settings="showSettings = true" />

    <main class="main" @click="onMainClick" @pointerdown="onMainPointerDown">
      <header class="top-app-bar">
        <div>
          <!-- 标题行 = 分类名 + 操作指南入口。
               副标题里原来塞着「双击启动 / 拖动排序 / 停住成组 / 按住编辑」一大串，
               现在整段收进问号弹窗（HelpDialog.vue），这里只留一句数量。
               问号按钮落在顶栏这条拖拽带上，样式里必须给它 no-drag，否则点击会被拖窗口吞掉。 -->
          <div class="title-row">
            <h1>{{ activeTitle }}</h1>
            <button
              type="button"
              class="help-btn"
              title="操作指南"
              aria-label="操作指南"
              @click="showHelp = true"
            >
              <MdIcon name="help" :size="18" />
            </button>
          </div>
          <div class="sub">共 {{ items.length }} 项</div>
        </div>
        <!-- 右侧胶囊钮组（Lei 2026-10-27 拍板：mini 入口从标题旁移到右侧，加完整态置顶，
             去掉 mini 文字）。容器与钮的外观照 mini 面板标题栏的 .mini-actions/.mini-btn：
             入口控件与目标面板用同一件「容器」语言。图钉 = 完整态置顶（偏好持久化
             settings.topMost，启动恢复；进 mini 时作为 normalTopMost 带给主进程，退出时恢复）；
             四角 = 进 mini 模式。⚠️ 都在拖拽带上，钮自己 no-drag（.top-btn 里声明）。
             ⚠️ mini 钮保留 .mini-entry class：测试台按 class/aria-label 点它进 mini。 -->
        <div class="top-actions">
          <button
            type="button"
            class="top-btn top-pin"
            :class="{ on: state.settings.topMost }"
            :title="state.settings.topMost ? '取消置顶' : '置顶窗口'"
            :aria-label="state.settings.topMost ? '取消置顶' : '置顶窗口'"
            :aria-pressed="state.settings.topMost ? 'true' : 'false'"
            @click="toggleTopMost"
          >
            <MdIcon name="pin" :size="16" />
          </button>
          <button
            type="button"
            class="mini-entry top-btn"
            title="mini 模式（只显示收藏的小窗）"
            aria-label="mini 模式"
            @click="enterMini"
          >
            <MdIcon name="fullscreen" :size="16" />
          </button>
        </div>
      </header>

      <!-- 收藏夹抽屉：常驻入口只有一枚吸附在图标区顶边的小倒三角，点它才把抽屉拉开。
           抽屉里是图标区同款卡片，右键复用同一套菜单，所以事件直接接到 onCardMenu。 -->
      <FavoritesDrawer @menu="onCardMenu" />

      <div class="content">
        <div v-if="nodes.length" class="grid">
          <!-- 一条序列里交错着两种节点：单个项目卡，以及「收起来的组」（组卡）。
               组卡占 2×2 格（正方形，比普通卡大一圈），编辑模式下也保持成组 ——
               点它 = 整组选中，拖它 = 整组移动；要看组里的东西就点开它，
               那是浮在窗口上的一扇小窗（GroupModal），不再就地撑开图标区。 -->
          <template v-for="(n, idx) in nodes" :key="n.key">
            <GroupCard
              v-if="n.kind === 'group'"
              :group="n.group"
              :members="n.members"
              :dragging="state.dragGroupId === n.group.id"
              :menu-target="
                !!state.ctxMenu && state.ctxMenu.kind === 'group' && state.ctxMenu.id === n.group.id
              "
              :drop-side="
                state.dropMark && n.members[0] && state.dropMark.id === n.members[0].id
                  ? state.dropMark.side
                  : ''
              "
              :drop-axis="
                state.dropMark && n.members[0] && state.dropMark.id === n.members[0].id
                  ? state.dropMark.axis
                  : ''
              "
              :drop-into="state.dropGroupId === n.group.id"
              :edit-mode="state.editMode"
              :selected="state.editMode && isGroupSelected(n.members)"
              :wiggle-delay="-(idx % 6) * 0.06"
              @menu="onCardMenu"
              @drag-start="onGroupDragStart(n.group.id)"
              @drag-over-item="onCardDragOver"
              @drop-item="onDropItem"
              @drag-into="onCardDragInto"
              @drop-into="onDropIntoGroup"
              @drag-leave-group="onCardDragLeaveGroup"
              @drag-end="endDrag"
              @long-press="onCardLongPress"
              @toggle-select="onGroupToggleSelect"
            />
            <ItemCard
              v-else
              :item="n.item"
              :dragging="state.dragIds.includes(n.item.id)"
              :menu-target="!!state.ctxMenu && state.ctxMenu.id === n.item.id"
              :drop-side="
                state.dropMark && state.dropMark.id === n.item.id ? state.dropMark.side : ''
              "
              :drop-axis="
                state.dropMark && state.dropMark.id === n.item.id ? state.dropMark.axis : ''
              "
              :edit-mode="state.editMode"
              :selected="state.editMode && isSelected(n.item.id)"
              :snap-target="state.snapTargetId === n.item.id"
              :wiggle-delay="-(idx % 6) * 0.06"
              @menu="onCardMenu"
              @drag-start="beginDrag"
              @drag-over-item="onCardDragOver"
              @drop-item="onDropItem"
              @drag-end="endDrag"
              @long-press="onCardLongPress"
              @toggle-select="onEditToggleSelect"
              @snap-hover="onSnapHover"
            />
          </template>
          <div class="card add-card" @click="openNew">
            <div class="plus">+</div>
            <div class="hint">添加</div>
          </div>
        </div>
        <div v-else class="empty">
          <template v-if="state.search && state.search.trim()"
            >没有匹配「{{ state.search.trim() }}」的快捷方式。</template
          >
          <template v-else
            >这个分类还没有项目。点击网格里的「+ 添加」，或从资源管理器拖入文件/文件夹直接添加。</template
          >
        </div>
      </div>
    </main>

    <!-- 编辑模式：主区底部悬浮操作条（全选 / 分组 / 收藏 / 删除）。
         position:fixed + left:288px —— 侧栏是固定 288px 列，这样它居中于「图标区」而不是整扇窗。 -->
    <div v-if="state.editMode" class="edit-bar">
      <span class="edit-count">已选 {{ state.selectedIds.length }} 项</span>
      <button class="edit-btn" @click="selectAllVisible()">
        <MdIcon name="selectAll" :size="18" />
        <span>全选</span>
      </button>
      <!-- 分组：把选中的项目收进一个新组。少于 2 项没有意义（会被自动解散），所以禁用。
           在分组弹窗里编辑时，这颗按钮换成「移出分组」—— 那一刻的主题是「从组里往外拿」，
           再摆一个「分组」既用不上、又容易被误点。 -->
      <button
        v-if="!openGroup"
        class="edit-btn"
        :disabled="state.selectedIds.length < 2"
        @click="onGroupSelected"
      >
        <MdIcon name="folderAdd" :size="18" />
        <span>分组</span>
      </button>
      <button
        v-else
        class="edit-btn"
        :disabled="!state.selectedIds.length"
        @click="onRemoveSelectedFromGroup"
      >
        <MdIcon name="folderOpen" :size="18" />
        <span>移出分组</span>
      </button>
      <!-- 收藏 / 取消收藏：选中项全都已收藏时语义翻转成「取消收藏」 -->
      <button class="edit-btn" :disabled="!state.selectedIds.length" @click="onToggleFavorite">
        <MdIcon :name="allSelectedFav ? 'star' : 'starBorder'" :size="18" />
        <span>{{ allSelectedFav ? '取消收藏' : '收藏' }}</span>
      </button>
      <button class="edit-btn danger" :disabled="!state.selectedIds.length" @click="askDelete">
        <MdIcon name="delete" :size="18" />
        <span>删除</span>
      </button>
      <!-- 这里原本还有一条 .edit-hint 药丸复述「拖动已选中的卡…」。
           2026-09-23 按 Lei 要求收进操作指南：编辑条只留功能（计数 + 按钮），
           说明统一在顶栏问号那本指南里 —— 同一件事不再有两处版本。
           对应条目见 HelpDialog.vue 的「编辑模式」一节，改动前请两边一起对。 -->
    </div>

    <!-- 删除不可撤销：多个项目一次性删掉前先确认 -->
    <div v-if="confirmDelete" class="mask" @click.self="confirmDelete = false">
      <div class="dialog confirm-dialog">
        <h2>删除项目</h2>
        <div class="confirm-text">
          确定删除选中的 {{ state.selectedIds.length }} 个项目吗？此操作不可撤销。
        </div>
        <div class="dialog-actions">
          <button class="btn ghost" @click="confirmDelete = false">取消</button>
          <button class="btn danger" @click="doDelete">删除</button>
        </div>
      </div>
    </div>

    <!-- 分组弹窗：点组卡浮起来的一扇小窗（成员网格 + 长按编辑 + 把卡拖到窗口外移出分组）。
         判据用 openGroup 而不是 state.openGroupId：组在当前视图里不足 2 项时 openGroup
         自己会变成 null —— 那种组本来就画不成组卡，弹窗也就无从谈起。 -->
    <GroupModal
      v-if="openGroup"
      :group="openGroup.group"
      :members="openGroup.members"
      :edit-mode="state.editMode"
      @close="onGroupModalClose"
      @menu="onCardMenu"
      @drag-start="onModalItemDragStart"
      @drag-over-item="onCardDragOver"
      @drop-item="onDropItem"
      @drag-end="endDrag"
      @long-press="onCardLongPress"
      @toggle-select="onEditToggleSelect"
      @remove-members="onModalRemoveMembers"
    />

    <ItemEditDialog v-if="showDialog" :item="editing" :default-category-id="state.activeCategoryId" @close="onSaved" />
    <SettingsDialog v-if="showSettings" @close="showSettings = false" />
    <!-- 操作指南：顶栏问号按钮打开（它自己带遮罩，点遮罩即关） -->
    <HelpDialog v-if="showHelp" @close="showHelp = false" />
    <!-- 右键菜单：后续要加操作，往 ItemContextMenu 的 MENU 数组里加一条即可 -->
    <ItemContextMenu
      v-if="state.ctxMenu && ctxItem"
      :item="ctxItem"
      :kind="ctxKind"
      :x="state.ctxMenu.x"
      :y="state.ctxMenu.y"
      @close="closeCtxMenu"
      @edit="openEdit"
    />

    <!-- 拖入悬停：整窗边缘跑马灯（四条边首尾相接、顺时针流转）+ 底部小胶囊提示。
         原先的中心闪烁卡已撤掉 —— 它和整窗语言不协调，且抢走了「整扇窗都是落点」这个信息。 -->
    <div v-if="dragging" class="drop-ring" aria-hidden="true">
      <div class="drop-frame"></div>
      <span class="ants top"></span>
      <span class="ants right"></span>
      <span class="ants bottom"></span>
      <span class="ants left"></span>
        <div class="drop-hint">松开即可添加到「{{ dropTargetName }}」</div>
      </div>
    </template>

    <!-- 底部信息栈：导入进度卡 + 提示条共用一列。
         以前提示条自己 `position: fixed` 定位，再加一块底部信息时两边都要算「谁让位给谁」；
         换成一列 flex 之后顺序与间距由布局给，不用手算偏移。 -->
    <div class="bottom-stack">
      <div
        v-if="state.importing"
        class="import-card"
        role="progressbar"
        aria-label="正在添加项目"
        :aria-valuenow="state.importing.done"
        aria-valuemin="0"
        :aria-valuemax="state.importing.total"
      >
        <div class="ic-head">
          <span class="ic-title">正在添加 {{ state.importing.total }} 个项目…</span>
          <span class="ic-count">{{ state.importing.done }} / {{ state.importing.total }}</span>
        </div>
        <div class="ic-track"><div class="ic-fill" :style="{ width: importPct + '%' }"></div></div>
        <div class="ic-note">{{ importNote }}</div>
      </div>
      <div v-if="state.toast" class="snackbar">{{ state.toast }}</div>
    </div>
  </div>
</template>
