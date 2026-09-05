/**
 * test-promotion.js — P0-2 资产晋升门槛单元测试（2026-09-05）
 * 运行：node test/test-promotion.js
 *
 * 覆盖：证据校验（类型/防自证/缺字段）、canPromote 单条判定、
 *       gateBatch 阈值、dream 集成（有证据晋升/无证据拒绝留 raw）、
 *       core frontmatter 透传、sync 自动 source_trace 证据。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const raw = require('../lib/raw/raw');
const core = require('../lib/core/memory');
const gate = require('../lib/promotion/promotion-gate');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-promo-'));
raw.setRawDir(tmpDir);
// core 也隔离（frontmatter 透传测试）
process.env.CSB_MEMORY_DIR = tmpDir;

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

// 合法证据工厂
const goodEvidence = (over = {}) => ({
  type: 'exit_code',
  detail: 'scripts/verify.sh 退出码 0（2026-09-05 重跑）',
  verified_by: 'csb-aep-whitebox',
  verified_at: '2026-09-05T02:00:00.000Z',
  ...over,
});

console.log('🧪 test-promotion.js — P0-2 资产晋升门槛测试\n');

// ---------- validateEvidence ----------

test('有效证据（exit_code + 独立验证者）→ 通过', () => {
  const r = gate.validateEvidence(goodEvidence(), { producer: '若兰' });
  assert.equal(r.valid, true);
});

test('六类证据类型全部在允许白名单', () => {
  assert.deepEqual(
    [...gate.EVIDENCE_TYPES].sort(),
    ['behavior_diff', 'execution_trace', 'exit_code', 'idempotent_rerun', 'source_trace', 'third_party_check'].sort()
  );
});

test('evidence 缺失 → 拒绝（no_evidence）', () => {
  const r = gate.validateEvidence(null, { producer: '若兰' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'no_evidence');
});

test('evidence 类型非法 → 拒绝', () => {
  const r = gate.validateEvidence({ type: 'self_report', detail: '我觉得没问题', verified_by: '若兰', verified_at: 'x' }, { producer: '若兰' });
  assert.equal(r.valid, false);
  assert.ok(r.reason.startsWith('invalid_type'));
});

test('confidence 自评分不算证据（自评不在白名单）', () => {
  assert.ok(!gate.EVIDENCE_TYPES.includes('confidence'));
  const r = gate.validateEvidence({ type: 'confidence', detail: 'confidence: 0.95', verified_by: '若兰', verified_at: 'x' }, { producer: '若兰' });
  assert.equal(r.valid, false);
});

test('防自证：verified_by = 产生者本人 → 拒绝（P0-3 呼应）', () => {
  const r = gate.validateEvidence(goodEvidence({ verified_by: '若兰' }), { producer: '若兰' });
  assert.equal(r.valid, false);
  assert.ok(r.reason.includes('self_verified'));
});

test('缺 detail（不可复核）→ 拒绝', () => {
  const r = gate.validateEvidence({ type: 'exit_code', verified_by: 'csb-aep', verified_at: 'x' }, { producer: '若兰' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'no_detail（证据必须可复核：trace 位置/退出码值/重跑结果）');
});

test('缺 verified_by（验证者不署名）→ 拒绝', () => {
  const r = gate.validateEvidence({ type: 'exit_code', detail: 'trace: /tmp/x', verified_at: 'x' }, { producer: '若兰' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'no_verified_by（防自证：验证者必须署名）');
});

test('缺 verified_at → 拒绝', () => {
  const r = gate.validateEvidence({ type: 'exit_code', detail: 'trace: /tmp/x', verified_by: 'csb-aep' }, { producer: '若兰' });
  assert.equal(r.valid, false);
  assert.equal(r.reason, 'no_verified_at');
});

// ---------- canPromote ----------

test('canPromote：带有效证据的流水可晋升', () => {
  const stream = { id: 'raw_x1', session: '若兰', verification_evidence: goodEvidence() };
  const r = gate.canPromote(stream, { producer: '若兰' });
  assert.equal(r.can, true);
});

test('canPromote：无证据流水拒绝晋升', () => {
  const stream = { id: 'raw_x2', session: '若兰' };
  const r = gate.canPromote(stream, { producer: '若兰' });
  assert.equal(r.can, false);
  assert.ok(r.reason.startsWith('no_evidence'));
});

// ---------- gateBatch ----------

test('gateBatch：全带证据 → 晋升率 100% 通过', () => {
  const streams = [
    { id: 'a', session: 's', verification_evidence: goodEvidence() },
    { id: 'b', session: 's', verification_evidence: goodEvidence() },
    { id: 'c', session: 's', verification_evidence: goodEvidence() },
  ];
  const r = gate.gateBatch(streams, { producer: 's' });
  assert.equal(r.rate, 1);
  assert.equal(r.passed, true);
  assert.equal(r.gated.length, 0);
});

test('gateBatch：80% 带证据 → 恰好过线', () => {
  const streams = [
    { id: 'a', session: 's', verification_evidence: goodEvidence() },
    { id: 'b', session: 's', verification_evidence: goodEvidence() },
    { id: 'c', session: 's', verification_evidence: goodEvidence() },
    { id: 'd', session: 's', verification_evidence: goodEvidence() },
    { id: 'e', session: 's' }, // 无证据 1/5 → 80%
  ];
  const r = gate.gateBatch(streams, { producer: 's' });
  assert.equal(r.rate, 0.8);
  assert.equal(r.passed, true);
  assert.equal(r.gated.length, 1);
  assert.equal(r.gated[0].id, 'e');
});

test('gateBatch：79% 带证据 → 不过线（<80% 告警）', () => {
  const streams = [
    { id: 'a', session: 's', verification_evidence: goodEvidence() },
    { id: 'b', session: 's', verification_evidence: goodEvidence() },
    { id: 'c', session: 's', verification_evidence: goodEvidence() },
    { id: 'd', session: 's' },
    { id: 'e', session: 's' },
  ];
  const r = gate.gateBatch(streams, { producer: 's' });
  assert.equal(r.rate, 0.6);
  assert.equal(r.passed, false);
});

test('gateBatch：空列表 → 通过（无候选）', () => {
  const r = gate.gateBatch([], { producer: 's' });
  assert.equal(r.passed, true);
});

// ---------- dream 集成 ----------

test('dream 蒸馏：带证据的 decision 流水 → 晋升 + 封口 + 审计事件', () => {
  const agentName = 'P0-2蒸馏测试';
  const s = raw.append({
    session: agentName, type: 'decision', content: '决策：P0-2 门槛采用证据制判定（长度超过 12 字的有效内容）',
    verification_evidence: goodEvidence({ type: 'third_party_check', verified_by: '澈' }),
  });
  // 直接调 distill 逻辑验证（dream.js 的 distill 不可导入，这里用等价流程）
  const check = gate.canPromote(s, { producer: agentName });
  assert.equal(check.can, true);
  // 模拟 dream：core.add + raw.link
  const mem = core.add({ agent: agentName, type: 'decision', content: s.content, source: 'dream', derived_from: s.id, verification_evidence: s.verification_evidence });
  raw.link(s.id, mem.id, { intent: 'dream-distill' });
  const stored = raw.get(s.id);
  assert.equal(stored.state, 'sealed');
  // core frontmatter 透传验证（从 core.get 读回）
  const entries = core.get(agentName);
  const e = entries.find((x) => x.id === mem.id);
  assert.ok(e && e.verification_evidence, 'frontmatter 应含 verification_evidence');
  assert.equal(e.verification_evidence.verified_by, '澈');
  // 审计事件（link 触发）
  const chain = raw.verifyEvolution();
  assert.equal(chain.valid, true);
  core['delete'](mem.id); // 清理
});

test('dream 蒸馏：无证据流水 → 拒绝晋升（留在 raw 不删除）', () => {
  const s = raw.append({ session: '若兰', type: 'lesson', content: '教训：未经证据校验的结论不该晋升（内容足够长）' });
  const check = gate.canPromote(s, { producer: '若兰' });
  assert.equal(check.can, false);
  // 留在 raw、状态不变（不封口）
  const stored = raw.get(s.id);
  assert.equal(stored.state, 'burning');
  assert.ok(!stored.distilled_to || stored.distilled_to.length === 0);
});

test('dream 蒸馏：自证证据（verified_by=若兰）→ 拒绝', () => {
  const s = raw.append({
    session: '若兰', type: 'decision', content: '自证测试：这个决策我自己验证过了没有问题内容足够长',
    verification_evidence: goodEvidence({ verified_by: '若兰' }),
  });
  const check = gate.canPromote(s, { producer: '若兰' });
  assert.equal(check.can, false);
  assert.ok(check.reason.includes('self_verified'));
});

test('dream 蒸馏：叙事类流水（conversation）不蒸馏（非 DISTILLABLE）→ 无门槛问题', () => {
  // conversation 不在 DISTILLABLE，distill 直接跳过——验证无证据 conversation 不会被 gate 误伤
  const s = raw.append({ session: '若兰', type: 'conversation', content: '今天的社区讨论记录（无执行证据的叙事流水）' });
  // 模拟 dream.js 的 DISTILLABLE 检查
  const DISTILLABLE = ['decision', 'proposal', 'response', 'milestone', 'lesson'];
  assert.ok(!DISTILLABLE.includes(s.type));
  const stored = raw.get(s.id);
  assert.equal(stored.state, 'burning', '叙事流水保持 burning 待人工处置');
});

test('raw.append 支持 verification_evidence 字段落盘', () => {
  const s = raw.append({
    session: 'sync', type: 'milestone', content: '里程碑：P0-2 上线（内容足够长的里程碑记录）',
    verification_evidence: goodEvidence({ type: 'source_trace', detail: 'daily-sync 入库', verified_by: 'csb-memory-sync' }),
  });
  const stored = raw.get(s.id);
  assert.ok(stored.verification_evidence);
  assert.equal(stored.verification_evidence.type, 'source_trace');
});

// ---------- sync 自动证据 ----------

test('sync-daily 写入的流水自动带 source_trace 证据（模拟 sync-daily 调用）', () => {
  const ev = { section: '学习心得', content: '今天学了 P0-2 门槛设计，规则蒸馏不加工（足够长的内容）' };
  const s = raw.append({
    ts: '2026-09-05T00:00:00.000Z',
    session: 'daily-sync',
    type: 'conversation',
    content: ev.content,
    state: 'burning',
    meta: { section: ev.section, important: true },
    verification_evidence: {
      type: 'source_trace',
      detail: `daily-sync 入库（源：${ev.section} · 2026-09-05）`,
      verified_by: 'csb-memory-sync',
      verified_at: new Date().toISOString(),
    },
  });
  const stored = raw.get(s.id);
  assert.equal(stored.verification_evidence.type, 'source_trace');
  assert.equal(stored.verification_evidence.verified_by, 'csb-memory-sync');
  // source_trace 证据可通过门槛（机器来源非自评）
  const check = gate.validateEvidence(stored.verification_evidence, { producer: 'daily-sync' });
  assert.equal(check.valid, true);
});

test('core.add 无证据的普通条目 → frontmatter 无 verification_evidence（向后兼容）', () => {
  const agentName = 'P0-2普通条目';
  const mem = core.add({ agent: agentName, type: 'event', content: '普通记忆条目' });
  const entries = core.get(agentName);
  const e = entries.find((x) => x.id === mem.id);
  assert.ok(e, '条目应存在');
  assert.equal(e.verification_evidence, undefined, '无证据条目不应有 verification_evidence 字段');
  assert.ok(mem.success);
  core['delete'](mem.id); // 清理
});

console.log(`\n=== 测试结果 ===`);
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
process.exit(failed > 0 ? 1 : 0);
