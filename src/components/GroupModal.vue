<script setup>
// 分组弹窗：点组卡浮起来的一扇小窗，里面就是组内成员。
//
// 为什么从「就地铺开」改成弹窗：
// ① 就地铺开是把面板塞进图标区的网格流里（跨整行、顶掉组卡、把后面的卡推下去）——
//    组一多，图标区里一半是卡片一半是面板，滚半天找不到东西，视线也没有落点。
// ② 做成一扇窗之后，「打开一个组」= 视线收进这一组，关掉就回到原处，
//    图标区的版式完全不受影响（组卡不再被顶掉、后面的卡片不再被推走）。
// 顺带与项目编辑/设置两个对话框统一了语言（同一个 .mask + .dialog）。
//
// 三件事在这里落地：
// ① 组内成员用图标区同款 ItemCard —— 双击启动、右键菜单、可拖动全部继承，不另写一套；
// ② 长按 → 进入编辑模式（复用全局那一套：底部操作条浮到遮罩之上，
//    此刻它上面的「分组」按钮换成「移出分组」）；
// ③ 把卡片拖到**窗口外面**（遮罩上）松手 = 移出分组 —— 手机文件夹的老手势。
import { computed, ref } from 'vue'
import { state } from '../store'
import ItemCard from './ItemCard.vue'
import MdIcon from './MdIcon.vue'

const props = defineProps({
  // 组本体：{ id, name }
  group: { type: Object, required: true },
  // 当前视图内的成员（分类 / 搜索过滤后），按显示顺序
  members: { type: Array, default: () => [] },
  editMode: { type: Boolean, default: false }
})
const emit = defineEmits([
  'close',
  'menu',
  'drag-start',
  'drag-over-item',
  'drop-item',
  'drag-end',
  'long-press',
  'toggle-select',
  'remove-members'
])

const name = computed(() => props.group.name)

// —— 拖到窗口外 = 移出分组 ——
// 落点判据用 `.self`：只有指针真的落在**遮罩本身**（= 窗口外的空白）上才算数，
// 落在对话框内部的空白处什么也不做 —— 拖回组里松开不该等于「移出」。
const ITEM_MIME = 'application/x-ql-item'
function isItemDrag(e) {
  const t = e.dataTransfer && e.dataTransfer.types
  return !!(t && Array.from(t).includes(ITEM_MIME))
}
// 只有「从本组里拖出来的成员」才谈得上移出：别把别的来源误判成要退组
const canDragOut = computed(() => !!state.dragFromGroup && state.dragFromGroup === props.group.id)
const overBg = ref(false)
function onBgDragOver(e) {
  if (!isItemDrag(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
  if (canDragOut.value) overBg.value = true
}
// 指针回到窗口里（dialog 上）就取消「要掉出去」的提示；
// 彻底离开窗口时同理（那种情况不会有 drop，靠这条把状态收干净）。
function onBgDragLeave() {
  overBg.value = false
}
function onBgDrop(e) {
  if (!isItemDrag(e)) return
  e.preventDefault()
  overBg.value = false
  const ids = state.dragIds.slice()
  if (canDragOut.value && ids.length) emit('remove-members', ids)
}
</script>

<template>
  <div
    class="mask group-mask"
    @click.self="emit('close')"
    @contextmenu.prevent.self
    @dragover.self="onBgDragOver"
    @dragleave.self="onBgDragLeave"
    @drop.self="onBgDrop"
    @dragend="onBgDragLeave"
  >
    <section
      class="dialog group-modal"
      :class="{ 'drag-out': overBg }"
      :data-group="group.id"
      :data-count="members.length"
      @click.stop
      @contextmenu.prevent.stop
    >
      <header class="gm-head">
        <!-- 文件夹图形跟着组卡的颜色走：收起弹窗后回到网格里，一眼能认出刚才打开的是哪个组。
             （MdIcon 是单根 svg，style 会透传到根元素上，图形用的是 fill: currentColor。） -->
        <MdIcon name="folderOpen" :size="20" :style="group.color ? { color: group.color } : null" />
        <span class="gm-title">{{ name }}</span>
        <span class="gm-count">{{ members.length }} 项</span>
        <button type="button" class="gm-close" title="收起分组" aria-label="收起分组" @click="emit('close')">
          <MdIcon name="close" :size="16" />
        </button>
      </header>
      <div class="gm-body">
        <div class="grid">
          <ItemCard
            v-for="(m, idx) in members"
            :key="m.id"
            :item="m"
            :dragging="state.dragIds.includes(m.id)"
            :menu-target="!!state.ctxMenu && state.ctxMenu.id === m.id"
            :drop-side="state.dropMark && state.dropMark.id === m.id ? state.dropMark.side : ''"
            :edit-mode="editMode"
            :selected="editMode && state.selectedIds.includes(m.id)"
            :wiggle-delay="-(idx % 6) * 0.06"
            @menu="emit('menu', $event)"
            @drag-start="emit('drag-start', { id: $event, groupId: group.id })"
            @drag-over-item="emit('drag-over-item', $event)"
            @drop-item="emit('drop-item', $event)"
            @drag-end="emit('drag-end')"
            @long-press="emit('long-press')"
            @toggle-select="emit('toggle-select', $event)"
          />
        </div>
      </div>
      <footer class="gm-foot">
        {{
          overBg
            ? '松开即移出分组'
            : editMode
              ? '点卡片多选 · 操作条可移出分组 / 收藏 / 删除 · Esc 退出编辑'
              : '长按可进入编辑 · 把卡片拖到窗口外即移出分组'
        }}
      </footer>
    </section>
  </div>
</template>
