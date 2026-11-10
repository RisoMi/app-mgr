import assert from 'node:assert/strict'
import { repairAllIcons } from '../../src/icon-repair.js'

const items = [
  { path: 'a.exe', logo: 'old' },
  { path: 'b.app', logo: 'custom-upload' },
  { path: 'c.txt', logo: 'stale-or-broken' },
  { path: '', logo: 'no-path' }
]

const calls = []
const progress = []
const res = await repairAllIcons({
  items,
  extractIcon: async (p) => {
    calls.push(p)
    if (p === 'a.exe') return 'data:image/png;base64,AAA'
    if (p === 'b.app') return null
    throw new Error('boom')
  },
  onProgress: (n, t) => progress.push([n, t])
})

assert.equal(res.total, 3, '空 path 应被过滤')
assert.equal(res.ok, 1)
assert.equal(res.skipped, 2)
assert.equal(items[0].logo, 'data:image/png;base64,AAA', '抽到的应覆盖')
assert.equal(items[1].logo, null, '抽不到应清空走字母兜底')
assert.equal(items[2].logo, null, '抛错应清空走字母兜底')
assert.deepEqual(calls, ['a.exe', 'b.app', 'c.txt'])
assert.equal(progress.length, 3)

const empty = await repairAllIcons({ items: [], extractIcon: async () => 'x' })
assert.deepEqual(empty, { ok: 0, skipped: 0, total: 0 })

console.log('icon-repair: PASS', res)
