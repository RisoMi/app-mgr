<script setup>
// 分组卡 = **一张和普通图标一样大的卡**：脸是一个彩色文件夹图标，右上角挂一枚数字角标
// （组里一共几项）。需求原话（Lei 2026-09-23）：
//   「将宫格改成 1 个单个图标大小的固定图标，代表分组，右上角显示数字，分组下有多少图标」。
//
// 为什么从「2×2 宫格封面」退回一格：
//   宫格封面为了「一眼看出这是一堆东西」付了两笔账 —— 占 4 格（一行少放两个项目），
//   以及为「按数量排几列几行 / 格子多大 / 悬停放大到哪儿」维护一整套几何。
//   这两笔其实一个数字就付清了：右上角的「N」比九个迷你图标更直接地回答「这里有多少东西」，
//   而彩色文件夹一眼就说明「这是个分组，不是一个应用」。组卡回到 1×1 之后，
//   网格节奏不再被那个唯一的跨格元素打乱，排序 / 归类 / 编辑模式也全部退化成
//   「和普通卡完全一样」的一条路径。
//
// 颜色：方块色建组时从 GROUP_COLORS（彩虹 7 色）随机取一个，落盘在 group.color 上，
// 右键组卡「调整颜色」里点色点可换（ItemContextMenu.vue）；方块里那个文件夹**恒为纯白**
// （Lei 2026-09-25「去除文件夹图形调色滑条和文件夹调色滑条，保留 7 个调色选项」——
// 给图形上色的整条链已删）。缺值的旧数据由 store.init() 兜底补。
//
// 拖动：卡片 dragstart 时带上的是**组 id**，但真正被判定的东西在 store 里
// （beginGroupDrag 会把组内成员的 id 整批塞进 dragIds）—— 于是排序 / 归类逻辑
// 一行都不用改就能整组走。编辑模式下它也是一个单位：点它 = 整组选中，拖它 = 整组移动。
import { computed, nextTick, ref, watch } from 'vue'
import {
  GROUP_COLORS,
  groupMembers,
  isColor,
  renameGroup,
  setOpenGroup,
  state
} from '../store'
import { useLongPress } from '../long-press'
import MdIcon from './MdIcon.vue'

const props = defineProps({
  // 组本体：{ id, name, color }
  group: { type: Object, required: true },
  // 当前视图内的成员（分类 / 搜索过滤后），按显示顺序 —— 只用来取排序锚点，
  // 角标上的数字不取它（见下面的 total）。
  members: { type: Array, default: () => [] },
  dragging: { type: Boolean, default: false },
  menuTarget: { type: Boolean, default: false },
  // '' | 'before' | 'after'：整组拖动时的落点指示
  dropSide: { type: String, default: '' },
  // 落点的轴向：'x' = 左右插入（画竖线）· 'y' = 上下插入（画横线）
  dropAxis: { type: String, default: 'x' },
  // 正被拖来的项目「吸入」中（高亮）
  dropInto: { type: Boolean, default: false },
  // 编辑模式（长按进入）：整组抖动、单击 = 整组选中（不再开弹窗）
  editMode: { type: Boolean, default: false },
  // 编辑模式下整组成员是否都被选中（选中描边）
  selected: { type: Boolean, default: false },
  // 抖动动画的相位偏移（秒，取负值）：整片卡片一齐抖，相位错开才像「一片在动」
  wiggleDelay: { type: [Number, String], default: 0 }
})
const emit = defineEmits([
  'open',
  'menu',
  'drag-start',
  'drag-over-item',
  'drop-item',
  'drag-into',
  'drop-into',
  'drag-leave-group',
  'drag-end',
  'long-press',
  'toggle-select'
])

// 颜色：正常路径上 group.color 一定有值（建组时随机给、读盘时补），这里再兜一次底，
// 是为了「手工改过 app.json / 中途往色板里加了颜色」这类情况不至于画成一块透明方。
const color = computed(() => (isColor(props.group.color) ? props.group.color : GROUP_COLORS[0]))
// 角标数字 = **整个组一共几项**（不管它们此刻在哪个分类里），不是「当前视图里看得见的几项」。
// 组卡是这一堆东西的「身份」：数字说的是这一堆有多少，切到某个分类时它不该变小。
//（某个分类里只剩 1 项时干脆不画组卡，那一项直接回网格 —— 见 store.visibleNodes。）
const total = computed(() => groupMembers(props.group.id).length)

// —— 就地改名 ——
// 名字双击即改（单击是「开弹窗」，与手机上点文件夹一下的概念一致）。
// 右键菜单里的「重命名分组…」也走同一条路：它只是把 renameGroupId 立起来。
const draft = ref('')
const inputEl = ref(null)
const renaming = computed(() => state.renameGroupId === props.group.id)
watch(
  () => state.renameGroupId,
  async (gid) => {
    if (gid !== props.group.id) return
    draft.value = props.group.name
    await nextTick()
    if (inputEl.value) {
      inputEl.value.focus()
      inputEl.value.select()
    }
  }
)
function startRename() {
  draft.value = props.group.name
  state.renameGroupId = props.group.id
}
function commitRename() {
  if (!renaming.value) return
  renameGroup(props.group.id, draft.value)
}
function cancelRename() {
  state.renameGroupId = null
}

// —— 长按进编辑模式 ——
// 组卡也是图标，长按它同样该进编辑模式（时序与普通卡共用 long-press.js）。
// 少这一段的表现很别扭：普通卡按住会抖，组卡按住什么都不发生，像块坏掉的砖。
const press = useLongPress(() => emit('long-press'))

// —— 交互 ——
// 单击：非编辑模式 = 开弹窗；编辑模式 = 整组选中 / 取消（这时候点它是「挑中这一堆」）。
// 名字上双击是改名，所以那一下不当作开弹窗（否则改名时弹窗会乱跳）。
function onClick(e) {
  // 长按松手后跟着的那次 click 要先被吞掉，否则「刚进编辑模式就顺手把弹窗开了」
  if (press.consumeClick()) return
  if (renaming.value) return
  if (props.editMode) {
    emit('toggle-select', props.group.id)
    return
  }
  if (e.target && e.target.closest && e.target.closest('.name')) return
  setOpenGroup(props.group.id)
}
function onNameDblClick() {
  if (props.editMode) return // 编辑模式下单击的语义是点选，双击改名让位
  startRename()
}
function onContextMenu(e) {
  if (props.editMode) return // 编辑模式下主题是多选，不用单卡菜单（与普通卡一致）
  emit('menu', { id: props.group.id, x: e.clientX, y: e.clientY, kind: 'group' })
}

// —— 拖动 ——
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
function onDragStart(e) {
  if (isFileDrag(e)) return
  press.cancel() // 起了原生拖拽 = 用户在拖，不是长按
  e.dataTransfer.effectAllowed = 'move'
  try {
    e.dataTransfer.setData(ITEM_MIME, props.group.id)
  } catch {}
  emit('drag-start')
}
// 落点判定：拖的是**组卡**时，组卡之间走 before/after 排序；
// 拖的是**普通项目**时才把卡面当作「收纳口」，整张卡只表示一件事 —— 进组。
// （这两条必须互斥：同一个 drop 上又插线又吸附，会让人不知道松手会发生什么。）
function onDragOver(e) {
  if (isFileDrag(e) || !isItemDrag(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  if (state.dragGroupId) {
    const mark = sideOf(e)
    emit('drag-over-item', { id: anchorId.value, side: mark.side, axis: mark.axis })
    return
  }
  emit('drag-into', props.group.id)
}
function onDrop(e) {
  if (isFileDrag(e) || !isItemDrag(e)) return
  e.preventDefault()
  e.stopPropagation()
  if (state.dragGroupId) {
    const mark = sideOf(e)
    emit('drop-item', { id: anchorId.value, side: mark.side, axis: mark.axis })
    return
  }
  emit('drop-into', props.group.id)
}
// 指针离开组卡（含被拖到窗口外、拖到别的卡上）时把「收纳口」高亮收回 ——
// 少了这一步，那个虚线框会一直亮着，看上去像还悬在组上。
// relatedTarget 判一下：在卡片内部的子元素之间挪动不算离开（dragleave 会冒泡上来）。
function onDragLeave(e) {
  const to = e.relatedTarget
  if (to && e.currentTarget && e.currentTarget.contains(to)) return
  emit('drag-leave-group')
}
// 排序落点要落到一个**真实存在的 item** 上（commitDrop 靠它在 items 里定位）。
// 组的显示位置就是「组内第一个成员的位置」，所以拿第一个成员当锚点最准。
const anchorId = computed(() => (props.members[0] ? props.members[0].id : ''))
</script>

<template>
  <div
    class="card group-card"
    :class="{
      'drag-src': dragging,
      'ctx-target': menuTarget,
      'drop-before': dropSide === 'before',
      'drop-after': dropSide === 'after',
      'drop-y': !!dropSide && dropAxis === 'y',
      'drop-into': dropInto,
      'is-open': state.openGroupId === group.id,
      selected: selected,
      wiggle: editMode
    }"
    :style="{
      '--group-color': color,
      ...(editMode ? { '--wiggle-delay': wiggleDelay + 's' } : null)
    }"
    :draggable="!renaming"
    :data-group="group.id"
    :data-count="total"
    :data-view-count="members.length"
    :data-color="color"
    :title="`${group.name} · 分组 · ${total} 项`"
    @click="onClick"
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
    @dragend="emit('drag-end')"
  >
    <!-- 脸：一个**和普通图标等大**的方块（复用 .fallback 那套几何 —— 尺寸 / 圆角 /
         文件夹图形大小全由 --card-icon 派生，与兜底头像同一个语言），上面压一枚数字角标。
         角标锚在这一层而不是卡片上：它要贴着图标的右上角（手机上角标的位置），
         而卡片四周还有一圈内边距，锚在卡片上会飘到卡片角上去。 -->
    <div class="group-face">
      <div class="fallback folder">
        <MdIcon name="folder" :size="28" />
      </div>
      <span class="group-count" aria-hidden="true">{{ total }}</span>
    </div>
    <input
      v-if="renaming"
      ref="inputEl"
      v-model="draft"
      class="group-name-input"
      type="text"
      maxlength="24"
      @click.stop
      @pointerdown.stop
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />
    <div v-else class="name" @dblclick.stop="onNameDblClick">{{ group.name }}</div>
  </div>
</template>
