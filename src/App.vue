<script setup>
import { onMounted, ref } from 'vue'
import api from './api.js'

const platform = ref('…')
const ping = ref('…')
const itemCount = ref(null)
const topMost = ref(false)
const error = ref('')

async function load() {
  try {
    const data = await api.loadData()
    itemCount.value = Array.isArray(data.items) ? data.items.length : 0
  } catch (e) {
    error.value = String(e)
  }
}

async function toggleTop() {
  try {
    topMost.value = !topMost.value
    await api.setAlwaysOnTop(topMost.value)
  } catch (e) {
    error.value = String(e)
  }
}

onMounted(async () => {
  try {
    platform.value = await api.getPlatform()
    ping.value = await api.ping()
    await load()
  } catch (e) {
    error.value = String(e)
  }
})
</script>

<template>
  <main class="shell">
    <section class="card">
      <div class="brand">
        <div class="mark">AM</div>
        <div>
          <h1>AppMgr</h1>
          <p>轻量化跨平台启动器 · Windows + macOS</p>
        </div>
      </div>

      <div class="rows">
        <div class="row"><span>运行平台</span><b>{{ platform }}</b></div>
        <div class="row"><span>Rust 通道</span><b>{{ ping }}</b></div>
        <div class="row"><span>数据项</span><b>{{ itemCount === null ? '—' : itemCount }}</b></div>
      </div>

      <div class="actions">
        <button type="button" @click="load">重新读取数据</button>
        <button type="button" :class="{ on: topMost }" @click="toggleTop">
          {{ topMost ? '取消置顶' : '窗口置顶' }}
        </button>
      </div>

      <p v-if="error" class="err">{{ error }}</p>
      <p class="note">阶段 0 骨架：验证双平台构建链路。业务功能按阶段迁入。</p>
    </section>
  </main>
</template>
