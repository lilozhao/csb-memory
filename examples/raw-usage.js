/**
 * raw-usage.js — CSB-Memory v1.1 全量底仓层（RAW）示例
 * 运行：node examples/raw-usage.js
 *
 * 演示：原始流水写入（写入端笨）→ 时态流转 → 蒸馏溯源（derived_from）
 */

const raw = require('../lib/raw/raw');
const core = require('../lib/core/memory');

console.log('🧱 全量底仓层（RAW）示例 · CSB-Memory v1.1\n');

// ① 写入端"笨"：原始流水不筛选、不蒸馏
console.log('① 原始流水写入（append-only，不筛选）');
const r1 = raw.append({
  session: 'webchat',
  type: 'conversation',
  content: '一澜：记忆系统创建后主要是给用起来',
});
const r2 = raw.append({
  session: 'a2a',
  type: 'decision',
  content: '拍板：MEM-012 底仓层命名 RAW，全量永久，溯源写死',
});
const r3 = raw.append({
  session: 'cron',
  type: 'tool_result',
  content: 'sync-daily 执行结果：18 条录入',
  meta: { tool: 'sync-daily' },
});
console.log(`  ✅ 写入 3 条流水（默认 state: burning）`);

// ② 时态流转：人工标记灰烬 + 蒸馏自动封口
console.log('\n② 时态流转（灰火三态）');
raw.markState(r2.id, 'ash');
console.log(`  🌫️ ${r2.id} → ash（讨论降温，等待被读）`);

// ③ 蒸馏：从流水提炼结论 → derived_from 硬字段 + 自动封口
console.log('\n③ 蒸馏溯源（derived_from 硬字段）');
const distilled = core.add({
  agent: '若兰',
  type: 'decision',
  content: 'MEM-012 定稿：RAW 底仓层 = 全量永久 + 时态三态 + derived_from 红线',
  tags: ['底仓', 'v1.1', '决策'],
  source: 'distill',
  derived_from: r2.id, // 硬字段：结论指回底仓流水
});
const linked = raw.link(r2.id, distilled.id);
console.log(`  ✅ ${linked.message}`);
console.log(`  ✅ 结论 ${distilled.id} 带 derived_from=${r2.id}`);

// ④ 检索：从结论回看全本
console.log('\n④ 自读：从结论回看全本');
const stream = raw.get(r2.id);
console.log(`  流水原文：「${stream.content}」`);
console.log(`  时态：${stream.state} · 蒸馏产物：${stream.distilled_to.join(', ')}`);

// ⑤ 统计 + 红线校验
console.log('\n⑤ 底仓统计与删除红线');
const s = raw.stats();
console.log(`  共 ${s.total} 条 · burning ${s.byState.burning} / ash ${s.byState.ash} / sealed ${s.byState.sealed}`);
console.log(`  删除前校验：${raw.hasRaw(r2.id) ? '✅ 底仓有原始记录（红线通过）' : '❌ 无原始记录（禁止删除）'}`);

// 清理演示数据
const all = core.get('若兰');
for (const e of all) {
  if (e.content.includes('MEM-012 定稿')) core.delete(e.id);
}
console.log('\n（演示数据已清理）');
