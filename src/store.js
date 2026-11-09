import { reactive, watch } from 'vue'
import { electronAPI } from './api'
import { applyTheme, isThemeId, DEFAULT_THEME, DEFAULT_MODE } from './themes'

// 卡片显示样式（设置里切换，随 app.json 一起落盘）：
//  card   —— 带底色 / 圆角 / 阴影的方块卡
//  native —— 还原 原生图标外观：透明背景，只有图标 + 名称，贴合桌面与资源管理器的图标视图
//  icon   —— 只显示图标、不显示名称，最紧凑
export const CARD_STYLES = [
  { id: 'card', name: '卡片' },
  { id: 'native', name: '原生' },
  { id: 'icon', name: '仅图标' }
]
// 默认给「原生」：卡片外壳是用户反馈“卡片太大”的主因，
// 这个样式一屏能放下的项目最多；想回到卡片外观，设置里一键可切。
export const DEFAULT_CARD_STYLE = 'native'
export function isCardStyle(v) {
  return CARD_STYLES.some((it) => it.id === v)
}

// 图标尺寸（设置 → 图标显示 → 图标尺寸）：24 / 32 / 48，默认 32。
// 三套显示样式都跟随 —— 卡片最小宽、图标圆角、兜底字母/文件夹图标/加号的字号
// 全部由 CSS 里的 --icon-size 用 calc 推出（见 styles.css 的 .app 段），
// 这样以后加尺寸档只改一处，不会出现「图标变了卡片没变」。
export const ICON_SIZES = [
  { id: 24, label: '24 × 24', demo: 18 },
  { id: 32, label: '32 × 32', demo: 24 },
  { id: 48, label: '48 × 48', demo: 36 }
]
export const DEFAULT_ICON_SIZE = 32
export function isIconSize(v) {
  return ICON_SIZES.some((it) => it.id === Number(v))
}

// 七色板：分组文件夹的颜色从这里取（Lei 2026-09-23：「文件夹图标的颜色每次都从
// 彩虹的 7 种颜色随机，用户也可以自行更换」）。同一组颜色也用在卡片兜底字母头像上 ——
// 两处本来各写了一份一模一样的数组，留在这里当唯一来源，免得哪天只改了其中一份。
export const GROUP_COLORS = [
  '#3b82f6', // 蓝
  '#10b981', // 绿
  '#f59e0b', // 琥珀
  '#ef4444', // 红
  '#8b5cf6', // 紫
  '#06b6d4', // 青
  '#ec4899' // 粉
]
// 色板成员判定：回答「这 7 个点里有没有一个是当前色」（菜单上给当前色带勾）。
// ⚠️ 它**不是**组色的合法性判定，那是 isColor（任意 hex）：滑条时代调出来的自定义色
// 仍躺在盘上、也照旧画得出来 —— 删掉控件不等于要把别人的颜色改掉。
export function isGroupColor(v) {
  return GROUP_COLORS.includes(v)
}
// 新组的颜色：**真的随机**，不是按 id 取稳定色 ——
// 「新建的组颜色自己会变」是刻意的（一眼看出这是刚建的那个），
// 想要固定就右键组卡「更换颜色」自己挑一个。
export function randomGroupColor() {
  return GROUP_COLORS[Math.floor(Math.random() * GROUP_COLORS.length)]
}
// 文件夹（拖入的目录）的**默认颜色**：Windows 资源管理器里那种黄。
// 为什么不复用色板里的琥珀（#f59e0b）：Lei 2026-09-25 的原话是「默认黄色，Windows系统也是」——
// 琥珀偏橙，摆在文件夹旁边是两回事，照 Windows 那种黄来才对得上他的预期。
export const FOLDER_DEFAULT_COLOR = '#f5c542'
// 文件夹卡右键「调整颜色」用的色板 = 那 7 个彩虹色 + 默认黄。
// ⚠️ 黄色必须留在选项里：它是**默认色**，用户把文件夹改成蓝色之后还得能调回来 ——
//    不放进来就会出现「默认色在自己的调色面板里选不到」这种残缺。
//    分组那边仍是 GROUP_COLORS 那 7 个，不受影响（两边色板是两个常量）。
export const FOLDER_COLORS = [...GROUP_COLORS, FOLDER_DEFAULT_COLOR]
// 颜色的合法性（任意 hex）。为什么判得这么死：组色会直接进 CSS（--group-color 铺方块底），
// 脏字符串不是画不出东西、就是被浏览器静默丢掉整条规则；而且它会一直躺在盘上，越早挡越省事。
// ⚠️ 它比 GROUP_COLORS **宽**：调色面板只给 7 个点，但历史数据里可能存着滑条时代调出来的
// 任意色相 —— 那种颜色照旧显示，不因为控件被删就把它悄悄换掉。
export function isColor(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())
}
// 色相 <-> hex 那一对换算（hueToHex / colorHue）随色相滑条一起删了：面板只剩 7 个色点，
// 颜色只从 GROUP_COLORS 里来，不需要在 0..359 上做换算。

export const state = reactive({
  categories: [],
  items: [],
  activeCategoryId: 'all',
  loading: true,
  toast: '',
  // 拖入导入的进度：null = 没在导。形状 { done, total, name, phase }，由主进程逐项推送。
  // 拖动十几个图标进来时，主进程要为每个图标起一个进程抽图标（每项 0.5–1.5s），
  // 原先这段时间界面上没有任何反馈，看起来就是"卡住了"。这个字段专门喂给底部那张进度卡。
  importing: null,
  // 分类侧栏顶部的快捷方式搜索词（空 = 不过滤）。搜索在当前分类视图内做，
  // 所以在「全部」下即等于全局搜索；切到某分类后只在该分类里匹配。
  search: '',
  // 编辑模式（长按图标进入）：图标抖动、单击点选、主区底部悬浮操作条（全选 / 收藏 / 删除）。
  // 这是一个「模式」状态 —— 与旧的「拖动常开」模型并存：拖动在两种模式下都可用。
  editMode: false,
  // 编辑模式下的选中集合（存 id 数组，便于在模板里做 includes 判断）
  selectedIds: [],
  // 收藏夹（图标区顶边那枚小倒三角点开后的抽屉）：存**项目 id 的有序数组**，
  // 顺序 = 加入收藏的顺序。只记「谁被收藏了」而不是复制一份项目副本，
  // 于是项目改名 / 换图标 / 换分类，收藏夹自动跟着变，不需要任何同步逻辑。
  // 项目被删除后这里可能残留死 id：读的时候过滤（favoriteItems），落盘前再清一遍（persist），
  // 所以删除逻辑不必回头维护收藏夹，也不会把指向不存在项目的坏数据写进 app.json。
  favorites: [],
  // 收藏夹抽屉是否拉开。放在 store 而不是组件内部，是因为开合它的不止那颗小三角
  // （点抽屉外面、按 Esc 也要能收），单点持有点比 props/emit 来回传更省事。
  favOpen: false,
  // mini 模式（只读小窗：只显示收藏、无侧边栏、亚克力半透明、可置顶）。
  // 运行时状态，不落盘 —— 上次退出时在哪个模式由 settings.mini.mode 记住。
  miniMode: false,
  // ---------- 分组（收纳） ----------
  // 收纳单位本身：`{ id, name, color }` —— **只记名字与一个颜色**,
  // 成员靠 item.groupId 反向指过来。
  // 为什么不让组自己存成员数组：那样「一张卡同时属于两个组」在数据上是合法的，
  // 迟早会出现同一张卡被两个组各画一次。让卡片记住自己在哪个组（单值），
  // 「一个成员只属于一个组」就成了数据模型自带的性质，不需要任何校验。
  // color = 文件夹**方块**的颜色：建组时从 GROUP_COLORS（彩虹 7 色）随机取一个（2026-09-23），
  //   右键组卡的调色面板里点那 7 个色点可换。面板从 2026-09-25 起**只有**这一排色点 ——
  //   两条色相滑条、以及「给方块里那个文件夹图形上色」的 group.ink 都按 Lei 的要求删掉了，
  //   图形恒为纯白（见 styles.css 的 .card.group-card .fallback.folder）。
  // 缺字段的旧数据由 init() 就地补，下一次 persist 顺手写盘。
  groups: [],
  // 展开中的组（同时只允许一个，null = 都收起）。纯 UI 态，不落盘。
  openGroupId: null,
  // 正在改名的组（右键菜单「重命名分组…」→ 卡片上的名称就地变成输入框）
  renameGroupId: null,
  // ---------- 拖动相关的三种「组」身份 ----------
  // 本次拖的是**组卡**（dragIds 仍是组内成员的 id 数组，于是排序 / 归类逻辑一行都不用改）
  dragGroupId: null,
  // 本次拖动的**起点**是某个组的展开面板：松手时若不是落回同一个组内，成员就脱离该组
  dragFromGroup: null,
  // 拖到组卡上时正被「吸入」的组（高亮反馈）
  dropGroupId: null,
  // 拖到卡片上**停住**（650ms）后吸附成组的目标卡：松手即成组，不松手就还是排序
  snapTargetId: null,
  // 右键菜单：{ id, x, y } | null。
  // 交互模型里不再有「编辑模式」这个持久状态 —— 编辑 / 删除从右键菜单进入，
  // 拖动排序与拖到分类归类随时可用，不需要先进入任何模式。
  ctxMenu: null,
  // 拖动排序的临时状态
  dragId: null,
  // 本次拖动「实际带着走」的项目集合。
  // 编辑模式下拖一张已选中的卡 → 整个选中集一起走（整组排序 / 整组归类）；
  // 其余情况（没进编辑模式 / 拖的是没选中的卡）只有被拖的那一张。
  dragIds: [],
  dropMark: null, // { id, side: 'before' | 'after', axis: 'x' | 'y' }
  // 拖动归类：卡片当前悬停在哪个分类上（'__uncat' = 未分类；null = 没有）
  dropCatId: null,
  // 界面外观偏好（与 items/categories 一起存在 app.json 里）
  settings: {
    themeId: DEFAULT_THEME,
    mode: DEFAULT_MODE,
    cardStyle: DEFAULT_CARD_STYLE,
    iconSize: DEFAULT_ICON_SIZE,
    // 上次关闭时停留在的分类：'all' / 'uncat' / 某分类 id。下次启动恢复，而非恒回「全部」。
    lastCategoryId: 'all',
    // 完整态窗口置顶（顶栏那枚图钉）。与 mini 态的 settings.mini.alwaysOnTop 各自独立：
    // 用户在哪种形态开的置顶，退出 mini 时就恢复哪种（见 mini-window.js 的 normalTopMost）。
    topMost: false,
    // mini 模式的几何 / 置顶 / 上次所在模式。w/h/x/y 由窗口 resize/move 时经主进程
    // 转发回来落盘（x/y 为 null = 从未记住过位置，进入 mini 时原地缩小不跳）。
    mini: {
      w: 380,
      h: 520,
      x: null,
      y: null,
      alwaysOnTop: true,
      // 上次退出时的窗口形态：'normal' / 'mini'。下次启动恢复，与「记住上次分类」同套路。
      mode: 'normal'
    }
  }
})

let seq = 0
export function uid(prefix = 'id') {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}_${seq}`
}

// 校验「上次分类」是否还有效：'all' / 'uncat' 恒有效；具体 id 须对应一个仍在的分类，
// 否则（分类被删、或脏数据）回落 'all'。放在 init 里调用，categories 此时已载入。
function validLastCategoryId(v) {
  if (v === 'all' || v === 'uncat') return v
  if (typeof v === 'string' && state.categories.some((c) => c.id === v)) return v
  return 'all'
}

export async function init() {
  const data = await electronAPI.loadData()
  state.categories = data.categories || []
  state.items = data.items || []
  // 分组：手工改过 app.json、或读到旧数据时可能带来脏东西（缺 id、名字为空、
  // groupId 指向不存在的组、组里只剩 1 项），统一交给 normalizeGroups 修一遍。
  // color：旧数据（宫格封面时代）没有这个字段，就地补一个随机色 ——
  // 只在内存里补，下一次 persist 会顺手写盘（真的改了颜色的组用 setGroupColor 立刻落盘）。
  // ⚠️ 只挑这 3 个字段：老版本留下的 ink（图形墨色）/ bgHue（卡片底色色相）**故意被丢掉** ——
  //    它们对应的功能已经删了，留着只会在下一次落盘时又被写回盘上。
  state.groups = Array.isArray(data.groups)
    ? data.groups
        .filter((g) => g && typeof g.id === 'string' && g.id)
        .map((g) => ({
          id: g.id,
          name: (g.name || '').trim() || '分组',
          color: isColor(g.color) ? g.color : randomGroupColor()
        }))
    : []
  normalizeGroups()
  // 收藏夹只认「指向现有项目的 id」：手工改过 app.json、或读到旧数据时，
  // 死 id 会在帘布上留下点不动的空条目，所以入口先清一遍。
  state.favorites = liveFavorites(data.favorites)
  const s = data.settings || {}
  state.settings.themeId = isThemeId(s.themeId) ? s.themeId : DEFAULT_THEME
  state.settings.mode = s.mode === 'dark' ? 'dark' : 'light'
  state.settings.cardStyle = isCardStyle(s.cardStyle) ? s.cardStyle : DEFAULT_CARD_STYLE
  state.settings.iconSize = isIconSize(s.iconSize) ? Number(s.iconSize) : DEFAULT_ICON_SIZE
  state.settings.lastCategoryId = validLastCategoryId(s.lastCategoryId)
  // 完整态置顶偏好（旧版 app.json 没有这个字段，缺省 false = 不置顶）
  state.settings.topMost = !!s.topMost
  // mini 设置补默认（旧版 app.json 没有这一段，缺字段时逐个补，不整块覆盖用户改过的值）
  const m = s.mini && typeof s.mini === 'object' ? s.mini : {}
  state.settings.mini = {
    w: Number.isFinite(Number(m.w)) && Number(m.w) > 0 ? Number(m.w) : state.settings.mini.w,
    h: Number.isFinite(Number(m.h)) && Number(m.h) > 0 ? Number(m.h) : state.settings.mini.h,
    x: Number.isFinite(Number(m.x)) ? Number(m.x) : null,
    y: Number.isFinite(Number(m.y)) ? Number(m.y) : null,
    alwaysOnTop: m.alwaysOnTop !== false,
    mode: m.mode === 'mini' ? 'mini' : 'normal'
  }
  applyTheme(state.settings.themeId, state.settings.mode)
  // 恢复上次关闭时的分类（校验过：'all'/'uncat'/仍存在的具体分类，否则回落 'all'）。
  // 放在 loading 之前设好，首屏渲染就是正确分类，不会先闪「全部」再跳。
  state.activeCategoryId = state.settings.lastCategoryId
  state.loading = false
}

// 过滤出「指向现有项目」的收藏 id（保持原顺序）。
// 读展示与写盘都过这一道：于是删除项目时不用回头改收藏夹 ——
// 被删的 id 既不会渲染出来，也不会被写回磁盘。
function liveFavorites(list) {
  if (!Array.isArray(list)) return []
  const known = new Set(state.items.map((i) => i && i.id))
  const seen = new Set()
  const out = []
  for (const id of list) {
    if (typeof id !== 'string' || seen.has(id) || !known.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

// 落盘。
// ⚠️ 关键：state.categories / state.items 是 Vue 的 reactive Proxy，
// 而 contextBridge 的参数走**结构化克隆**，Proxy 无法被克隆，会抛
// 「An object could not be cloned.」——而且这个错误发生在 preload 侧，
// 之前没有 catch，表现为「界面改了、磁盘没变」的静默失败。
// 所以这里必须先深拷贝成普通对象再交给 IPC。
function toPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

let saveTimer = null
export function persist() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    let payload
    try {
      payload = toPlain({
        version: 1,
        categories: state.categories,
        items: state.items,
        groups: state.groups,
        favorites: liveFavorites(state.favorites),
        settings: state.settings
      })
    } catch (err) {
      showToast('保存失败（数据序列化异常）：' + (err && err.message ? err.message : String(err)))
      return
    }
    try {
      const p = electronAPI.saveData(payload)
      if (p && typeof p.catch === 'function') {
        p.catch((err) => showToast('保存失败：' + (err && err.message ? err.message : String(err))))
      }
    } catch (err) {
      showToast('保存失败：' + (err && err.message ? err.message : String(err)))
    }
  }, 200)
}

// 当前停留的分类变化即记入 settings.lastCategoryId 并落盘（防抖由 persist 处理）。
// 一处统管：侧栏点击切换、删除当前分类自动回落 'all' 等所有赋值点都自动覆盖，
// 不用在每个赋值处各写一遍。
watch(
  () => state.activeCategoryId,
  (val) => {
    if (state.settings.lastCategoryId === val) return
    state.settings.lastCategoryId = val
    persist()
  }
)

export function showToast(msg) {
  state.toast = msg
  setTimeout(() => {
    if (state.toast === msg) state.toast = ''
  }, 2600)
}

// ---------- 拖入导入进度 ----------
// 只负责"记进度长什么样"，什么时候显示 / 什么时候收掉由 App.vue 决定 ——
// 进度事件由主进程逐项推来（单一事实源），这里不做任何推测性的默认值。
export function setImportProgress(p) {
  const next = p && typeof p === 'object' ? p : {}
  state.importing = {
    done: Number(next.done) || 0,
    total: Number(next.total) || 0,
    name: typeof next.name === 'string' ? next.name : '',
    phase: typeof next.phase === 'string' ? next.phase : ''
  }
}

export function clearImportProgress() {
  state.importing = null
}

// ---------- 外观 ----------
export function setTheme(id) {
  if (!isThemeId(id)) return
  state.settings.themeId = id
  applyTheme(state.settings.themeId, state.settings.mode)
  persist()
}

export function setMode(mode) {
  state.settings.mode = mode === 'dark' ? 'dark' : 'light'
  applyTheme(state.settings.themeId, state.settings.mode)
  persist()
}

// 切换卡片显示样式。样式全部落在 CSS 变量与 .app[data-style] 上，DOM 结构不变，
// 所以切换后右键菜单 / 拖动排序 / 拖到分类归类这些交互无需任何改动。
export function setCardStyle(id) {
  if (!isCardStyle(id)) return
  state.settings.cardStyle = id
  persist()
}

// 切换图标尺寸。只改一个 CSS 变量（--icon-size），卡片与所有派生几何随之缩放，
// 交互逻辑（右键菜单 / 拖动排序 / 拖到分类归类）不受影响。
export function setIconSize(v) {
  if (!isIconSize(v)) return
  state.settings.iconSize = Number(v)
  persist()
}

// ---------- 右键菜单 ----------
// 位置用鼠标的 clientX/clientY（菜单是 position:fixed），越界翻转由菜单组件负责。
// kind：'item'（普通项目卡）| 'group'（分组卡）—— 菜单项清单由它决定。
export function openCtxMenu(id, x, y, kind = 'item') {
  if (!id) return
  state.ctxMenu = { id, x: Math.round(x), y: Math.round(y), kind: kind === 'group' ? 'group' : 'item' }
  // 分组卡没有「打开位置」这种要预热的操作，直接返回
  if (kind === 'group') return
  // 顺手预热「打开位置」的解析：.lnk 得先问一次系统才知道真实目标（要起一次 PowerShell，
  // 冷启动实测约 0.6s）。菜单弹出到用户点下去通常不止这么久，先问一次、点的时候直接命中缓存。
  // 失败不影响任何功能（真点下去会重来一遍），所以连错误一起吞掉。
  const it = state.items.find((i) => i.id === id)
  if (it && /\.lnk$/i.test(it.path || '')) {
    try {
      const p = electronAPI.prewarmTarget && electronAPI.prewarmTarget(it.path)
      if (p && typeof p.catch === 'function') p.catch(() => {})
    } catch {
      /* ignore */
    }
  }
}

export function closeCtxMenu() {
  state.ctxMenu = null
}

export function beginDrag(id, fromGroupId = null) {
  state.dragId = id
  // 编辑模式下拖「已选中的卡片」→ 整组一起拖。
  // 这是桌面/资源管理器的老习惯：选中一批再拖其中一个，走的是整批；
  // 拖一张**没选中**的卡则只带它自己（不顺手改选择集，免得拖动成了隐式的选择操作）。
  state.dragIds =
    state.editMode && state.selectedIds.length > 1 && state.selectedIds.includes(id)
      ? state.selectedIds.slice()
      : [id]
  // 普通卡片拖动：把「组」的三重身份清干净，免得上一轮拖组卡的残留掺进来
  state.dragGroupId = null
  // 起点是不是某个组的展开面板（决定松手时它要不要脱离这个组）
  state.dragFromGroup = fromGroupId || null
  state.dropGroupId = null
  state.snapTargetId = null
}

// 拖动**组卡**：带走的仍是组内成员的 id 数组 —— 这是整个设计的关键。
// 于是 commitDrop 的「整组摘出 → 整组落回」、moveItemToCategory 的整组归类，
// 一行都不用改就直接支持「整组排序 / 整组归类」。
export function beginGroupDrag(gid) {
  const members = groupMembers(gid).map((i) => i.id)
  if (!members.length) return
  state.dragId = gid
  state.dragGroupId = gid
  // 编辑模式下这一组已经整组躺进选中集里时，跟着整批选中项一起走 ——
  // 与拖单张卡的老习惯一致（选中一批再拖其中一个，走的是整批）。
  // 少了这一条，「选了 3 张 + 1 个组，拖组卡却只带走组」会让人以为自己的选择丢了。
  const sel = state.selectedIds
  const pickedAll = members.every((id) => sel.includes(id))
  state.dragIds = state.editMode && pickedAll && sel.length > members.length ? sel.slice() : members
  state.dragFromGroup = null
  state.dropGroupId = null
  state.snapTargetId = null
}

// 拖动经过某张卡片时更新落点指示（拖动源自身不显示）
export function markDrop(mark) {
  state.dropGroupId = null // 指针已经离开组卡了，吸得再紧也得松开
  // 落点落在「本次拖动的集合内部」时不显示指示线：
  // 把一组卡拖到组内自己身上没有意义，而且指针划过整组时指示线会一直闪。
  if (!mark || state.dragIds.includes(mark.id)) {
    state.dropMark = null
    return
  }
  // axis 只决定**指示线怎么画**（左右插入画竖线、上下插入画横线）；
  // 落点本身的插入语义仍然只有 before / after 两种 —— 一维 splice 已经能表达任意重排，
  // 缺的只是「第二个维度的输入」，那一维现在由 sideOf 判出来。
  state.dropMark = { id: mark.id, side: mark.side, axis: mark.axis === 'y' ? 'y' : 'x' }
}

// 拖动经过**组卡**：高亮「要被吸进去了」。
// 拖的是组卡时不走这条 —— 组并进组没有意义（也免得两个组卡互相吸来吸去），
// 那种情况在组卡上照旧走 before/after 排序。
export function markGroupDrop(gid) {
  if (state.dragGroupId) return
  state.dropMark = null
  state.dropGroupId = gid
}

export function clearGroupDrop() {
  state.dropGroupId = null
}

// 拖动在某张卡片上**停住**（650ms）→ 吸附成组的目标。
// 这是「把一个图标拖到另一个图标上收纳起来」这个手势的核心：
// 只要不停住，它仍然是最普通的排序落点，两者互不干扰。
export function setSnapTarget(id) {
  state.snapTargetId = state.dragGroupId ? null : id || null
}

export function endDrag() {
  state.dragId = null
  state.dragIds = []
  state.dropMark = null
  state.dropCatId = null
  state.dragGroupId = null
  state.dragFromGroup = null
  state.dropGroupId = null
  state.snapTargetId = null
}

// 提交排序：把本次拖动的集合移到落点卡片的前/后，返回**实际移动的条数**（0 = 没动）。
// items 数组顺序即显示顺序（visibleItems 只做过滤，不重排），所以直接改数组位置即可。
// 整组移动的关键是「先整组摘出、再整组落回」——组内相对顺序天然保持不变。
export function commitDrop() {
  const ids = state.dragIds.length ? state.dragIds.slice() : state.dragId ? [state.dragId] : []
  const mark = state.dropMark
  const fromGroup = state.dragFromGroup
  endDrag()
  if (!ids.length || !mark) return 0
  const set = new Set(ids)
  if (set.has(mark.id)) return 0 // 落到组内自己身上 = 原地不动
  const group = state.items.filter((i) => set.has(i.id))
  if (!group.length) return 0
  // 从展开面板里拖出来的成员：除非落点还在**同一个组**里（那是组内排序），
  // 否则就算「移出分组」。判据只看落点所属的组，不需要知道指针在哪个 DOM 上。
  if (fromGroup) {
    const target = state.items.find((i) => i.id === mark.id)
    if (!target || (target.groupId || '') !== fromGroup) {
      for (const it of state.items) if (set.has(it.id) && it.groupId === fromGroup) it.groupId = ''
      normalizeGroups()
    }
  }
  const rest = state.items.filter((i) => !set.has(i.id))
  let idx = rest.findIndex((i) => i.id === mark.id)
  if (idx < 0) return 0 // 落点已不存在：什么都不做，原顺序自然保留
  if (mark.side === 'after') idx += 1
  rest.splice(idx, 0, ...group)
  state.items = rest
  persist()
  return group.length
}

// ---------- 分组：数据不变量 ----------
// 两条不变量：① 每个 item.groupId 都必须指向存在的组；② 每个组至少 2 个成员。
// 第②条是「吸附成组」这个交互的另一半：组里只剩 1 项时它已经没有「收纳」的意义，
// 留着会变成一个点开只有一张卡、又永远删不掉的空壳 —— 直接解散、让那一项回到网格。
// 所有会改变成员归属的动作（并入 / 移出 / 删除项目 / 拖出 / 读盘）末尾都过一遍。
function normalizeGroups() {
  const known = new Set(state.groups.map((g) => g.id))
  for (const it of state.items) {
    if (it.groupId && !known.has(it.groupId)) it.groupId = ''
  }
  const dead = new Set()
  for (const g of state.groups) {
    if (state.items.filter((i) => i.groupId === g.id).length <= 1) dead.add(g.id)
  }
  if (!dead.size) return 0
  for (const it of state.items) if (dead.has(it.groupId)) it.groupId = ''
  state.groups = state.groups.filter((g) => !dead.has(g.id))
  if (dead.has(state.openGroupId)) state.openGroupId = null
  if (dead.has(state.renameGroupId)) state.renameGroupId = null
  return dead.size
}

// ---------- 分组：查询 ----------
export function groupById(gid) {
  return state.groups.find((g) => g.id === gid) || null
}

// 组内成员，按 items 顺序（= 显示顺序）。传 list 则只取该过滤集里的成员
// —— 分类 / 搜索切换后，组里显示的永远只有「当前视图里那些」，不会出现点了没反应的隐藏项。
export function groupMembers(gid, list) {
  return (list || state.items).filter((i) => (i.groupId || '') === gid)
}

// 是否处于「摊平」状态：**只有搜索**。
// 搜索结果本来就该是扁平的可启动项列表（组里的东西也必须搜得到），所以搜索一定摊平。
// 编辑模式**不摊平** —— 组卡保持成组，整组作为一个单位被点选 / 拖动。
// 原因：摊平之后一堆卡片长得一模一样，「刚才那个组是哪几张」当场失忆，
// 整组移动也没了抓手。要动组里的某一张，点开那张组卡的弹窗（弹窗里再长按编辑）。
function isFlatView() {
  return !!(state.search || '').trim()
}

export function isGroupOpen(gid) {
  return state.openGroupId === gid
}

// ---------- 分组：写操作 ----------
function nextGroupName() {
  let n = 1
  const used = new Set(state.groups.map((g) => g.name))
  while (used.has('分组 ' + n)) n += 1
  return '分组 ' + n
}

// 把若干项目收成一个新组。至少 2 项 —— 1 项会被 normalizeGroups 立刻解散，
// 所以这里直接拒绝，免得出现「点了按钮什么都没发生」。
export function makeGroup(itemIds) {
  const ids = [...new Set(Array.isArray(itemIds) ? itemIds : [itemIds])].filter((id) =>
    state.items.some((i) => i.id === id)
  )
  if (ids.length < 2) return null
  // 颜色：建组时随机取一个（Lei：「颜色每次都从彩虹的 7 种颜色随机」）。
  // 想要固定的，右键组卡「更换颜色」自己挑 —— 也顺手把「新组一眼认得出」这件事做实了。
  const g = { id: uid('grp'), name: nextGroupName(), color: randomGroupColor() }
  state.groups.push(g)
  const set = new Set(ids)
  for (const it of state.items) if (set.has(it.id)) it.groupId = g.id
  closeCtxMenu()
  persist()
  return g
}

// 换一个组的**方块**颜色（右键组卡 → 调整颜色里那 7 个色点）。
// 只认合法的 hex：否则手工改过的 app.json 能把任意字符串塞进来，画出来是块透明方，
// 而且这种坏数据会一直躺在盘上。返回是否真的改了（同色 / 组不存在都算没改）。
export function setGroupColor(gid, color) {
  const g = groupById(gid)
  if (!g || !isColor(color) || g.color === color) return false
  g.color = color
  persist()
  return true
}

// 文件夹卡那个**图形**的生效色：item.color 没值（或值不合法）就回落到默认黄。
// ⚠️ 回落在**读取时**做，而不是在 init() 里往 items 上补字段 ——
//    于是「默认黄」对**已有数据零改动**：一个从来没被调过色的文件夹，盘上依然没有 color 字段，
//    只有真的点过色点的那一项才写盘。这也顺手挡住了手工改过的 app.json 里塞进来的脏字符串
//    （isColor 不过就回落到默认色，画不出东西的坏值不会进 CSS）。
export function folderColorOf(item) {
  return item && isColor(item.color) ? item.color : FOLDER_DEFAULT_COLOR
}

// 换一个**文件夹**的图形颜色（右键文件夹卡 → 调整颜色里那排色点）。
// 与 setGroupColor 同规矩：只认合法 hex；返回是否真的改了。
// ⚠️ 拿**生效色**比较：本来就没调过色（= 默认黄）的文件夹上点那个黄点，什么都没变、也不写盘。
export function setItemColor(id, color) {
  const it = state.items.find((x) => x.id === id)
  // 只认文件夹：其它项目的脸是位图图标或按名字取稳定色的字母头像，item.color 对它们没有意义。
  if (!it || it.type !== 'folder' || !isColor(color)) return false
  if (folderColorOf(it) === color) return false
  it.color = color
  persist()
  return true
}


// 把项目并入已有的组。返回实际加入的条数（0 = 全都在里面了 / 组不存在 / 拖的是组卡）。
export function moveIntoGroup(gid, itemIds) {
  state.dropGroupId = null
  state.snapTargetId = null
  if (state.dragGroupId) return 0 // 组卡不能并进组卡
  const g = groupById(gid)
  if (!g) return 0
  const ids = Array.isArray(itemIds) ? itemIds : [itemIds]
  let n = 0
  for (const id of ids) {
    const it = state.items.find((i) => i.id === id)
    if (!it || it.groupId === gid) continue
    it.groupId = gid
    n += 1
  }
  if (!n) return 0
  normalizeGroups() // 源组可能因此只剩 1 项 → 就地解散
  persist()
  return n
}

// 「拖到卡片上停住」的手势：目标本身是组卡 → 并入它；否则拿目标 + 拖来的卡开一个新组。
// 返回组对象（供提示语说清楚收进了哪个组）。
export function combineIntoGroup(targetItemId, itemIds) {
  state.snapTargetId = null
  const ids = [...new Set(Array.isArray(itemIds) ? itemIds : [itemIds])].filter(
    (id) => id && id !== targetItemId
  )
  if (!ids.length) return null
  const target = state.items.find((i) => i.id === targetItemId)
  if (!target) return null
  if (target.groupId && groupById(target.groupId)) {
    return moveIntoGroup(target.groupId, ids) ? groupById(target.groupId) : null
  }
  return makeGroup([targetItemId, ...ids])
}

// 把若干项移出它所在的组（组因此剩 1 项时由 normalizeGroups 顺手解散）。
// 入参既可以是单个 id，也可以是一个数组 —— 弹窗里把卡片拖到窗口外时，
// 编辑模式下选中的那几张会一次退出来。返回实际移出的条数。
export function removeFromGroup(ids) {
  const list = Array.isArray(ids) ? ids : [ids]
  let n = 0
  for (const id of list) {
    const it = state.items.find((i) => i.id === id)
    if (!it || !it.groupId) continue
    it.groupId = ''
    n += 1
  }
  if (!n) return 0
  normalizeGroups()
  persist()
  return n
}

// 解散整个组：成员回到原来的位置（不动 items 顺序，所以只是「散开」）
export function dissolveGroup(gid) {
  if (!groupById(gid)) return 0
  let n = 0
  for (const it of state.items) {
    if (it.groupId === gid) {
      it.groupId = ''
      n += 1
    }
  }
  state.groups = state.groups.filter((g) => g.id !== gid)
  if (state.openGroupId === gid) state.openGroupId = null
  if (state.renameGroupId === gid) state.renameGroupId = null
  closeCtxMenu()
  persist()
  return n
}

export function renameGroup(gid, name) {
  const g = groupById(gid)
  const nm = (name || '').trim()
  state.renameGroupId = null
  if (!g || !nm || nm === g.name) return false
  g.name = nm
  persist()
  return true
}

// 展开 / 收起某个组（同时只开一个；重复点同一个即收起）
export function setOpenGroup(gid) {
  state.openGroupId = state.openGroupId === gid ? null : gid
  state.renameGroupId = null
}

export function setRenameGroup(gid) {
  state.renameGroupId = gid || null
}

// 关掉分组弹窗（连就地改名一起收）：点遮罩 / 点关闭 / 按 Esc / 切分类 都走这一条。
// 与 setOpenGroup 的区别是它**不做切换** —— 这些入口要的都是「收起来」，
// 而传当前 id 进去切换虽然也成立，读起来却像「再打开一次」，是个陷阱。
export function closeGroup() {
  state.openGroupId = null
  state.renameGroupId = null
}

// ---------- 分类 ----------
// 新建分类的默认名。入口是搜索框右侧那个「点一下就建一个」的圆形加号（Lei 2026-09-25），
// 名字不由用户输入 —— 所以默认名必须能自增：连点两下若出现两行一模一样的「新建分类」，
// 既分不清谁是谁，也没法挑一个去重命名。
const DEFAULT_CAT_NAME = '新建分类'
export function nextCategoryName() {
  const used = new Set(state.categories.map((c) => c.name))
  if (!used.has(DEFAULT_CAT_NAME)) return DEFAULT_CAT_NAME
  for (let i = 2; ; i += 1) {
    const n = `${DEFAULT_CAT_NAME} ${i}`
    if (!used.has(n)) return n
  }
}

// 返回实际用的名字，供 UI 如实提示（名字可能是「新建分类 2」而不是默认名）。
export function addCategory(name) {
  const n = (name || '').trim() || nextCategoryName()
  const order = state.categories.length
  state.categories.push({ id: uid('cat'), name: n, order })
  persist()
  return n
}

export function renameCategory(id, name) {
  const c = state.categories.find((x) => x.id === id)
  if (c) {
    c.name = name
    persist()
  }
}

export function deleteCategory(id) {
  state.categories = state.categories.filter((x) => x.id !== id)
  // 该分类下的项目归入「未分类」（categoryId 置空）
  state.items.forEach((it) => {
    if (it.categoryId === id) it.categoryId = ''
  })
  if (state.activeCategoryId === id) state.activeCategoryId = 'all'
  persist()
}

// 把项目移到目标分类（targetKey 为 '__uncat' 或空串 → 未分类；其余必须是真实分类 id）。
// 返回 { name, to, count } 供 UI 提示；没有实际移动（项目不存在 / 全已在目标分类 / 目标无效）时返回 null。
// 编辑模式下拖的是整组选中项 → 一次把整组移过去（已在目标分类的成员自动跳过）。
export function moveItemToCategory(itemId, targetKey) {
  // ⚠️ 传进来的可能是**项目 id，也可能是组 id**：拖组卡时 GroupCard 塞进 dataTransfer 的就是组 id
  // （整组成员记在 beginGroupDrag 的 dragIds 里）。以前只按项目 id 找，拖组卡过来 find 不到就静默返回 null，
  // 表现成「把组拖到分类上毫无反应」—— 而且不报错、不弹提示，只有落盘数据没变。
  const asGroup = groupById(itemId)
  const base = asGroup
    ? groupMembers(itemId).map((m) => m.id)
    : state.dragIds.length > 1 && state.dragIds.includes(itemId)
      ? state.dragIds.slice()
      : [itemId]
  // 分组是「收纳单位」：只要动到组里的任何一项，整组一起走。
  // 否则会出现同一个组被拆到两个分类里，组卡在不同分类下显示不同的成员，很怪。
  const ids = [...new Set(base.flatMap((id) => {
    const it = state.items.find((i) => i.id === id)
    if (!it || !it.groupId || !groupById(it.groupId)) return [id]
    return groupMembers(it.groupId).map((m) => m.id)
  }))]
  state.dropCatId = null
  const uncat = !targetKey || targetKey === '__uncat'
  const to = uncat ? '' : targetKey
  const target = uncat ? null : state.categories.find((c) => c.id === to)
  if (!uncat && !target) return null
  const moved = []
  for (const id of ids) {
    const it = state.items.find((i) => i.id === id)
    if (!it) continue
    if ((it.categoryId || '') === to) continue // 已在目标分类：跳过，免得刷出无意义提示
    it.categoryId = to
    moved.push(it)
  }
  if (!moved.length) return null
  const vis = visibleItems()
  const visSet = new Set(vis.map((i) => i.id))
  // 项目移出当前视图后：右键菜单不能悬在一张看不见的卡片上，选中集里溜走的也要摘掉
  if (state.ctxMenu && !visSet.has(state.ctxMenu.id)) closeCtxMenu()
  if (state.selectedIds.length) state.selectedIds = state.selectedIds.filter((id) => visSet.has(id))
  persist()
  return { name: moved[0].name, to: target ? target.name : '未分类', count: moved.length }
}

// ---------- 项目 ----------
export function addItem(payload) {
  const order = state.items.filter((i) => i.categoryId === payload.categoryId).length
  state.items.push({ id: uid('item'), order, logo: null, args: '', workDir: '', ...payload })
  persist()
}

export function updateItem(id, patch) {
  const it = state.items.find((x) => x.id === id)
  if (it) {
    Object.assign(it, patch)
    persist()
  }
}

export function deleteItem(id) {
  state.items = state.items.filter((x) => x.id !== id)
  if (state.ctxMenu && state.ctxMenu.id === id) closeCtxMenu()
  normalizeGroups() // 组里的成员被删掉后可能只剩 1 项 → 就地解散
  persist()
}

// ---------- 编辑模式 / 多选 ----------
// 长按图标进入：图标抖动、单击点选、主区底部悬浮操作条（全选 / 删除）。
// 退出走「点击空白区 / Esc」，两者都会清空选中 —— 免得残留的选中悬在看不见的卡片上。
export function enterEdit() {
  if (state.editMode) return
  state.editMode = true
  state.selectedIds = []
  // ⚠️ 这里**不动 openGroupId**：从分组弹窗里长按进来的编辑模式，弹窗要留着 ——
  //    编辑的正是它里面的东西（长按那一刻主网格还被遮罩挡着，所以「弹窗开着 = 编的就是这个组」永远成立）。
  state.renameGroupId = null
  // 编辑模式下主题是多选，单卡的右键菜单不再适用，顺手收起来
  closeCtxMenu()
}

export function exitEdit() {
  if (!state.editMode && !state.selectedIds.length) return
  state.editMode = false
  state.selectedIds = []
  endDrag()
}

export function isSelected(id) {
  return state.selectedIds.includes(id)
}

export function toggleSelect(id) {
  if (!state.editMode) return
  const i = state.selectedIds.indexOf(id)
  if (i >= 0) state.selectedIds.splice(i, 1)
  else state.selectedIds.push(id)
}

// 点组卡 = 整组一起选中 / 取消（分组在编辑模式下是一个**单位**）。
// 不做「点进组里选单张」那套 —— 组内的单张要动，点开弹窗，在弹窗里长按编辑。
export function toggleSelectGroup(gid) {
  if (!state.editMode) return
  const ids = groupMembers(gid, visibleItems()).map((i) => i.id)
  if (!ids.length) return
  const set = new Set(ids)
  if (ids.every((id) => state.selectedIds.includes(id))) {
    state.selectedIds = state.selectedIds.filter((id) => !set.has(id))
    return
  }
  for (const id of ids) if (!state.selectedIds.includes(id)) state.selectedIds.push(id)
}

// 全选「当前视图里看得见」的项目（尊重分类与搜索过滤 —— 选到看不见的东西会让人困惑）。
// 分组弹窗开着时改为全选**组内成员**：那一刻用户看的就是这个组，
// 把遮罩后面看不见的项目也一并选上就荒唐了。
export function selectAllVisible() {
  if (!state.editMode) return
  if (state.openGroupId && groupById(state.openGroupId)) {
    state.selectedIds = groupMembers(state.openGroupId, visibleItems()).map((i) => i.id)
    return
  }
  state.selectedIds = visibleItems().map((i) => i.id)
}

export function clearSelection() {
  state.selectedIds = []
}

// 批量删除选中项并退出编辑模式，返回删除条数（0 = 没选中）
export function deleteSelected() {
  const ids = state.selectedIds.slice()
  if (!ids.length) return 0
  const set = new Set(ids)
  state.items = state.items.filter((i) => !set.has(i.id))
  state.selectedIds = []
  state.editMode = false
  closeCtxMenu()
  normalizeGroups() // 组里的成员被删掉后可能只剩 1 项 → 就地解散
  persist()
  return ids.length
}

// 编辑模式操作条上的「分组」：把选中的项目收进一个新组。**不退出编辑模式** ——
// 组卡在编辑模式下不再摊平，刚建好的组卡直接出现在图标区里，接着就能整组挪走。
//（早先要退出编辑模式，是因为一进编辑模式组就散开、不退出就看不到刚建好的组卡。）
// 返回组对象（选不够 2 项时返回 null，由调用方给出提示）。
export function groupSelected() {
  const ids = state.selectedIds.slice()
  if (ids.length < 2) return null
  const g = makeGroup(ids)
  if (!g) return null
  state.selectedIds = []
  endDrag()
  return g
}

// ---------- 收藏夹 ----------
export function isFavorite(id) {
  return state.favorites.includes(id)
}

// 收藏夹要展示的完整项目对象，按「加入收藏的顺序」。
// 读的时候固定过一次 liveFavorites（滤掉被删项目的死 id）——
// 于是删除项目不必回头维护收藏夹，帘布上也不会出现点不动的空条目。
export function favoriteItems() {
  return liveFavorites(state.favorites)
    .map((id) => state.items.find((i) => i.id === id))
    .filter(Boolean)
}

// 编辑模式操作条上的「收藏 / 取消收藏」：
// 选中项**全都**已收藏 → 整批取消；否则把还没收藏的补齐（部分已收藏时按"补齐"处理）。
// 返回实际变动条数，让提示语能如实说清动了多少。
export function toggleFavoriteSelected() {
  const ids = state.selectedIds.slice()
  if (!ids.length) return { added: 0, removed: 0 }
  if (ids.every((id) => state.favorites.includes(id))) {
    const set = new Set(ids)
    state.favorites = state.favorites.filter((id) => !set.has(id))
    persist()
    return { added: 0, removed: ids.length }
  }
  const add = ids.filter((id) => !state.favorites.includes(id))
  state.favorites = state.favorites.concat(add)
  persist()
  return { added: add.length, removed: 0 }
}

// 右键菜单上的「收藏 / 取消收藏」：**单项**切换。
// 返回切换**之后**的状态（true = 现在已在收藏夹里），调用方据此决定提示语 ——
// 与批量版（toggleFavoriteSelected 返回 {added,removed}）不同，单项不必区分那么多。
export function toggleFavorite(id) {
  if (!id) return false
  if (state.favorites.includes(id)) {
    state.favorites = state.favorites.filter((x) => x !== id)
    persist()
    return false
  }
  state.favorites = state.favorites.concat([id])
  persist()
  return true
}

// 移出收藏夹（只取消收藏，不删项目）。返回是否真的动了。
export function removeFavorite(id) {
  if (!state.favorites.includes(id)) return false
  state.favorites = state.favorites.filter((x) => x !== id)
  persist()
  return true
}

export function setFavOpen(v) {
  state.favOpen = !!v
}

export function removeLogo(rel) {
  return electronAPI.removeLogo(rel)
}

// 拖入解析结果由主进程回传：只**追加**新条目，绝不整体替换本地状态。
// （早期版本用 replaceData 整份覆盖，会把渲染层尚未落盘的改动一并冲掉，
//   也与主进程的「读盘→改→写盘」形成竞态，是「改名不生效」的另一半原因）
export function appendItems(incoming) {
  const known = new Set(state.items.map((i) => i && i.path))
  const fresh = []
  let dup = 0
  for (const it of incoming || []) {
    if (!it || !it.path) continue
    if (known.has(it.path)) {
      dup += 1
      continue
    }
    known.add(it.path)
    state.items.push({ ...it, order: state.items.length })
    fresh.push(it)
  }
  if (fresh.length) persist()
  return { added: fresh.length, dup }
}

export function visibleItems() {
  let list
  if (state.activeCategoryId === 'all') list = state.items
  else if (state.activeCategoryId === 'uncat')
    list = state.items.filter((i) => !i.categoryId || !state.categories.some((c) => c.id === i.categoryId))
  else list = state.items.filter((i) => i.categoryId === state.activeCategoryId)

  // 搜索：在当前分类视图内按名称 / 路径模糊匹配（不区分大小写）。
  // 全部分类下这个 list 就是全量，所以天然等价于全局搜索。
  const q = (state.search || '').trim().toLowerCase()
  if (q) {
    // 搜组名时把整个组摊开列出来 —— 否则「分组」这个收纳动作会把里面的项目
    // 从搜索里藏起来：用户明明收纳过、却搜不到，那是更糟的体验。
    const hitGroups = new Set(
      state.groups.filter((g) => (g.name || '').toLowerCase().includes(q)).map((g) => g.id)
    )
    list = list.filter(
      (i) =>
        (i.name || '').toLowerCase().includes(q) ||
        (i.path || '').toLowerCase().includes(q) ||
        (i.groupId && hitGroups.has(i.groupId))
    )
  }
  return list
}

// 图标区真正要渲染的节点序列：未进组的卡片与组卡**交错**在同一条序列里，
// 于是「组卡显示在哪」不需要任何额外的顺序字段 —— 它是「组内第一个成员的位置」。
// 这条约定让排序、归类、拖入拖出全都自动成立：
// items 数组一次都没有为分组改过语义，分组只是渲染时的一次折叠。
export function visibleNodes() {
  const list = visibleItems()
  // 摊平态（编辑模式 / 搜索）不折组：成员直接回网格
  if (isFlatView()) return list.map((it) => ({ kind: 'item', key: it.id, item: it }))
  const nodes = []
  const seen = new Set()
  for (const it of list) {
    const gid = it.groupId || ''
    if (!gid || !groupById(gid)) {
      nodes.push({ kind: 'item', key: it.id, item: it })
      continue
    }
    if (seen.has(gid)) continue
    seen.add(gid)
    const members = list.filter((x) => (x.groupId || '') === gid)
    // 当前视图里只剩 1 项的组不画成组卡（画了就是个点开只有一张卡的空壳）
    if (members.length <= 1) {
      nodes.push({ kind: 'item', key: it.id, item: it })
      continue
    }
    nodes.push({ kind: 'group', key: 'g:' + gid, group: groupById(gid), members })
  }
  return nodes
}

export function logoSrc(item) {
  // Tauri 版把图标直接存成 data URL（app.json 内聚、零协议、零权限），
  // 旧 Electron 版的 appres:// 自定义协议在这里不再需要。
  return item && item.logo ? item.logo : ''
}

// 当前激活分类对应的「真实分类 id」（全部/未分类等虚拟分类 → 空串，即未分类）
export function currentCategoryId() {
  const id = state.activeCategoryId
  return state.categories.some((c) => c.id === id) ? id : ''
}

export async function launch(item) {
  const res = await electronAPI.launchItem({
    path: item.path,
    args: item.args || '',
    type: item.type || 'app',
    workDir: item.workDir || ''
  })
  if (!res || !res.ok) {
    showToast('启动失败：' + (res?.error || '未知错误'))
    return false
  }
  return true
}
