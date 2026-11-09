<script setup>
import { computed, ref, watch } from 'vue'
import { GROUP_COLORS, folderColorOf, logoSrc, launch, state } from '../store'
import { useLongPress } from '../long-press'
import { electronAPI } from '../api'
import MdIcon from './MdIcon.vue'

const props = defineProps({
  item: { type: Object, required: true },
  // 本卡片是否正被拖动
  dragging: { type: Boolean, default: false },
  // 本卡片是否是右键菜单的作用对象（菜单打开期间给它一个高亮）
  menuTarget: { type: Boolean, default: false },
  // 拖动经过本卡片时的落点：'' | 'before' | 'after'
  dropSide: { type: String, default: '' },
  // 落点的轴向：'x' = 左右插入（画竖线）· 'y' = 上下插入（画横线）
  dropAxis: { type: String, default: 'x' },
  // 编辑模式（长按进入）：卡片抖动、单击点选、双击不再启动
  editMode: { type: Boolean, default: false },
  // 编辑模式下本卡片是否被选中（选中描边用 outline，不占位、不引起尺寸跳动）
  selected: { type: Boolean, default: false },
  // 抖动动画的相位偏移（秒，取负值）：让每张卡片抖得不同步，才有「一片在动」的观感
  wiggleDelay: { type: [Number, String], default: 0 },
  // 是否参与原生拖拽。收藏夹抽屉里的卡片只做「启动 / 右键」，不排序不归类，所以关掉
  draggable: { type: Boolean, default: true },
  // 有东西拖到本卡上**停住**了（650ms）：此刻松手 = 收成一个分组，而不是排序。
  // 卡面要给出明确的「要被吸进去了」的反馈，否则用户不知道停住和路过有什么区别。
  snapTarget: { type: Boolean, default: false }
})
const emit = defineEmits([
  'menu',
  'drag-start',
  'drag-over-item',
  'drop-item',
  'drag-end',
  'long-press',
  'toggle-select',
  'snap-hover'
])

// 兜底字母头像的颜色：与分组文件夹共用同一块七色板（store.GROUP_COLORS），
// 区别只在取法 —— 这里按名字取**稳定**色（同一个项目每次都是同一个色），
// 分组那边是建组时随机（见 store.randomGroupColor）。
function colorFor(name) {
  let s = 0
  for (const ch of name || '') s += ch.charCodeAt(0)
  return GROUP_COLORS[s % GROUP_COLORS.length]
}
const initial = computed(() => (props.item.name || '?').trim().charAt(0).toUpperCase())
const bg = computed(() => colorFor(props.item.name || ''))
const badge = computed(() => (props.item.type === 'folder' ? '文件夹' : '程序'))
// 文件夹图形的颜色：默认是 Windows 那种黄，右键卡片「调整颜色」可换（见 store.folderColorOf）。
// 取生效色而不是 item.color —— 没调过色的项盘上没有这个字段，读裸值会拿到 undefined。
const folderColor = computed(() => folderColorOf(props.item))
// 悬停提示只报「名字 · 类型」。
// 原先这里还缀着「双击启动，右键更多操作，按住可进入编辑，拖动可排序或归类」——
// 同一句话在顶栏、分组弹窗底部、组卡 tooltip 各有一份，改一处就会漏掉另外两处。
// 现在操作说明统一收在顶栏问号的操作指南里（HelpDialog.vue），这里不再重复第二遍。
const tip = computed(() => `${props.item.name} · ${badge.value}`)

// —— 图标来源 ——
// 仅图标模式要「铺满」，所以得先把图标自带的透明边距裁掉：Windows 的 256×256 图标
// 按规范自带安全边距，但各家留得不一样（实测同一批里有的内容只占画布 83%、有的 100%），
// 不裁的话并排看就是"有的图标很小"。其他样式保留原始图标 —— Windows 自己也不裁，
// 那圈安全边距是有意留的，动了反而失真。
const src = ref('')
const trimCache = new Map() // logo 相对路径 -> dataURL | null（null 表示无需裁剪）
async function resolveSrc() {
  const url = logoSrc(props.item)
  if (!url) {
    src.value = ''
    return
  }
  if (state.settings.cardStyle !== 'icon') {
    src.value = url
    return
  }
  const logo = props.item.logo || ''
  if (trimCache.has(logo)) {
    src.value = trimCache.get(logo) || url
    return
  }
  src.value = url // 先用原图顶上，避免先空一块再出图
  try {
    const trimmed = await electronAPI.trimLogo(logo)
    trimCache.set(logo, trimmed || null)
    if (props.item.logo === logo && state.settings.cardStyle === 'icon') src.value = trimmed || url
  } catch {
    trimCache.set(logo, null)
  }
}
watch(() => [props.item.logo, state.settings.cardStyle], resolveSrc, { immediate: true })

// —— 长按进入编辑模式 ——
// 时序本身在 long-press.js 里（组卡共用同一套）：这里只管「长按了要干什么」。
const press = useLongPress(() => emit('long-press', props.item.id))

function onClick() {
  // 长按松手后会跟一个 click：那一下是「进编辑模式」的收尾，不能当成点选
  if (press.consumeClick()) return
  if (props.editMode) emit('toggle-select', props.item.id)
}

// 卡片根元素引用：双击动效类挂在它身上（动画作用在 .icon-box 内部），
// 用 ref 而不是依赖事件里的 currentTarget，避免和其它处理器里的 currentTarget 混淆。
const rootEl = ref(null)
let fxTimer = null
function onDbl() {
  // 编辑模式下双击不启动（此时单击的语义是点选）
  if (props.editMode || press.hasFired()) return
  // 双击「图标回应」动效（方案 E）：图标本体弹跳 + 中心柔光环，
  // 注意力全在图标上，不动卡片外壳，也不碰 hover/active 的 transform。
  const el = rootEl.value
  if (el) {
    el.classList.remove('launch-fx')
    void el.offsetWidth // 强制回流，让动画在连点时可重复触发
    el.classList.add('launch-fx')
    if (fxTimer) clearTimeout(fxTimer)
    // 光环 0.6s 收尾，留一点余量再撤类（否则动画会被中途打断、瞬间复位）
    fxTimer = setTimeout(() => el.classList.remove('launch-fx'), 680)
  }
  launch(props.item)
}

// 右键 → 交给 App 打开自定义菜单。
// （不用 Electron 原生菜单：原生菜单永远是系统样式、跟不了主题，也没法在自动化里断言）
function onContextMenu(e) {
  if (props.editMode) return // 编辑模式下主题是多选，不用单卡菜单
  emit('menu', { id: props.item.id, x: e.clientX, y: e.clientY })
}

// —— 拖动：两种模式都可拖，不需要先进入任何模式 ——
// 只接管「内部卡片拖拽」：从资源管理器拖入文件时 types 里是 Files，
// 那条路要留给窗口级 drop 去添加项目，不能在这里被拦下。
const ITEM_MIME = 'application/x-ql-item'
function isItemDrag(e) {
  const t = e.dataTransfer && e.dataTransfer.types
  return !!(t && Array.from(t).includes(ITEM_MIME))
}
function isFileDrag(e) {
  const t = e.dataTransfer && e.dataTransfer.types
  return !!(t && Array.from(t).includes('Files'))
}
// 落点方向：拿「指针相对卡片的位置」算，两维都看。
// 旧写法只看 clientX（左半 = 插它前面），于是**拖到上一行 / 下一行时落点由水平位置决定**：
// 想插到上一行那张的前面，必须恰好落在它的左半，落在右半就跳回它后面去 ——
// 用起来就是「只能左右排、上下排不动」。
// 现在按「指针从哪条边进来的」判：离开中线更远的那个维度说了算 ——
// 从上边进 = 插到它前面，下边进 = 插到它后面，左右同理（手机主屏的直觉）。
// 顺手把轴向带出去，让指示线能横过来（见 styles.css 的 .drop-y）。
function sideOf(e) {
  const r = e.currentTarget.getBoundingClientRect()
  const dx = r.width ? (e.clientX - r.left) / r.width : 0.5
  const dy = r.height ? (e.clientY - r.top) / r.height : 0.5
  const axis = Math.abs(dy - 0.5) > Math.abs(dx - 0.5) ? 'y' : 'x'
  const v = axis === 'y' ? dy : dx
  return { side: v < 0.5 ? 'before' : 'after', axis }
}
// —— 拖到卡上停住 → 吸附成组 ——
// 停住 650ms 才算数：只是路过、或想插到它前面，松手时早就走开了，不受影响。
// 于是「拖到卡片上」有了两层互不打架的语义：
//   停住不动 = 和它收成一个分组；直接松手 = 插到它前 / 后。
const SNAP_MS = 650
let snapTimer = null
function clearSnapTimer() {
  if (snapTimer) {
    clearTimeout(snapTimer)
    snapTimer = null
  }
}
function cancelSnap() {
  clearSnapTimer()
  if (props.snapTarget) emit('snap-hover', '')
}
function onDragStart(e) {
  if (isFileDrag(e)) return
  press.cancel() // 起了原生拖拽 = 用户在拖，不是长按
  cancelSnap()
  e.dataTransfer.effectAllowed = 'move'
  try {
    e.dataTransfer.setData(ITEM_MIME, props.item.id)
  } catch {}
  emit('drag-start', props.item.id)
}
function onDragOver(e) {
  if (isFileDrag(e) || !isItemDrag(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  const mark = sideOf(e)
  emit('drag-over-item', { id: props.item.id, side: mark.side, axis: mark.axis })
  // 整组拖动只做排序落点：组并进组没有意义，别把整组也吸进去
  if (state.dragGroupId || props.snapTarget) return
  if (!snapTimer) {
    snapTimer = setTimeout(() => {
      snapTimer = null
      emit('snap-hover', props.item.id)
    }, SNAP_MS)
  }
}
// 指针在卡片内部的子元素之间挪动（图标、名字）也会冒泡出 dragleave，
// 用 relatedTarget 判一下：还在本卡里就不算离开，否则吸附计时一到子元素上就被清掉了。
function onDragLeave(e) {
  const to = e.relatedTarget
  if (to && e.currentTarget && e.currentTarget.contains(to)) return
  cancelSnap()
}
function onDrop(e) {
  if (isFileDrag(e) || !isItemDrag(e)) return
  e.preventDefault()
  e.stopPropagation()
  clearSnapTimer()
  const mark = sideOf(e)
  emit('drop-item', { id: props.item.id, side: mark.side, axis: mark.axis })
}
function onDragEnd() {
  cancelSnap()
  emit('drag-end')
}
</script>

<template>
  <div
    ref="rootEl"
    class="card"
    :class="{
      'drag-src': dragging,
      'ctx-target': menuTarget,
      'drop-before': dropSide === 'before' && !snapTarget,
      'drop-after': dropSide === 'after' && !snapTarget,
      // 上下插入：指示线横过来（竖线停在左右会让人以为「插到它左边 / 右边」）
      'drop-y': !!dropSide && dropAxis === 'y' && !snapTarget,
      selected: selected,
      'snap-target': snapTarget,
      wiggle: editMode
    }"
    :style="editMode ? { '--wiggle-delay': wiggleDelay + 's' } : null"
    :draggable="draggable"
    :title="tip"
    @click="onClick"
    @dblclick="onDbl"
    @contextmenu.prevent="onContextMenu"
    @pointerdown="press.onPointerDown"
    @pointermove="press.onPointerMove"
    @pointerup="press.cancel"
    @pointercancel="press.cancel"
    @pointerleave="press.cancel"
    @dragstart="onDragStart"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
    @dragend="onDragEnd"
  >
    <span class="icon-box">
      <img v-if="src" class="logo" :src="src" :alt="item.name" draggable="false" />
      <div v-else-if="item.type === 'folder'" class="fallback folder" :style="{ color: folderColor }">
        <MdIcon name="folder" :size="28" />
      </div>
      <div v-else class="fallback" :style="{ background: bg }">{{ initial }}</div>
    </span>
    <!-- 已收藏标记：右上角小星。直接读 store 而不是加 prop —— 收藏是全局状态，
         卡片只是它的一个视图，多一条 props 链路只会多一处要同步的地方。 -->
    <span v-if="state.favorites.includes(item.id)" class="fav-mark" aria-hidden="true">
      <MdIcon name="star" :size="11" />
    </span>
    <div class="name">{{ item.name }}</div>
    <div class="hint">{{ badge }}</div>
  </div>
</template>
