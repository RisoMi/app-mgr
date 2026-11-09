// 一键重抽所有项目的系统图标。
// 刻意做成纯函数：不碰 Vue / DOM / Tauri，便于用 Node 直接跑回归（见 design/probe/icon-repair.mjs）。
//
// 规则：
//  - 只处理有 path 的项目；
//  - 抽到图标才覆盖 logo，抽不到或抛错一律**保留原图标**
//    （否则一键修复会把用户手动上传的图标清空）；
//  - 每项 await 之后让出一个宏任务，保证进度文字能真正刷到界面上。

export async function repairAllIcons({ items, extractIcon, onProgress, onDone }) {
  const list = (items || []).filter((it) => it && it.path)
  if (!list.length) {
    const empty = { ok: 0, skipped: 0, total: 0 }
    if (onDone) onDone(empty)
    return empty
  }

  let ok = 0
  let skipped = 0
  for (let i = 0; i < list.length; i++) {
    if (onProgress) onProgress(i + 1, list.length)
    try {
      const logo = await extractIcon(list[i].path)
      if (logo) {
        list[i].logo = logo
        ok += 1
      } else {
        skipped += 1
      }
    } catch {
      skipped += 1
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  const result = { ok, skipped, total: list.length }
  if (onDone) onDone(result)
  return result
}
