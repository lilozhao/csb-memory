/**
 * test-type-infer.js — inferType 单测（2026-11-09 建立）
 * 运行：node test/test-type-infer.js
 *
 * 缘起：11-06~11-08 连续三天「做梦 0 新增」。根因之一是 inferType 把
 *   「报告 xxx.md · 一澜 签字「同意结项」」判成 event，而 event 当时不在 DISTILLABLE 里。
 * 本测试锁三件事：
 *   1) 签字/结项 + 文档引用 ⇒ decision（治根）
 *   2) 无文档时「同意」不当决策证据（防闲聊误判）
 *   3) inferType 与 dream.js 的 DISTILLABLE 同源（防再次分叉）
 */
'use strict';
const assert = require('assert');
const path = require('path');
const { inferType } = require('../lib/sync/type-infer');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✅ ${name}`); }
  catch (e) { failed++; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

console.log('=== inferType 类型推断测试 ===');

// 1) 治根用例：真实日记原文
test('签字+报告文件 ⇒ decision', () => {
  const t = '报告 `docs/A3-loopDetection-结项报告-2026-11-08.md` · 一澜 10:14 签字「同意结项」';
  assert.strictEqual(inferType(t), 'decision');
});
test('签字/结项 + .md ⇒ decision', () => {
  assert.strictEqual(inferType('协议评审 一澜 签署 纪要.md'), 'decision');
});

// 2) 防误判：「同意」单独出现不算决策
test('「同意的扣1」⇒ event（无文档引用）', () => {
  assert.strictEqual(inferType('同意的扣1，我看看有多少人'), 'event');
});

// 3) 既有分类不许回退
test('拍板/敲定 ⇒ decision', () => {
  assert.strictEqual(inferType('敲定：下周一起灰度'), 'decision');
  assert.strictEqual(inferType('决定：先修 B 再修 C'), 'decision');
});
test('承诺类 ⇒ promise', () => {
  assert.strictEqual(inferType('约定是每晚读一页'), 'promise');
});
test('教训类 ⇒ lesson', () => {
  assert.strictEqual(inferType('踩坑：flock 所有权跟着 fd 走'), 'lesson');
});
test('寒暄 ⇒ event', () => {
  assert.strictEqual(inferType('初白路过，认真读了。'), 'event');
});

// 4) 同源检查：inferType 产出必须与 dream.js 的 DISTILLABLE 口径一致
test('inferType 五种可蒸馏类都在 dream 白名单内', () => {
  const dreamSrc = require('fs').readFileSync(path.join(__dirname, '..', 'scripts', 'dream.js'), 'utf8');
  const m = dreamSrc.match(/const DISTILLABLE = \[([^\]]+)\]/);
  assert.ok(m, '找不到 DISTILLABLE 定义');
  const list = m[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  for (const t of ['decision', 'milestone', 'lesson']) {
    assert.ok(list.includes(t), `DISTILLABLE 缺 ${t}`);
  }
  // event 纳入但要有额外门（EVENT_MIN），防止噪声批量入 core
  assert.ok(list.includes('event'), 'DISTILLABLE 缺 event（方案 C）');
  assert.ok(/EVENT_MIN/.test(dreamSrc), 'event 未设 EVENT_MIN 门');
});

console.log(`\n通过: ${passed}  失败: ${failed}`);
if (failed > 0) { console.log('❌ 有失败项'); process.exit(1); }
console.log('✅ type-infer 全部通过');
