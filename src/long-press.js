// 长按手势（按住不动进入编辑模式）——普通卡片与分组卡共用。
//
// 为什么抽出来：卡片同时是 draggable，浏览器在「按住并移动」时会自己起原生拖拽，
// 所以长按只在「按住不动」时成立 —— 一旦移动超过阈值、或松手 / 移出卡片，就把定时器取消。
// 于是「按住不动 = 进编辑模式」与「按住拖走 = 排序 / 归类」互不打架。
// 这套时序（阈値、容差、吞掉尾随的那一次 click）在两张卡上必须完全一致，
// 抄两遍必然一天天地走样：组卡当初就是漏了这一段，长按它毫无反应。
export function useLongPress(fire, opts = {}) {
  const ms = opts.ms || 450
  const tolerance = opts.tolerance == null ? 8 : opts.tolerance
  let timer = null
  let origin = null
  // 长按已经触发过：紧跟着松手会来一次 click，那一下是「进编辑模式」的收尾，
  // 不能再当成点选 / 开合面板 —— 否则刚进去就被自己的尾随 click 折腾一下。
  let fired = false

  function cancel() {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    origin = null
  }

  function onPointerDown(e) {
    if (e.button !== 0) return
    fired = false
    cancel()
    origin = { x: e.clientX, y: e.clientY }
    timer = setTimeout(() => {
      timer = null
      origin = null
      fired = true
      fire()
    }, ms)
  }

  function onPointerMove(e) {
    if (!timer || !origin) return
    if (Math.abs(e.clientX - origin.x) > tolerance || Math.abs(e.clientY - origin.y) > tolerance) cancel()
  }

  // 返回 true 表示这一次 click 属于长按的收尾，调用方应当直接忽略它。
  // 每次 click 都要问一次（哪怕这次不看返回值），免得残留的 true 吞掉后面一次正常的点击。
  function consumeClick() {
    if (!fired) return false
    fired = false
    return true
  }

  // 只读地看一眼「是不是长按刚触发」：双击的拦截用（长按松手那一下不该被当成双击）。
  function hasFired() {
    return fired
  }

  return { onPointerDown, onPointerMove, cancel, consumeClick, hasFired }
}
