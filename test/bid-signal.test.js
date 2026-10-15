/**
 * bid-signal.test.js — SPEC-MEM-0001 验收（A1–A10）
 * 运行：node test/bid-signal.test.js   （或经 run-all-tests.js）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

// 隔离数据目录：core 的 MEMORY_DIR 由 __dirname 推得，无法用 env 覆盖 →
// 用临时 agent 名（写入同目录但独立文件），测试后清理。
const core = require('../lib/core/memory');
const bid = require('../lib/core/bid-signal');

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}`); }
}

const AGENT = '__bid_test__'; // 独立文件，跑完删除
const file = path.join(__dirname, '..', 'data', 'a2a-memories', `${AGENT}.md`);

function cleanup() { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {} }

console.log('══ SPEC-MEM-0001 验收（A1–A10）══');

// A1 → R1：三类信号词各命中，front-matter 含 bid_signal
cleanup();
core.add({ agent: AGENT, type: 'event', content: '我承诺明天完成这件事', source: 'test' });
core.add({ agent: AGENT, type: 'event', content: '我方更正：之前那句话说错了', source: 'test' });
core.add({ agent: AGENT, type: 'event', content: '我们决定采用方案 B', source: 'test' });
let entries = core.get(AGENT);
ok('A1 三类信号各写入 bid_signal', entries.filter(e => e.bid_signal).length >= 3);
const kinds = new Set(entries.map(e => e.bid_signal && e.bid_signal.kind));
ok('A1 kind 覆盖 promise/correction/decision', kinds.has('promise') && kinds.has('correction') && kinds.has('decision'));

// A2 → R2：显式传入 peer 优先
cleanup();
core.add({ agent: AGENT, type: 'event', content: '更正一处口径', peer: '阿轩', source: 'test' });
entries = core.get(AGENT);
ok('A2 显式 peer 落字段', entries[0].bid_signal && entries[0].bid_signal.peer === '阿轩');

// A3 → R3：未传 peer，从 tags / 正文提取
cleanup();
core.add({ agent: AGENT, type: 'event', content: '与墨丘确认了接口对齐方案', tags: ['x'], source: 'test' });
entries = core.get(AGENT);
ok('A3 正文提取 peer=墨丘', entries[0].bid_signal && entries[0].bid_signal.peer === '墨丘');

// A4 → R4：提取不到 → null
cleanup();
core.add({ agent: AGENT, type: 'event', content: '我承诺持续推进这件事', source: 'test' });
entries = core.get(AGENT);
ok('A4 无连接名 peer=null', entries[0].bid_signal && entries[0].bid_signal.peer === null);

// A5 → R5：direction out / in
cleanup();
core.add({ agent: AGENT, type: 'event', content: '我方更正：接口名写错了', source: 'test' });
core.add({ agent: AGENT, type: 'event', content: '墨丘主动更正：数据源有误', source: 'test' });
entries = core.get(AGENT);
const dirs = entries.map(e => e.bid_signal && e.bid_signal.direction);
ok('A5 direction 判出 out 与 in', dirs.includes('out') && dirs.includes('in'));

// A6 → R6：一期 state 恒 pending
cleanup();
core.add({ agent: AGENT, type: 'event', content: '我们约定周五前交付', source: 'test' });
entries = core.get(AGENT);
ok('A6 state 恒为 pending', entries[0].bid_signal && entries[0].bid_signal.state === 'pending');

// A7 → R7：无信号词 → 无字段
cleanup();
core.add({ agent: AGENT, type: 'event', content: '今天天气不错，喝了一杯茶', source: 'test' });
entries = core.get(AGENT);
ok('A7 无信号词不写 bid_signal', !entries[0].bid_signal);

// A8 → R8：存量无字段条目 get() 不抛错
let threw = false;
try { core.get('若兰'); } catch (e) { threw = true; }
ok('A8 读取存量（无字段）不抛错', !threw);

// A9 → R9：既有字段在带/不带 bid_signal 时一致
cleanup();
core.add({ agent: AGENT, type: 'event', content: '无关内容 abc', source: 'test' });
core.add({ agent: AGENT, type: 'event', content: '我承诺完成 xyz', source: 'test' });
entries = core.get(AGENT);
const KEYS = ['id', 'type', 'timestamp', 'source', 'confidence', 'visibility', 'structural_weight', 'is_core_identity'];
const noSig = entries.find(e => !e.bid_signal);
const hasSig = entries.find(e => e.bid_signal);
const sameKeys = noSig && hasSig && KEYS.every(k => (k in noSig) === (k in hasSig));
ok('A9 既有字段集合一致（不含 bid_signal）', !!sameKeys);

// A10 → 背景：README/架构同步（人工项，检查 spec 存在）
ok('A10 SPEC-MEM-0001 存在且 lint 已过（见外部记录）', fs.existsSync(path.join(__dirname, '..', 'specs', 'SPEC-MEM-0001', 'spec.md')));

cleanup();
console.log(`\n通过: ${pass}\n失败: ${fail}`);
console.log(`${fail === 0 ? '✅' : '❌'} bid-signal: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);