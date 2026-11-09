<script setup>
// macOS 风格「交通灯」——无边框窗口（main 里 frame:false）的自绘窗口按钮。
//
// 为什么自绘而不是用 Electron 的 titleBarOverlay：那套只能给你 Windows 风格的
// 方角按钮，且配色/间距不可控；既然要的是 Mac 观感，就三个圆点自己画。
//
// 三个灯的行为对齐 macOS：
//  · 红=关闭 / 黄=最小化 / 绿=最大化↔还原（最大化后换图形）
//  · 图形只在鼠标进入整组灯时浮现（平时是纯色圆点，安静）
//  · 窗口失焦时整组变灰 —— 这是 macOS 上区分「当前窗口」最直接的信号
// 本组件只发意图，窗口操作全在主进程（win-* 那几个 IPC）。
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { electronAPI } from '../api'

const maximized = ref(false)
const focused = ref(true)

function apply(s) {
  if (!s) return
  if (typeof s.maximized === 'boolean') maximized.value = s.maximized
  if (typeof s.focused === 'boolean') focused.value = s.focused
}

// 注册在主进程推来的状态上（最大化/还原/聚焦/失焦都会推）
let offWinState = null
onMounted(async () => {
  try {
    if (electronAPI.onWinState) offWinState = electronAPI.onWinState(apply)
  } catch {
    /* 桥不可用时保持默认态，不影响其它功能 */
  }
  try {
    if (electronAPI.winState) apply(await electronAPI.winState())
  } catch {
    /* 首帧状态取不到就按「未最大化 + 已聚焦」显示，随后会被推送纠正 */
  }
})
onBeforeUnmount(() => {
  try {
    if (typeof offWinState === 'function') offWinState()
  } catch {
    /* ignore */
  }
})

function minimize() {
  try {
    if (electronAPI.winMinimize) electronAPI.winMinimize()
  } catch {
    /* ignore */
  }
}
async function toggleMaximize() {
  try {
    if (!electronAPI.winToggleMaximize) return
    // 主进程回传的就是最新状态，直接采纳（比等事件回来更快，也不会跳一帧）
    const r = await electronAPI.winToggleMaximize()
    apply(r)
  } catch {
    /* ignore */
  }
}
function close() {
  try {
    if (electronAPI.winClose) electronAPI.winClose()
  } catch {
    /* ignore */
  }
}
</script>

<template>
  <!-- .lights 必须 no-drag：否则点不动（整个 .titlebar 都是拖拽区） -->
  <div class="lights" :class="{ unfocused: !focused }" role="group" aria-label="窗口控制">
    <button type="button" class="light close" title="关闭（收起窗口，后台继续运行）" aria-label="关闭" @click="close">
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M4.35 4.35 7.65 7.65M7.65 4.35 4.35 7.65" />
      </svg>
    </button>

    <button type="button" class="light min" title="最小化" aria-label="最小化" @click="minimize">
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <path d="M3.6 6h4.8" />
      </svg>
    </button>

    <button
      type="button"
      class="light max"
      :title="maximized ? '向下还原' : '最大化'"
      :aria-label="maximized ? '向下还原' : '最大化'"
      @click="toggleMaximize"
    >
      <svg viewBox="0 0 12 12" aria-hidden="true">
        <!-- 未最大化：两个朝外的三角（macOS 的「缩放」图形）
             已最大化：换成朝内的两个三角，表示「还原」 -->
        <path v-if="!maximized" d="M3.6 3.6h3.3L3.6 6.9zM8.4 8.4H5.1L8.4 5.1z" />
        <path v-else d="M8.4 3.6v3.3L5.1 3.6zM3.6 8.4V5.1l3.3 3.3z" />
      </svg>
    </button>
  </div>
</template>
