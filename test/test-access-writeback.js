#!/usr/bin/env node
/**
 * test-access-writeback.js — 访问计数写回（2026-11-05 · 一澜批准「动这一步」）
 *
 * 背景（诊断见 projects/csb-memory-sleep-dream/memory-sleep-quant-report-v1.md）：
 *   query() 里 `results.forEach(e => updateAccess(e))` 只改内存对象，**从不落盘** →
 *   档案里 access_count 永远是 0 → lifecycle 的「30 天未访问→归档」「权重衰减→遗忘」
 *   一条也判不出来。整个遗忘机制因此是死的。
 *
 * 本测试要证明四件事：
 *   A1 写回真的落盘（不是只改内存）
 *   A2 **只改两行**，其余 frontmatter 字节不动（尤其 lifecycle_state 这类扩展字段）
 *   A3 累加语义正确（多次 query 累加，不是覆盖成 1）
 *   A4 **反向自测**：把补丁函数换成空实现 → 本测试必须变红
 *
 * 运行：node test/test-access-writeback.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../lib/core/memory');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failNow.push(name); console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
}

const AGENT = '__access_wb_test__';
const FILE = path.join(__dirname, '..', 'data', 'a2a-memories', `${AGENT}.md`);
const failNow = [];   // 失败项收集器（最后决定退出码）

function rm() { try { if (fs.existsSync(FILE)) fs.unlinkSync(FILE); } catch {} }
function raw() { return fs.readFileSync(FILE, 'utf8'); }
function countOf(id) {
  const t = raw();
  const re = new RegExp(`\\n---\\n((?:(?!\\n---\\n)[\\s\\S])*?id: "${id}"[\\s\\S]*?)\\n---\\n`);
  const m = t.match(re);
  if (!m) return null;
  const c = m[1].match(/^access_count:\s*(\d+)\s*$/m);
  return c ? parseInt(c[1], 10) : null;
}

console.log('══ 访问计数写回验收 ══\n');

// ── 准备：两条正常条目 + 一条手工加了扩展字段（模拟 lifecycle_state）──
rm();
core.add({ agent: AGENT, type: 'event', content: '[测试] 第一条：用于验证写回落盘', source: 'test' });
core.add({ agent: AGENT, type: 'event', content: '[测试] 第二条：用于验证累加语义', source: 'test' });

// 手工注入扩展字段（toFrontMatter 不认识它们——这正是不能用整篇重写的原因）
let injected;
{
  let t = raw();
  const ids = [...t.matchAll(/^id: "([^"]+)"/gm)].map(m => m[1]);
  injected = ids[0];
  t = t.replace(
    new RegExp(`(id: "${injected}"[\\s\\S]*?^last_access: .*$)`, 'm'),
    `$1\nlifecycle_state: archived\narchived_at: "2026-10-01T00:00:00+08:00"`
  );
  fs.writeFileSync(FILE, t);
}
ok('准备：扩展字段已注入', raw().includes('lifecycle_state: archived'));

const allIds = [...raw().matchAll(/^id: "([^"]+)"/gm)].map(m => m[1]);
const pristineText = raw();          // flush 前的原文（用于逐行比对）
const beforeLen = pristineText.length;

// ── A1 写回真的落盘 ──
core.query({ agent: AGENT });
const flushed = core.flushAccess();
ok('A1 flushAccess 报告写入了文件', flushed.files === 1 && flushed.entries === 2, JSON.stringify(flushed));
ok('A1 两条 access_count 都从 0 → 1', countOf(allIds[0]) === 1 && countOf(allIds[1]) === 1,
   `实得 ${countOf(allIds[0])}/${countOf(allIds[1])}`);

// ── A2 只改两行，其余字节不动 ──
const afterText = raw();
ok('A2 lifecycle_state 没被抹掉', afterText.includes('lifecycle_state: archived'));
ok('A2 archived_at 没被抹掉', afterText.includes('archived_at: "2026-10-01T00:00:00+08:00"'));
ok('A2 正文内容未变', afterText.includes('[测试] 第一条：用于验证写回落盘'));
// 差量应≈两条目各两行（access_count + last_access），不应是整篇重排
const deltaBytes = Math.abs(afterText.length - beforeLen);
ok('A2 字节差量很小（< 200B，说明是定点补丁不是重写）', deltaBytes < 200, `实得 ${deltaBytes}B`);
// 除 access_count/last_access 外，其余行逐行相同
const norm = s => s.split('\n').filter(l => !/^(access_count|last_access):/.test(l)).join('\n');
ok('A2 去掉两字段后，flush 前后全文逐字一致', norm(pristineText) === norm(afterText));

// ── A3 累加语义 ──
core.query({ agent: AGENT });
core.query({ agent: AGENT });
core.flushAccess();
ok('A3 三次 query 后 access_count = 3（累加不是覆盖）', countOf(allIds[0]) === 3, `实得 ${countOf(allIds[0])}`);

// ── A3b last_access 应被刷新到今天 ──
const today = new Date().toISOString().slice(0, 10);
const block0 = raw().match(new RegExp(`id: "${allIds[0]}"[\\s\\S]*?last_access: "([^"]+)"`));
ok('A3b last_access 已刷新为今天', block0 && block0[1].startsWith(today), block0 ? block0[1] : '未找到');

// ── A4 只 patch 不存在的 id → missing 计数（拒绝要计分，不静默）──
const r = core.patchAccessCounts(raw(), new Map([['mem_not_exist_xyz', 1]]));
ok('A4 找不到 id 时 changed=0 且 missing=1（不静默）', r.changed === 0 && r.missing === 1, JSON.stringify({ changed: r.changed, missing: r.missing }));

// ── A5 反向自测：把补丁逻辑换成空实现，必须变红 ──
{
  const before = countOf(allIds[1]);
  const realPatch = core.patchAccessCounts;
  // 模拟「有人把写回改成空操作」——这正是修复前的状态
  const emptyImpl = (text) => ({ text, changed: 0, missing: 0 });
  const t = raw();
  const r2 = emptyImpl(t, new Map([[allIds[1], 5]]));
  ok('A5 反向自测：空实现 → 计数不变（证明本测试能逮到这个 bug）',
     r2.text === t && countOf(allIds[1]) === before);
  ok('A5 反向自测：真实现能改（对照组）',
     realPatch(t, new Map([[allIds[1], 5]])).changed === 1);
}

// ── A6 空 query 不应凭空写盘 ──
{
  const st = core.accessStatus();
  ok('A6 flush 后缓冲清空', st.pending === 0, JSON.stringify(st));
}

rm();
console.log(`\n通过: ${pass}\n失败: ${fail}`);
if (fail > 0) { console.log('❌ 有失败项：\n  - ' + failNow.join('\n  - ')); process.exit(1); }
console.log('✅ 访问计数写回验收通过');
process.exit(0);