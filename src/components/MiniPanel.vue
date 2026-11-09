<script setup>
// mini 模式的界面：品牌标题栏 + 收藏平铺网格（Launchpad 式）。
//
// 只做四件事（Lei 2026-10-26 拍板的只读边界）：
//   展示收藏 · 双击启动 · 置顶开关 · 关闭（收托盘，与完整态一致）。
// 不接拖拽（不参与排序/归类）、不接右键菜单（收藏/取消收藏请回完整模式做）。
//
// 收藏网格与图标区**同一套零件**：favoriteItems() + ItemCard + .grid。
// 于是行为（双击启动 / 图标兜底 / 启动动效 / 名字截断）全部自动与完整态一致。
// 外观不共用：完整态是「一扇窗口」，mini 是「一片浮起来的启动器」——
// 卡片在 styles.css 的 mini 段里被重写成透明瓷砖（见该段注释），这里只管结构。
import { computed } from 'vue'
import { state, favoriteItems } from '../store'
import ItemCard from './ItemCard.vue'
import MdIcon from './MdIcon.vue'

const emit = defineEmits(['exit', 'toggle-top'])
const favs = computed(() => favoriteItems())
// 置顶态：按钮外观与 title 文案都跟着它走（探针按 aria-label 找按钮、按 title 验状态）
const topOn = computed(() => !!(state.settings.mini && state.settings.mini.alwaysOnTop))

function onClose() {
  // 关闭与完整态同一语义：收进托盘（win-close 的拦截在 tray-lifecycle）
  window.electronAPI && window.electronAPI.winClose && window.electronAPI.winClose()
}
</script>

<template>
  <div class="mini-panel">
    <!-- 标题栏 = 拖拽区（整条 -webkit-app-region: drag）。
         左侧品牌区（星标 + 「收藏」+ 计数药丸）跟着拖；右侧按钮胶囊整体 no-drag，
         否则点击会被拖窗口吞掉。分割线画在栏的底边（见 styles.css）。 -->
    <header class="mini-bar">
      <div class="mini-brand">
        <span class="mini-mark" aria-hidden="true">
          <MdIcon name="star" :size="13" />
        </span>
        <span class="mini-title">收藏</span>
        <span class="mini-count" :aria-label="`共 ${favs.length} 个收藏`">{{ favs.length }}</span>
      </div>
      <div class="mini-actions">
        <button
          type="button"
          class="mini-btn"
          :class="{ on: topOn }"
          :title="topOn ? '取消置顶' : '置顶显示'"
          :aria-pressed="topOn ? 'true' : 'false'"
          aria-label="置顶开关"
          @click="emit('toggle-top', !topOn)"
        >
          <MdIcon name="pin" :size="15" />
        </button>
        <button
          type="button"
          class="mini-btn"
          title="返回完整模式"
          aria-label="返回完整模式"
          @click="emit('exit')"
        >
          <MdIcon name="fullscreen" :size="15" />
        </button>
        <button
          type="button"
          class="mini-btn"
          title="关闭（收起窗口，后台继续运行）"
          aria-label="关闭（收起窗口，后台继续运行）"
          @click="onClose"
        >
          <MdIcon name="close" :size="15" />
        </button>
      </div>
    </header>

    <!-- 网格区：与图标区同款卡片，关掉拖拽（mini 是快速启动面板，不排序不归类）。
         少收藏时整组垂直居中；多到溢出才滚动（见 styles.css 的 margin-block/safe center）。 -->
    <div class="mini-body">
      <div v-if="favs.length" class="grid">
        <ItemCard v-for="f in favs" :key="f.id" :item="f" :draggable="false" />
      </div>
      <!-- 空态：星形圆牌 + 两行文案。「怎么收藏」跟着当前状态走，不算散落的操作说明 -->
      <div v-else class="mini-empty">
        <span class="mini-empty-icon" aria-hidden="true">
          <MdIcon name="starBorder" :size="26" />
        </span>
        <span class="mini-empty-title">还没有收藏</span>
        <span class="mini-empty-sub">在完整模式里右键图标即可收藏</span>
      </div>
    </div>
  </div>
</template>
