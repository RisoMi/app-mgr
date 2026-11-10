<script setup>
import { ref, nextTick } from 'vue'
import {
  state,
  setTheme,
  setMode,
  setCardStyle,
  CARD_STYLES,
  setIconSize,
  ICON_SIZES,
  persist,
  showToast
} from '../store'
import { THEMES, paletteOf } from '../themes'
import { electronAPI } from '../api'
import { repairAllIcons } from '../icon-repair'
import MdIcon from './MdIcon.vue'

const emit = defineEmits(['close'])

// 色板预览：取该主题「当前明暗模式」下的真实令牌渲染，
// 这样切换深色时缩略图会同步变暗，所见即所得。
function swatchStyle(id) {
  const p = paletteOf(id, state.settings.mode)
  return {
    background: p.surface,
    borderColor: p['outline-variant'],
    '--sw-primary': p.primary,
    '--sw-primary-container': p['primary-container'],
    '--sw-secondary-container': p['secondary-container'],
    '--sw-on-surface': p['on-surface']
  }
}

// 「应用图标修复」：一键重抽所有项目的系统图标。
// 具体规则在 icon-repair.js（纯函数、可单测）；这里只负责进度、落盘与提示。
const fixing = ref(false)
const fixMsg = ref('')

async function repairIcons() {
  if (fixing.value) return
  fixing.value = true
  fixMsg.value = '准备中…'
  try {
    await nextTick() // 先把「正在修复…」渲染出来
    const res = await repairAllIcons({
      items: state.items,
      extractIcon: electronAPI.extractIcon,
      onProgress: (n, total) => {
        fixMsg.value = `正在修复 ${n} / ${total}…`
      }
    })
    if (!res.total) {
      fixMsg.value = '没有可修复的项目'
      showToast('没有可修复的项目')
      return
    }
    if (res.ok) persist()
    fixMsg.value =
      `已修复 ${res.ok} 项` +
      (res.skipped ? `，跳过 ${res.skipped} 项（无系统图标或路径失效）` : '')
    showToast(`图标修复完成：${res.ok} 项`)
  } catch (e) {
    fixMsg.value = '修复中断：' + (e && e.message ? e.message : String(e))
    showToast('图标修复中断')
  } finally {
    fixing.value = false
  }
}
</script>

<template>
  <div class="mask" @click.self="emit('close')">
    <div class="dialog settings-dialog">
      <div class="set-head">
        <h2>设置</h2>
      </div>

      <div class="set-body">
      <section class="set-section">
        <div class="set-title">
          <MdIcon name="palette" :size="18" />
          <span>主题配色</span>
        </div>
        <div class="set-desc">选择一套配色，界面即时生效</div>
        <div class="theme-grid">
          <button
            v-for="t in THEMES"
            :key="t.id"
            class="theme-item"
            :class="{ on: state.settings.themeId === t.id }"
            @click="setTheme(t.id)"
          >
            <span class="theme-swatch" :style="swatchStyle(t.id)">
              <span class="sw-bar"></span>
              <span class="sw-dot"></span>
              <span class="sw-dot sub"></span>
            </span>
            <span class="theme-name">{{ t.name }}</span>
            <MdIcon v-if="state.settings.themeId === t.id" class="theme-check" name="check" :size="16" />
          </button>
        </div>
      </section>

      <section class="set-section">
        <div class="set-title">
          <MdIcon :name="state.settings.mode === 'dark' ? 'darkMode' : 'lightMode'" :size="18" />
          <span>外观模式</span>
        </div>
        <div class="set-desc">浅色 / 深色，跟随同一套配色</div>
        <div class="type-toggle mode-toggle">
          <button :class="{ on: state.settings.mode === 'light' }" @click="setMode('light')">
            <MdIcon name="lightMode" :size="16" />
            <span>浅色</span>
          </button>
          <button :class="{ on: state.settings.mode === 'dark' }" @click="setMode('dark')">
            <MdIcon name="darkMode" :size="16" />
            <span>深色</span>
          </button>
        </div>
      </section>

      <section class="set-section">
        <div class="set-title">
          <MdIcon name="gridView" :size="18" />
          <span>图标显示</span>
        </div>
        <div class="set-desc">
          卡片（带外壳）· 原生（去掉外壳，只留图标与名称）· 仅图标（最紧凑，一屏放最多）
        </div>
        <div class="theme-grid">
          <button
            v-for="s in CARD_STYLES"
            :key="s.id"
            class="theme-item"
            :class="{ on: state.settings.cardStyle === s.id }"
            @click="setCardStyle(s.id)"
          >
            <span class="style-preview" :class="'pv-' + s.id">
              <span class="pv-shell"></span>
              <span class="pv-app"></span>
              <span class="pv-line"></span>
            </span>
            <span class="theme-name">{{ s.name }}</span>
            <MdIcon v-if="state.settings.cardStyle === s.id" class="theme-check" name="check" :size="16" />
          </button>
        </div>

        <div class="set-sub">
          <span>图标尺寸</span>
          <span class="set-sub-hint">三套样式都跟随 · 默认 32 × 32</span>
        </div>
        <div class="size-grid">
          <button
            v-for="z in ICON_SIZES"
            :key="z.id"
            class="theme-item"
            :class="{ on: state.settings.iconSize === z.id }"
            @click="setIconSize(z.id)"
          >
            <span class="size-stage">
              <span class="size-box" :style="{ width: z.demo + 'px', height: z.demo + 'px' }"></span>
            </span>
            <span class="theme-name">{{ z.label }}</span>
            <MdIcon v-if="state.settings.iconSize === z.id" class="theme-check" name="check" :size="16" />
          </button>
        </div>
      </section>

      <section class="set-section">
        <div class="set-title">
          <MdIcon name="refresh" :size="18" />
          <span>图标维护</span>
        </div>
        <div class="set-desc">
          重新从应用 / 快捷方式抽取系统图标，会覆盖已有图标；抽不到的改为首字母图标。
        </div>
        <div class="fix-row">
          <button class="btn ghost" :disabled="fixing" @click="repairIcons">
            <MdIcon name="refresh" :size="16" />
            <span>{{ fixing ? '正在修复…' : '应用图标修复' }}</span>
          </button>
          <span v-if="fixMsg" class="fix-msg">{{ fixMsg }}</span>
        </div>
      </section>

      <section class="set-section">
        <div class="set-title">
          <MdIcon name="edit" :size="18" />
          <span>操作方式</span>
        </div>
        <div class="set-desc">
          双击项目启动 · 右键项目打开菜单（编辑 / 删除 / 打开位置）· 按住拖动项目可排序，拖到左侧分类可归类
        </div>
      </section>

      </div>

      <div class="dialog-actions set-foot">
        <button class="btn" @click="emit('close')">完成</button>
      </div>
    </div>
  </div>
</template>
