<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  FOLDER_COLORS,
  GROUP_COLORS,
  deleteItem,
  dissolveGroup,
  folderColorOf,
  isFavorite,
  isGroupOpen,
  launch,
  removeFromGroup,
  setGroupColor,
  setItemColor,
  setRenameGroup,
  setOpenGroup,
  showToast,
  toggleFavorite
} from '../store'
import { electronAPI } from '../api'
import MdIcon from './MdIcon.vue'

const props = defineProps({
  item: { type: Object, required: true },
  x: { type: Number, required: true },
  y: { type: Number, required: true },
  // 'item' = 普通项目卡；'group' = 分组卡（调色 / 重命名 / 解散）
  kind: { type: String, default: 'item' }
})
const emit = defineEmits(['close', 'edit'])

// 菜单项清单 —— 后续要加操作，往这里加一条即可（{ sep: true } 是分隔线）。
// 数组驱动的好处：加项不用碰模板，样式也自动一致。
// 分组卡与普通项目卡共用这个组件、但清单不同：菜单项由 kind 决定。
const MENU = computed(() => {
  if (props.kind === 'group') {
    return [
      { id: 'rename', label: '重命名分组…', icon: 'edit' },
      { sep: true },
      { id: 'dissolve', label: '解散分组', icon: 'folderOpen' }
    ]
  }
  // 收藏是**单项切换**：已在收藏夹里就显示「取消收藏」（实心星），否则「收藏」（空心星）。
  // 判据直接读 store.isFavorite —— 收藏状态是全局列表（state.favorites），项目身上没有这个字段。
  const fav = isFavorite(props.item.id)
  const list = [
    { id: 'open', label: '打开', icon: 'play' },
    { id: 'reveal', label: '打开位置', icon: 'folder' },
    { id: 'fav', label: fav ? '取消收藏' : '收藏', icon: fav ? 'star' : 'starBorder' },
    { sep: true },
    { id: 'edit', label: '编辑…', icon: 'edit' }
  ]
  // 已进组的项目多一条「移出分组」：就地把它退回网格。
  // 判据直接读 item.groupId，不另传 prop —— 有没有进组这件事项目自己最清楚。
  if (props.item.groupId) list.push({ id: 'ungroup', label: '移出分组', icon: 'folderOpen' })
  list.push({ id: 'delete', label: '删除', icon: 'delete', danger: true })
  return list
})

// ---------- 「调整颜色」块（分组卡 · 文件夹卡） ----------
// 现在就**一排色点**（Lei 三轮砍出来的结果，别再往回加控件）：
//   ①「右键菜单中添加调整颜色选项……不仅要支持文件夹颜色调整，还需要支持文件夹外部的彩虹色调整，
//      最好都改成颜色滑条」→ 7 色点 + 一条色相滑条；
//   ②「不需要支持调整卡片底色，图标中心白色的文件夹，这个需要支持调整颜色」
//      → 卡片底色整条链（bgHue / .tinted）删掉，滑条改成给方块里那个文件夹图形上色；
//   ③「去除文件夹图形调色滑条和文件夹调色滑条，保留 7 个调色选项」（2026-09-25）
//      → 两条滑条全删、图形固定纯白（group.ink 整条链删除），面板回到「一排色点」。
//   ④「文件夹的颜色也添加和分组一样支持右键调节」（Lei 2026-09-25，同一块面板给文件夹卡用上）
//      → 分组调的是**方块底色**（--group-color，图形恒白）；文件夹调的是**图形本身**
//        （文件夹卡没有底板，见 styles.css 的 .card .fallback.folder）。
//        同一个块、同一套交互，只是「颜色落在哪」不同 —— 由下面 isGroup 分流。
// ⚠️ 这一整块**故意不写成 `.ctx-item`**：`.ctx-item` 是「一条操作」的语言，这里是选择器；
//    验收台里钉「分组菜单就那两条（.ctx-item）」的断言因此不用改口径。
//
// ⚠️ 点色点**不关菜单**：换颜色本来就要来回试几次（色点挨个比一遍），
//    点一下就关会逼着人「右键 → 点 → 再右键 → 再点」。想收掉点菜单外面 / 按 Esc。
const isGroup = computed(() => props.kind === 'group')
// 只有**文件夹类型的项目卡**该有这排色点：其它项目的脸是位图图标，或按名字取稳定色的字母头像，
// item.color 对它们没有任何作用 —— 给它们显示色点就是个「点了没反应」的假控件。
const isFolder = computed(() => props.kind !== 'group' && !!props.item && props.item.type === 'folder')
const showColor = computed(() => isGroup.value || isFolder.value)
// 两边色板不同：分组是那 7 个彩虹色；文件夹多一个「默认黄」（见 store.FOLDER_COLORS）——
// 少了它，文件夹改成别的颜色之后就再也调不回默认的 Windows 黄。
const swatches = computed(() => (isGroup.value ? GROUP_COLORS : FOLDER_COLORS))
// 当前色：分组读 group.color（建组时就有值）；文件夹读**生效色**（item.color 缺省回落到默认黄）——
// 读裸 item.color 的话，没调过色的文件夹这一排点一个勾都没有，看不出现在是哪个颜色。
const currentColor = computed(() =>
  isGroup.value ? (props.item ? props.item.color : '') : folderColorOf(props.item)
)
function pickColor(c) {
  // 同色 / 对象不存在都返回 false，那种情况下什么也不做
  if (isGroup.value) setGroupColor(props.item.id, c)
  else setItemColor(props.item.id, c)
}

// 与窗口边缘留的间距
const EDGE = 8
const el = ref(null)
// ready 之前先不可见：定位要等渲染完量到尺寸才能翻转，否则会看到菜单先出现在
// 鼠标位置、再跳到别处（一帧的闪烁，很难看）。
const ready = ref(false)
const pos = ref({ x: props.x, y: props.y })

async function place() {
  pos.value = { x: props.x, y: props.y }
  await nextTick()
  const box = el.value ? el.value.getBoundingClientRect() : null
  if (!box) {
    ready.value = true
    return
  }
  let { x, y } = pos.value
  // 超出右/下边界就翻转（贴着鼠标弹出，而不是被裁掉一半）
  if (x + box.width > window.innerWidth - EDGE) x = window.innerWidth - EDGE - box.width
  if (y + box.height > window.innerHeight - EDGE) y = window.innerHeight - EDGE - box.height
  pos.value = { x: Math.max(EDGE, Math.round(x)), y: Math.max(EDGE, Math.round(y)) }
  ready.value = true
}

function run(entry) {
  if (!entry || entry.sep) return
  const item = props.item
  if (entry.id === 'open') {
    launch(item)
  } else if (entry.id === 'reveal') {
    // 主进程会把快捷方式解析成真实目标再定位（.lnk 在桌面上时，直接定位只会停在桌面）。
    // 解析不出来 / 目标已失效时它不报错，而是退回快捷方式本身并给一句 warning —— 照实转达，
    // 否则用户看到资源管理器停在桌面会以为功能坏了。
    const p = electronAPI.revealItem(item.path)
    if (p && typeof p.then === 'function') {
      p.then((r) => {
        if (r && !r.ok) showToast('无法打开位置：' + (r.error || '未知错误'))
        else if (r && r.warning) showToast(r.warning)
      }).catch((err) => showToast('无法打开位置：' + (err && err.message ? err.message : String(err))))
    }
  } else if (entry.id === 'fav') {
    // 单项收藏切换。提示语与操作条（App.vue 的 onToggleFavorite）同一口径 ——
    // 两处都走同一个 store，措辞也别分家。
    const on = toggleFavorite(item.id)
    showToast(on ? `已收藏「${item.name}」 · 点图标区顶部的小三角可查看` : `已从收藏夹移除「${item.name}」`)
  } else if (entry.id === 'edit') {
    emit('edit', item)
  } else if (entry.id === 'delete') {
    deleteItem(item.id)
    showToast(`已删除「${item.name}」`)
  } else if (entry.id === 'ungroup') {
    if (removeFromGroup(item.id)) showToast(`已把「${item.name}」移出分组`)
  } else if (entry.id === 'rename') {
    // 改名入口挂在卡片自己身上（名称就地变输入框）：先把可能开着的分组弹窗收起来 ——
    // 弹窗是盖在图标区之上的遮罩，而改名输入框在卡片上、在遮罩底下，不收起来就看不见也点不到。
    // 这里用 setOpenGroup 而不是 closeGroup：它顺手把 renameGroupId 清干净，正好接下一行。
    if (isGroupOpen(item.id)) setOpenGroup(item.id)
    setRenameGroup(item.id)
  } else if (entry.id === 'dissolve') {
    const n = dissolveGroup(item.id)
    if (n) showToast(`已解散分组，${n} 项回到原位置`)
  }
  emit('close')
}

// —— 关闭时机 ——
// 点菜单之外（含在另一张卡片上再次右键：pointerdown 先到，随后 contextmenu 会重新打开菜单）、
// 按 Esc、页面滚动（菜单是 fixed 的，跟着滚会脱离目标）。
function onDocPointerDown(e) {
  if (el.value && el.value.contains(e.target)) return
  emit('close')
}
function onKeyDown(e) {
  if (e.key === 'Escape') emit('close')
}
function onScroll() {
  emit('close')
}

onMounted(() => {
  place()
  window.addEventListener('pointerdown', onDocPointerDown)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', onDocPointerDown)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onScroll)
})

// 同一实例被复用到另一张卡片时（理论上 v-if 会重建，这里兜一手）重新定位
watch(() => [props.x, props.y, props.item && props.item.id], place)
</script>

<template>
  <div
    ref="el"
    class="ctx-menu"
    :class="{ ready }"
    :style="{ left: pos.x + 'px', top: pos.y + 'px' }"
    role="menu"
    @contextmenu.prevent
  >
    <!-- 分组 / 文件夹：先摆「调整颜色」块（一排色点），再是各自的操作项。
         分组调的是方块底色，文件夹调的是图形本身（分流见 script 里的 isGroup / isFolder）。 -->
    <template v-if="showColor">
      <div class="ctx-color-block">
        <div class="ctx-color-head">调整颜色</div>
        <div class="ctx-colors" role="group" aria-label="文件夹颜色">
          <button
            v-for="c in swatches"
            :key="c"
            type="button"
            class="ctx-color"
            :class="{ on: c === currentColor }"
            :style="{ background: c }"
            :title="c === currentColor ? '当前颜色' : '用这个颜色'"
            :aria-pressed="c === currentColor"
            @click.stop="pickColor(c)"
          >
            <MdIcon v-if="c === currentColor" name="check" :size="11" />
          </button>
        </div>
      </div>
      <div class="ctx-sep"></div>
    </template>
    <template v-for="(m, i) in MENU" :key="m.id || 'sep' + i">
      <div v-if="m.sep" class="ctx-sep"></div>
      <button v-else class="ctx-item" :class="{ danger: m.danger }" @click="run(m)">
        <MdIcon :name="m.icon" :size="16" />
        <span>{{ m.label }}</span>
      </button>
    </template>
  </div>
</template>
