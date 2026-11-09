<script setup>
import { reactive, ref, computed, onMounted } from 'vue'
import { electronAPI } from '../api'
import { addItem, updateItem, deleteItem, removeLogo, showToast, state } from '../store'

const props = defineProps({
  item: { type: Object, default: null },
  defaultCategoryId: { type: String, default: '' }
})
const emit = defineEmits(['close'])

const form = reactive({ id: null, name: '', type: 'app', path: '', args: '', workDir: '', logo: null, categoryId: '' })
const oldLogo = ref(null)
// 本次对话框内自动提取的图标（未保存时随取消清理，避免残留孤儿文件）
const tempAuto = ref(null)

onMounted(() => {
  if (props.item) {
    form.id = props.item.id
    form.name = props.item.name || ''
    form.type = props.item.type || 'app'
    form.path = props.item.path || ''
    form.args = props.item.args || ''
    form.workDir = props.item.workDir || ''
    form.logo = props.item.logo || null
    form.categoryId = props.item.categoryId || ''
    oldLogo.value = props.item.logo || null
  } else {
    const d = props.defaultCategoryId
    form.categoryId = d && d !== 'all' && d !== 'uncat' ? d : ''
  }
})

// 图标直接是 data URL（跨平台、零协议）；旧版的 appres:// 已废弃
const previewSrc = computed(() => (form.logo ? form.logo : ''))

const palette = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']
function colorFor(name) {
  let s = 0
  for (const ch of name || '') s += ch.charCodeAt(0)
  return palette[s % palette.length]
}
const initial = computed(() => (form.name || '?').trim().charAt(0).toUpperCase())
const bg = computed(() => colorFor(form.name || ''))

function basename(p) {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1].replace(/\.(exe|lnk|bat|cmd|url|appref-ms|app|command|sh|scpt)$/i, '')
}

async function pickPath() {
  const p = form.type === 'folder' ? await electronAPI.pickFolder() : await electronAPI.pickFile()
  if (!p) return
  form.path = p
  if (!form.name) form.name = basename(p)
  // 选程序时自动提取原生图标作为默认 Logo
  if (form.type === 'app') {
    const rel = await electronAPI.extractIcon(p)
    if (rel) {
      if (tempAuto.value && tempAuto.value !== rel) removeLogo(tempAuto.value)
      tempAuto.value = rel
      form.logo = rel
    }
  }
}

function onLogo(e) {
  const file = e.target.files[0]
  if (!file) return
  // 自定义上传会覆盖自动提取的图标
  if (tempAuto.value) {
    removeLogo(tempAuto.value)
    tempAuto.value = null
  }
  form.logo = null
  const reader = new FileReader()
  reader.onload = async () => {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase()
    form.logo = await electronAPI.saveLogo(reader.result, ext)
  }
  reader.readAsDataURL(file)
}

function clearLogo() {
  if (tempAuto.value) {
    removeLogo(tempAuto.value)
    tempAuto.value = null
  }
  form.logo = null
}

// 取消/遮罩关闭：清理本次未保存的自动图标
function closeDialog() {
  if (tempAuto.value) {
    removeLogo(tempAuto.value)
    tempAuto.value = null
  }
  emit('close')
}

function save() {
  if (!form.name.trim()) return showToast('请填写名称')
  if (!form.path.trim()) return showToast('请选择路径')
  const payload = {
    name: form.name.trim(),
    type: form.type,
    path: form.path.trim(),
    args: form.args.trim(),
    workDir: form.workDir.trim(),
    logo: form.logo,
    categoryId: form.categoryId
  }
  if (form.id) {
    if (oldLogo.value && oldLogo.value !== form.logo) removeLogo(oldLogo.value)
    updateItem(form.id, payload)
  } else {
    addItem(payload)
  }
  emit('close')
}

function remove() {
  if (tempAuto.value) {
    removeLogo(tempAuto.value)
    tempAuto.value = null
  }
  if (form.id) {
    if (form.logo) removeLogo(form.logo)
    deleteItem(form.id)
  }
  emit('close')
}
</script>

<template>
  <div class="mask" @click.self="closeDialog">
    <div class="dialog">
      <h2>{{ form.id ? '编辑项目' : '添加项目' }}</h2>

      <div class="field">
        <label>名称</label>
        <input type="text" v-model="form.name" placeholder="例如：VS Code" />
      </div>

      <div class="field">
        <label>类型</label>
        <div class="type-toggle">
          <button :class="{ on: form.type === 'app' }" @click="form.type = 'app'">程序 / 快捷方式</button>
          <button :class="{ on: form.type === 'folder' }" @click="form.type = 'folder'">文件夹</button>
        </div>
      </div>

      <div class="field">
        <label>路径</label>
        <div class="path-row">
          <input type="text" class="path" v-model="form.path" :placeholder="form.type === 'folder' ? '文件夹路径' : '程序路径'" />
          <button class="btn ghost" @click="pickPath">选择</button>
        </div>
      </div>

      <template v-if="form.type === 'app'">
        <div class="field">
          <label>启动参数（空格分隔）</label>
          <input type="text" v-model="form.args" placeholder="例如：--new-window -p 8080" />
        </div>
        <div class="field">
          <label>工作目录（可选）</label>
          <input type="text" v-model="form.workDir" placeholder="留空则继承程序所在目录" />
        </div>
      </template>

      <div class="field">
        <label>分类</label>
        <select v-model="form.categoryId">
          <option value="">未分类</option>
          <option v-for="c in state.categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </div>

      <div class="field">
        <label>Logo（可选，留空显示程序自带图标）</label>
        <div class="logo-pick">
          <img v-if="previewSrc" :src="previewSrc" alt="logo" />
          <div v-else-if="form.type === 'folder'" class="fallback folder">📁</div>
          <div v-else class="fallback" :style="{ background: bg }">{{ initial }}</div>
          <div class="logo-actions">
            <label class="btn ghost file-label">
              选择图片
              <input type="file" accept="image/*" @change="onLogo" hidden />
            </label>
            <button class="btn ghost danger" v-if="form.logo" @click="clearLogo">清除 Logo</button>
          </div>
        </div>
      </div>

      <div class="dialog-actions">
        <button class="btn ghost danger" v-if="form.id" @click="remove">删除</button>
        <span style="flex: 1"></span>
        <button class="btn ghost" @click="closeDialog">取消</button>
        <button class="btn" @click="save">保存</button>
      </div>
    </div>
  </div>
</template>
