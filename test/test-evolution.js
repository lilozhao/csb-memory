/**
 * test-evolution.js — P0-4 不可篡改进化日志单元测试（2026-09-05）
 * 运行：node test/test-evolution.js
 *
 * 覆盖：
 *   - append 审计字段（intent/mutations_tried/outcome/derived_from）
 *   - markState/link 变更审计事件（哈希链）
 *   - verifyEvolution 篡改必检出
 *   - 内容不可变声明（无 update API）
 *   - 原子写（其他行不受影响）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const raw = require('../lib/raw/raw');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-evo-'));
raw.setRawDir(tmpDir);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

function evoFile() {
  return path.join(raw.getRawDir(), 'raw-evolution.jsonl');
}

function readEvo() {
  if (!fs.existsSync(evoFile())) return [];
  return fs.readFileSync(evoFile(), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function calcHash(event) {
  const { hash, ...rest } = event;
  return crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
}

console.log('🧪 test-evolution.js — P0-4 不可篡改进化日志测试\n');

// ---------- append 审计字段 ----------

test('append 带 intent/mutations_tried/outcome → evolution 字段落盘', () => {
  const r = raw.append({
    session: 'dream', type: 'lesson', content: '蒸馏纪律：可以忘内容不能丢 derived_from',
    intent: 'distill-discipline', mutations_tried: ['drop', 'summarize'], outcome: 'kept-derived_from',
  });
  assert.ok(r.evolution, '应有 evolution 字段');
  assert.equal(r.evolution.intent, 'distill-discipline');
  assert.deepEqual(r.evolution.mutations_tried, ['drop', 'summarize']);
  assert.equal(r.evolution.outcome, 'kept-derived_from');
  // 落盘可查
  const stored = raw.get(r.id);
  assert.equal(stored.evolution.intent, 'distill-discipline');
});

test('append 不带审计字段 → 无 evolution（向后兼容）', () => {
  const r = raw.append({ session: 'webchat', type: 'conversation', content: '普通流水' });
  assert.equal(r.evolution, undefined);
});

test('append derived_from 指回旧条目（修改 = 新条目 + derived_from）', () => {
  const old = raw.append({ session: 'test', type: 'conversation', content: '旧内容（含笔误）' });
  const fix = raw.append({
    session: 'test', type: 'conversation', content: '修正版内容',
    derived_from: old.id, intent: 'correction', outcome: 'appended-not-mutated',
  });
  assert.ok(Array.isArray(fix.derived_from));
  assert.equal(fix.derived_from[0], old.id);
  // 旧条目未被修改（append-only）
  const oldStored = raw.get(old.id);
  assert.equal(oldStored.content, '旧内容（含笔误）');
});

// ---------- markState 变更审计 ----------

test('markState 产生 state_change 审计事件（from/to/intent）', () => {
  const r = raw.append({ session: 'test', type: 'conversation', content: '待封口流水' });
  raw.markState(r.id, 'sealed', { intent: 'manual-archive' });
  const evos = readEvo().filter((e) => e.action === 'state_change' && e.raw_id === r.id);
  assert.equal(evos.length, 1);
  assert.equal(evos[0].from, 'burning');
  assert.equal(evos[0].to, 'sealed');
  assert.equal(evos[0].intent, 'manual-archive');
  // 原行已更新
  assert.equal(raw.get(r.id).state, 'sealed');
});

test('markState 同 state → 无事件（幂等）', () => {
  const r = raw.append({ session: 'test', type: 'conversation', content: '幂等测试' });
  raw.markState(r.id, 'sealed');
  raw.markState(r.id, 'sealed'); // 已 sealed，再标 sealed
  const evos = readEvo().filter((e) => e.action === 'state_change' && e.raw_id === r.id);
  assert.equal(evos.length, 1, '同 state 重复标记不应新增事件');
});

test('markState 不存在的 id → 无事件', () => {
  const before = readEvo().length;
  const res = raw.markState('raw_nonexistent_0000', 'sealed');
  assert.equal(res.success, false);
  assert.equal(readEvo().length, before);
});

test('markState 非法 state → throw 且无事件', () => {
  const r = raw.append({ session: 'test', type: 'conversation', content: '非法 state 测试' });
  const before = readEvo().length;
  assert.throws(() => raw.markState(r.id, 'invalid_state'));
  assert.equal(readEvo().length, before, '非法操作不应产生审计事件');
});

// ---------- link 变更审计 ----------

test('link 产生 link 审计事件 + 原行 sealed', () => {
  const r = raw.append({ session: 'test', type: 'conversation', content: '将被蒸馏的流水' });
  raw.link(r.id, 'mem_test_001', { intent: 'dream-distill' });
  const evos = readEvo().filter((e) => e.action === 'link' && e.raw_id === r.id);
  assert.equal(evos.length, 1);
  assert.equal(evos[0].distilled_id, 'mem_test_001');
  assert.equal(evos[0].to, 'sealed');
  const stored = raw.get(r.id);
  assert.equal(stored.state, 'sealed');
  assert.ok(stored.distilled_to.includes('mem_test_001'));
});

test('重复 link（已 sealed）→ 不重复记事件', () => {
  const r = raw.append({ session: 'test', type: 'conversation', content: '重复链接测试' });
  raw.link(r.id, 'mem_a');
  raw.link(r.id, 'mem_b'); // 第二次 link：state 已 sealed，只追加 distilled_to 不重复记 state 事件
  const evos = readEvo().filter((e) => e.action === 'link' && e.raw_id === r.id);
  assert.equal(evos.length, 1, '已 sealed 后重复 link 不应新增审计事件');
});

// ---------- 哈希链完整性 ----------

test('哈希链连续（多次操作）', () => {
  const r1 = raw.append({ session: 'chain', type: 'conversation', content: '链测试 1' });
  raw.markState(r1.id, 'sealed', { intent: 'chain-test' });
  const r2 = raw.append({ session: 'chain', type: 'conversation', content: '链测试 2' });
  raw.link(r2.id, 'mem_chain');
  const chain = raw.verifyEvolution();
  assert.equal(chain.valid, true);
  assert.ok(chain.count >= 2);
  // 逐条校验 prev_hash 连续 + hash 自洽
  const evos = readEvo();
  let prev = 'GENESIS';
  for (const e of evos) {
    assert.equal(e.prev_hash, prev);
    assert.equal(calcHash(e), e.hash);
    prev = e.hash;
  }
});

test('篡改检测：修改中间事件 → verifyEvolution 失败', () => {
  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-evo-tamper1-'));
  raw.setRawDir(iso);
  const r = raw.append({ session: 'tamper', type: 'conversation', content: '篡改测试' });
  raw.markState(r.id, 'ash', { intent: 'tamper-test' });
  // 篡改最后一条事件的 intent
  const evos = readEvo();
  const last = evos[evos.length - 1];
  last.intent = 'HACKED';
  const lines = fs.readFileSync(evoFile(), 'utf8').split('\n').filter(Boolean);
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(evoFile(), lines.join('\n') + '\n');
  const chain = raw.verifyEvolution();
  assert.equal(chain.valid, false);
  assert.equal(chain.reason, 'entry_tampered');
  raw.setRawDir(tmpDir); // 切回
});

test('篡改检测：断链（改 prev_hash）→ verifyEvolution 失败', () => {
  const iso = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-evo-tamper2-'));
  raw.setRawDir(iso);
  const r = raw.append({ session: 'tamper2', type: 'conversation', content: '断链测试' });
  raw.markState(r.id, 'ash', { intent: 'tamper2-test' });
  const evos = readEvo();
  const last = evos[evos.length - 1];
  last.prev_hash = 'FAKE_PREV';
  const lines = fs.readFileSync(evoFile(), 'utf8').split('\n').filter(Boolean);
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(evoFile(), lines.join('\n') + '\n');
  const chain = raw.verifyEvolution();
  assert.equal(chain.valid, false);
  raw.setRawDir(tmpDir); // 切回
});

test('空审计流 verify → 有效（GENESIS 起点）', () => {
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-evo-empty-'));
  raw.setRawDir(isolated);
  const chain = raw.verifyEvolution();
  assert.equal(chain.valid, true);
  assert.equal(chain.count, 0);
  raw.setRawDir(tmpDir); // 切回
});

// ---------- 统计与完整性 ----------

test('evolutionStats 计数 + byAction 分类', () => {
  const st = raw.evolutionStats();
  assert.equal(st.chainValid, true);
  assert.ok(st.total >= 1);
  assert.ok(st.byAction.state_change >= 1 || st.byAction.link >= 1);
});

test('原子写：markState 后其他行内容不变', () => {
  const a = raw.append({ session: 'atomic', type: 'conversation', content: '甲行内容' });
  const b = raw.append({ session: 'atomic', type: 'conversation', content: '乙行内容' });
  raw.markState(a.id, 'sealed', { intent: 'atomic-test' });
  assert.equal(raw.get(a.id).content, '甲行内容');
  assert.equal(raw.get(b.id).content, '乙行内容');
  assert.equal(raw.get(b.id).state, 'burning', '未标记的行状态不受影响');
});

test('内容不可变声明：模块不导出 update/rewrite/delete 写 API', () => {
  const exported = Object.keys(raw);
  for (const bad of ['update', 'rewrite', 'updateRaw', 'delete']) {
    assert.ok(!exported.includes(bad), `不应导出 ${bad}`);
  }
  // append/markState/link 是仅有的写入口
  for (const good of ['append', 'markState', 'link']) {
    assert.ok(exported.includes(good), `应导出 ${good}`);
  }
});

test('审计事件含 outcome 字段（EvolutionEvent 式）', () => {
  const r = raw.append({ session: 'evo-outcome', type: 'conversation', content: 'outcome 测试' });
  raw.markState(r.id, 'ash', { intent: 'outcome-test' });
  const evos = readEvo().filter((e) => e.action === 'state_change' && e.raw_id === r.id);
  assert.equal(evos[evos.length - 1].outcome, 'success');
});

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
process.exit(failed > 0 ? 1 : 0);
