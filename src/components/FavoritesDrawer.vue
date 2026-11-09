<script setup>
// 图标区顶边的「收藏夹抽屉」。
//
// 收起态界面上只有一个**吸附在顶边的小倒三角**（不占版位，悬浮在那儿），
// 点击它就像拉开抽屉一样把收藏夹拉出来；再点一下、点抽屉外面、或按 Esc 收回。
//
// 展开时抽屉**在文档流里把图标区顺势往下推**（不盖在卡片上，见 styles.css 的 .fav-panel），
// 所以这里不需要任何定位/测量：面板长多高，下面的图标区就降多低。
//
// 抽屉里的东西**就是图标区的卡片**：同一个 ItemCard + 同一个 .grid。
// 于是卡片样式（卡片 / 原生 / 仅图标）、图标尺寸、双击启动、右键菜单
// 全部自动与图标区一致 —— 不需要另立一套外观，也不需要任何说明文字。
//
// 收藏内容不在这里维护：谁被收藏由 store.favorites 说了算，
// 这里只读 favoriteItems()（已过滤掉被删项目的死 id）。
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { state, favoriteItems, setFavOpen } from '../store'
import ItemCard from './ItemCard.vue'

const emit = defineEmits(['menu'])

const favs = computed(() => favoriteItems())

function toggle() {
  setFavOpen(!state.favOpen)
}

// 点抽屉外面任意地方收起 —— 抽屉该有的手感。
// 用 pointerdown 而不是 click：按下那一刻就收，不用等抬起。
function onWindowDown(e) {
  if (!state.favOpen) return
  const t = e.target
  if (t && t.closest && t.closest('.fav-drawer')) return
  setFavOpen(false)
}
onMounted(() => window.addEventListener('pointerdown', onWindowDown, true))
onBeforeUnmount(() => window.removeEventListener('pointerdown', onWindowDown, true))
</script>

<template>
  <div class="fav-drawer" :class="{ open: state.favOpen }">
    <!-- 唯一常驻的入口：一枚小倒三角。
         说明文字只挂在 title / aria 上（鼠标悬停或读屏才有），界面上不多一个字。 -->
    <button
      type="button"
      class="fav-tab"
      aria-controls="fav-panel"
      :aria-expanded="!!state.favOpen ? 'true' : 'false'"
      :title="state.favOpen ? '收起收藏夹' : '展开收藏夹'"
      @click="toggle"
    >
      <span class="fav-tri" aria-hidden="true"></span>
    </button>

    <div id="fav-panel" class="fav-panel" :aria-hidden="!state.favOpen ? 'true' : 'false'">
      <div class="fav-body">
        <div v-if="favs.length" class="grid">
          <!-- 与图标区同款卡片：双击启动、右键菜单。
               关掉拖拽 —— 抽屉是「快速启动」面板，不参与网格排序 / 归类。 -->
          <ItemCard
            v-for="f in favs"
            :key="f.id"
            :item="f"
            :draggable="false"
            @menu="emit('menu', $event)"
          />
        </div>
        <p v-else class="fav-empty">还没有收藏</p>
      </div>
    </div>
  </div>
</template>
