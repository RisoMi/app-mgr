<script setup>
import { ref, computed, nextTick } from 'vue'
import { state, addCategory, renameCategory, deleteCategory, moveItemToCategory, endDrag, showToast } from '../store'
import { getTheme } from '../themes'
import MdIcon from './MdIcon.vue'
import TrafficLights from './TrafficLights.vue'
import logoUrl from '../assets/logo.png'

const emit = defineEmits(['open-settings'])

const editingId = ref(null)
const editName = ref('')

const counts = computed(() => {
  const map = { __uncat: 0 }
  for (const it of state.items) {
    const valid = it.categoryId && state.categories.some((c) => c.id === it.categoryId)
    if (!valid) map.__uncat += 1
    else map[it.categoryId] = (map[it.categoryId] || 0) + 1
  }
  return map
})

const themeName = computed(() => getTheme(state.settings.themeId).name)

async function startRename(c) {
  editingId.value = c.id
  editName.value = c.name
  await nextTick()
  // 聚焦并全选：符合 Windows 重命名（F2）习惯，直接输入即替换旧名，
  // 也避免「光标停在末尾、新名字拼在旧名字后面」的困惑。
  const el = document.querySelector('.cat .rename')
  if (el) {
    el.focus()
    el.select()
  }
}

function commitRename(c) {
  const name = (editName.value || '').trim()
  editingId.value = null
  if (name && name !== c.name) renameCategory(c.id, name)
}

// Enter 提交。注意输入法组合态（中文候选词上屏时也会按 Enter）不能当成提交，
// 否则会把没上屏的半成品名字写进去。统一交给 blur 提交，避免重复提交。
function onRenameKeydown(e) {
  if (e.isComposing || e.keyCode === 229) return
  if (e.key === 'Enter') {
    e.preventDefault()
    e.target.blur()
  }
}

// 新建分类：名字由程序给（「新建分类」/「新建分类 2」…），不再先让用户输一个名字。
// 建完想改名就走分类行上的铅笔（悬停出现），或双击分类名 —— 这条写在操作指南里。
function onAddCategory() {
  showToast(`已新建「${addCategory()}」`)
}

// —— 把卡片拖到分类行上 → 直接归类 ——
// 只认「内部卡片拖拽」的自定义 MIME：从资源管理器拖入文件时 types 里是 Files，
// 不能被当成归类处理（那条路要走窗口级 drop 去添加项目）。
const ITEM_MIME = 'application/x-ql-item'
const UNCUT = '__uncat' // 未分类的归类目标标识（真实分类用 c.id）

function isItemDrag(e) {
  const t = e.dataTransfer && e.dataTransfer.types
  return !!(t && Array.from(t).includes(ITEM_MIME))
}

function onCatDragOver(e, key) {
  if (!isItemDrag(e)) return
  e.preventDefault() // 不 preventDefault 就不会派发 drop
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  if (state.dropCatId !== key) state.dropCatId = key
}

// 分类行内部有 span / button，在子元素之间移动同样会触发 dragleave；
// 只有指针真正离开整行（relatedTarget 不再落在行内）才清除高亮。
function onCatDragLeave(e, key) {
  if (!isItemDrag(e)) return
  const to = e.relatedTarget
  if (to && e.currentTarget && e.currentTarget.contains(to)) return
  if (state.dropCatId === key) state.dropCatId = null
}

function onCatDrop(e, key) {
  if (!isItemDrag(e)) return
  e.preventDefault()
  e.stopPropagation()
  let id = ''
  try {
    id = e.dataTransfer.getData(ITEM_MIME) || ''
  } catch {
    /* ignore */
  }
  // 拖动源在 dragstart 时就已登记进 store（beginDrag），以它为准更稳，
  // 顺带覆盖 dataTransfer 读不出内容的情况（合成事件、异常 DataTransfer 实现等）。
  if (!id) id = state.dragId || ''
  const res = id ? moveItemToCategory(id, key) : null
  // 编辑模式下拖的是整组选中项：提示要如实说「几项」，不然会以为只挪走了一张
  if (res) {
    showToast(
      res.count > 1 ? `已把 ${res.count} 项移到「${res.to}」` : `「${res.name}」已移到「${res.to}」`
    )
  }
  // 归类后卡片可能已不在当前视图里（此时 dragend 不一定触发），兜底清掉拖拽状态
  endDrag()
}
</script>

<template>
  <aside class="sidebar">
    <!-- 无边框窗口：这条 38px 的条就是「新的系统标题栏」。
         整条可拖拽移动窗口（-webkit-app-region: drag 在 CSS 里）；
         三个交通灯自己声明 no-drag，否则点不动。
         高度 38px 是刻意对齐 —— 它占的正是被我们去掉的系统标题栏那块地方。 -->
    <div class="titlebar">
      <TrafficLights />
    </div>

    <div class="sidebar-scroll">
      <div class="brand">
        <img class="brand-logo" :src="logoUrl" alt="QuickLaunch" />
        <span class="brand-title">快捷启动器</span>
      </div>

      <!-- 搜索框：放在品牌标题（LOGO + 名称）下方、分类列表的第一行，
           按名称 / 路径模糊过滤当前分类视图里的快捷方式 -->
      <div class="search-line">
        <div class="search-row">
          <MdIcon name="search" :size="18" class="search-ico" />
          <input
            class="cat-search"
            v-model="state.search"
            type="text"
            placeholder="搜索快捷方式"
            aria-label="搜索快捷方式"
          />
          <button v-if="state.search" class="search-clear" title="清除" @click="state.search = ''">×</button>
        </div>
        <!-- 新建分类：钉在搜索框右侧、同一行（Lei 2026-09-25 从列表底部搬上来）。
             只给图标是因为侧栏内容区只有约 260px，带文字会把搜索框压得太窄；
             名字由 addCategory() 自己给，所以这里不需要任何输入控件。 -->
        <button
          class="add-cat-btn"
          title="新建分类"
          aria-label="新建分类"
          @click="onAddCategory"
        >
          <MdIcon name="add" :size="18" />
        </button>
      </div>

      <div
        class="cat"
        :class="{ active: state.activeCategoryId === 'all' }"
        @click="state.activeCategoryId = 'all'"
      >
        <span>全部</span><span class="count">{{ state.items.length }}</span>
      </div>
      <!-- 「未分类」也是合法归类目标：拖进去 = 移出当前分类。
           「全部」不接管拖放 —— 它不是真实分类，拖上去没有可归入的目标。 -->
      <div
        class="cat"
        :class="{ active: state.activeCategoryId === 'uncat', 'drop-target': state.dropCatId === UNCUT }"
        @click="state.activeCategoryId = 'uncat'"
        @dragover="onCatDragOver($event, UNCUT)"
        @dragleave="onCatDragLeave($event, UNCUT)"
        @drop="onCatDrop($event, UNCUT)"
      >
        <span>未分类</span><span class="count">{{ counts.__uncat }}</span>
      </div>

      <div
        v-for="c in state.categories"
        :key="c.id"
        class="cat has-ops"
        :class="{ active: state.activeCategoryId === c.id, 'drop-target': state.dropCatId === c.id }"
        @click="state.activeCategoryId = c.id"
        @dragover="onCatDragOver($event, c.id)"
        @dragleave="onCatDragLeave($event, c.id)"
        @drop="onCatDrop($event, c.id)"
      >
        <input
          v-if="editingId === c.id"
          class="rename"
          :value="editName"
          @input="editName = $event.target.value"
          @keydown="onRenameKeydown($event)"
          @blur="commitRename(c)"
          @click.stop
          @pointerdown.stop
        />
        <span v-else>{{ c.name }}</span>
        <span class="ops" v-if="editingId !== c.id">
          <button class="icon-btn" title="重命名" @click.stop="startRename(c)">
            <MdIcon name="edit" />
          </button>
          <button class="icon-btn danger" title="删除分类" @click.stop="deleteCategory(c.id)">
            <MdIcon name="delete" />
          </button>
        </span>
        <span class="count" v-if="editingId !== c.id">{{ counts[c.id] || 0 }}</span>
      </div>
    </div>

    <!-- 底部常驻：设置入口 -->
    <div class="sidebar-foot">
      <div class="cat side-setting" @click="emit('open-settings')">
        <span class="side-setting-label">
          <MdIcon name="settings" :size="18" />
          <span>设置</span>
        </span>
        <span class="meta">{{ themeName }}</span>
      </div>
    </div>
  </aside>
</template>
