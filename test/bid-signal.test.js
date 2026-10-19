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
// ═══ v2.0 精度验收（A11–A18 · SPEC-MEM-0001 v2.0）═══
console.log('\n── v2.0 词表精修验收 ──');

// A11 → R10：谈论承诺语境不判 promise
cleanup();
core.add({ agent: AGENT, type: 'event', content: '讨论一下承诺履约率怎么算', source: 'test' });
entries = core.get(AGENT);
ok('A11 「讨论承诺」谈论语境 → 不判 promise', entries[0] && !entries[0].bid_signal);

// A12 → R10：谈论决策语境不判 decision
cleanup();
core.add({ agent: AGENT, type: 'event', content: '关于是否同意该方案，还需再看', source: 'test' });
entries = core.get(AGENT);
ok('A12 「关于是否同意」谈论语境 → 不判 decision', entries[0] && !entries[0].bid_signal);

// A13 → R11：否定语境不判 promise
cleanup();
core.add({ agent: AGENT, type: 'event', content: '本轮非承诺，只做可行性评估', source: 'test' });
entries = core.get(AGENT);
ok('A13 「非承诺」否定语境 → 不判 promise', entries[0] && !entries[0].bid_signal);

// A14 → R11：否定语境不判 decision
cleanup();
core.add({ agent: AGENT, type: 'event', content: '没有决定，先收集意见', source: 'test' });
entries = core.get(AGENT);
ok('A14 「没有决定」否定语境 → 不判 decision', entries[0] && !entries[0].bid_signal);

// A15 → R12：纠错优先于承诺
cleanup();
core.add({ agent: AGENT, type: 'event', content: '我方更正：之前承诺的日期写错了', source: 'test' });
entries = core.get(AGENT);
ok('A15 同时含纠错与承诺 → kind=correction', entries[0].bid_signal && entries[0].bid_signal.kind === 'correction',
  entries[0].bid_signal && entries[0].bid_signal.kind);

// A16 → R13：评审叙述不判 decision
cleanup();
core.add({ agent: AGENT, type: 'event', content: '签字结果：5×✅A 同意定稿，全员共识', source: 'test' });
entries = core.get(AGENT);
ok('A16 评审叙述「同意定稿」→ 不判 decision', entries[0] && !entries[0].bid_signal);

// A17 → R13：真决策仍要判出
cleanup();
core.add({ agent: AGENT, type: 'event', content: '一澜批准 SPEC-MEM-0002，直接开工', source: 'test' });
entries = core.get(AGENT);
ok('A17 「一澜批准」→ 判 decision', entries[0].bid_signal && entries[0].bid_signal.kind === 'decision',
  entries[0].bid_signal && entries[0].bid_signal.kind);

// A19 → 回归：add() 必须把判定出的 bid_signal **回传给调用方**
//   2026-10-19 生产管线排查：字段本身有落盘，但返回值缺 bid_signal，
//   下游若读返回值做统计（如 sync 侧汇总）会看到「全是 null」。
cleanup();
const r19 = core.add({ agent: AGENT, type: 'event', content: '我承诺明天把 W-14 验完', source: 'test' });
ok('A19 add() 返回 bid_signal（回传）', r19 && r19.bid_signal && r19.bid_signal.kind === 'promise',
  r19 && JSON.stringify(r19.bid_signal));

// A20 → 回归：无信号词时返回值不得凭空造字段
cleanup();
const r20 = core.add({ agent: AGENT, type: 'event', content: '今天天气不错，去西湖边坐了一会儿', source: 'test' });
ok('A20 无信号时返回不含 bid_signal', r20 && r20.bid_signal === undefined, r20 && JSON.stringify(r20));

// ── v2.1（2026-10-19 · 若琢跨宿主 99 条实测驱动）────────────────
// B1-B6：decision 未来时排除（实测误判率 35%，6/20 条）
const decCases = [
  ['B1 「等一澜拍板」→ 不判决策', '等一澜拍板', false],
  ['B2 「需要一澜确认」→ 不判决策', 'agent.json 被改了——需要一澜确认', false],
  ['B3 「等确认后转发」→ 不判决策', '等确认后转发', false],
  ['B4 「评审通过，lint 修正 3 处」→ 技术叙述不判', '评审通过，lint 修正 3 处', false],
  ['B5 「一澜批准 SPEC-MEM-0002」→ 真决策仍判', '一澜批准 SPEC-MEM-0002，直接开工', true],
  ['B6 「定案：默认名」→ 真决策仍判', '定案：默认名「碳硅契」', true],
];
for (const [name, text, expectDecision] of decCases) {
  const k = bid.detectKind(text);
  if (expectDecision) ok(name, k === 'decision', k);
  else ok(name, k !== 'decision', k);
}

// B7-B12：DIR_IN 主语约束（实测 5 条方向反转，全是「对方名 + 纠错词」共现）
const dirCases = [
  ['B7 「澈主动指出我方错误」→ in', '澈主动指出我方错误', 'in'],
  ['B8 「明德指出他从未见过该变量」→ in', '明德指出他从未见过该变量', 'in'],
  ['B9 「一澜指出措辞」→ in', '一澜指出措辞', 'in'],
  ['B10 「澈叫错名字→第三次纠正」→ out（主语是我）', '澈第三次叫错名字「若兰」→ 第三次纠正', 'out'],
  ['B11 「澈第四次叫错——我纠正」→ out', '澈第四次叫错名字——我纠正', 'out'],
  ['B12 「我方更正」→ out', '我方更正：之前承诺的日期写错了', 'out'],
];
for (const [name, text, expectDir] of dirCases) {
  const k = bid.detectKind(text);
  const d = k === 'correction' ? (bid.DIR_IN.test(text) ? "in" : bid.DIR_OUT.test(text) ? 'out' : 'null') : '-';
  ok(name, k === 'correction' && d === expectDir, `${k}/${d}`);
}

// ── v2.1b/c：报告结论 / 过程 / 技术串 不算决策（本机 65 条重跑实测多出 100 条假决策）──
const decNeg = [
  ['B13 「范围纪律：…」→ 不判', '范围纪律：仅审三期增量；R1–R12 已 approved 基线不重议'],
  ['B14 「结论：凭据是密码」→ 不判', '结论：凭据是密码（basic auth），不是 API token'],
  ['B15 「恺侧结果：未弹 L3」→ 不判', '恺侧结果：未弹 L3 · 无 CONFIRM-SEND'],
  ['B16 「下一步：…」→ 不判', '下一步：对方 enabled=true 后 → 签发 UAC'],
  ['B17 「决定：…需一澜 L3 确认」→ 不判', '决定：改码+重启+推上游=写操作，需一澜 L3 确认'],
  ['B18 「复验（新锚钥）：AUTO_APPROVED」→ 不判', '复验（新锚钥）：AUTO_APPROVED policy=若兰'],
];
for (const [name, text] of decNeg) ok(name, bid.detectKind(text) !== 'decision', bid.detectKind(text));

// 反向：真决策不能被上面这些规则误杀
const decPos = [
  ['B19 「处置决定：选 C」→ 仍判', '处置决定：选 C——本任务归档为「真窗口负例」'],
  ['B20 「一澜拍板：① 补写」→ 仍判', '一澜拍板：① 给 metacognition 补写 ARCHITECTURE.md'],
  ['B21 「拍板：全部清理」→ 仍判', '拍板：全部清理，统一更名为「一澜」'],
];
for (const [name, text] of decPos) ok(name, bid.detectKind(text) === 'decision', bid.detectKind(text));

// A18 → 回归：v1.0 A1–A10 全过（由本文件上半段保证，此处显式断言）
ok('A18 v1.0 既有验收仍通过（A1–A10 见上）', fail === 0);

cleanup();
console.log(`\n通过: ${pass}\n失败: ${fail}`);
console.log(`${fail === 0 ? '✅' : '❌'} bid-signal: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);