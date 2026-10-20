#!/usr/bin/env node
/**
 * test-experience.js — CSB-Memory EXPERIENCE 层（第四层 · Harness² C3）专项测试
 *
 * 缘起：experience.js 于 2026-10-20 落地（1d8ac98），但 <b>零测试覆盖</b>。
 *       本文件补齐，并把 Harness² 对照表 P0 #1 的判据写成断言。
 *
 * 判据来源（csb-aep/docs/harness2-csb-map-v2.md §3 P0 #1）：
 *   「条目缺 provenance / expiry / 副作用 任一 → 拒绝入库（同一拒绝计分线）」
 *
 * 用法：node test/test-experience.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const exp = require('../lib/experience');

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('✅', name);
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
    console.error('❌', name, '\n   ', e.message);
  }
}

// 每个用例一个干净目录，避免互相污染
function freshDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-exp-'));
  exp.setExpDir(dir);
  return dir;
}

function validEntry(over = {}) {
  return {
    scope: 'skill',
    scenario: '处理论坛回帖时，需要判断对方是否在引用我方原话',
    lesson: '回帖前先取父帖原文比对，不凭记忆引用',
    provenance: { raw_ids: ['raw_20261021_001'] },
    expiry: { kind: 'never' },
    side_effects: [],
    ...over,
  };
}

// ── 1. 强制字段：缺任一即拒绝（红线之三 + P0 #1 判据）────────────
test('缺 provenance → 拒绝，code=MISSING_PROVENANCE', () => {
  const e = validEntry();
  delete e.provenance;
  const r = exp.validateEntry(e);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'MISSING_PROVENANCE'), '应含 MISSING_PROVENANCE');
});

test('缺 expiry → 拒绝（写 never 也必须显式）', () => {
  const e = validEntry();
  delete e.expiry;
  const r = exp.validateEntry(e);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'MISSING_EXPIRY'));
});

test('缺 side_effects → 拒绝（无副作用也得写 []）', () => {
  const e = validEntry();
  delete e.side_effects;
  const r = exp.validateEntry(e);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'MISSING_SIDE_EFFECTS'));
});

test('缺 scenario → 拒绝', () => {
  const e = validEntry({ scenario: '   ' });  // 纯空白也算缺
  const r = exp.validateEntry(e);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'MISSING_SCENARIO'));
});

test('缺 lesson → 拒绝', () => {
  const e = validEntry();
  delete e.lesson;
  const r = exp.validateEntry(e);
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'MISSING_LESSON'));
});

test('provenance 对象为空 → EMPTY_PROVENANCE（不能拿空对象冒充有出处）', () => {
  const r = exp.validateEntry(validEntry({ provenance: {} }));
  assert.strictEqual(r.valid, false);
  assert.ok(r.errors.some(x => x.code === 'EMPTY_PROVENANCE'));
});

// ── 2. add() 的拒绝语义：抛错带 code，不静默丢弃（P1「拒绝要计分」）──
test('add() 校验失败 → 抛 EXPERIENCE_REJECTED，且带 details', () => {
  freshDir();
  let threw = null;
  try {
    exp.add({ lesson: '只有正文，什么都没有' });
  } catch (e) { threw = e; }
  assert.ok(threw, '应当抛错');
  assert.strictEqual(threw.code, 'EXPERIENCE_REJECTED');
  assert.ok(Array.isArray(threw.details) && threw.details.length > 0, '应带 details');
});

test('add() 被拒时 → 不落盘（磁盘零写入）', () => {
  const dir = freshDir();
  try { exp.add({ lesson: 'x' }); } catch (_) { /* expected */ }
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.strictEqual(files.length, 0, '拒绝的条目不得写盘');
});

test('add({dryRun}) → 只校验不写盘', () => {
  const dir = freshDir();
  const r = exp.add(validEntry(), { dryRun: true });
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.record, null);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  assert.strictEqual(files.length, 0);
});

// ── 3. 正常写入与哈希链 ────────────────────────────────
test('合法条目 → 写入成功，带 hash 与 id', () => {
  freshDir();
  const { record } = exp.add(validEntry());
  assert.ok(record.id && record.id.startsWith('exp_'));
  assert.strictEqual(record.hash.length, 64, 'sha256 = 64 hex');
});

test('写入后 list() 能读回，字段完整', () => {
  freshDir();
  exp.add(validEntry());
  const all = exp.list();
  assert.strictEqual(all.length, 1);
  assert.strictEqual(all[0].scope, 'skill');
  assert.deepStrictEqual(all[0].side_effects, []);
});

test('同一内容两次写入 → hash 相同（哈希稳定，body 键序无关）', () => {
  freshDir();
  exp.add(validEntry({ id: 'fixed', ts: '2026-10-21T00:00:00.000Z' }));
  exp.add(validEntry({ id: 'fixed', ts: '2026-10-21T00:00:00.000Z' }));
  const all = exp.list();
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].hash, all[1].hash, '同内容必须同 hash');
});

// ── 4. 防篡改（verify）─────────────────────────────────
test('verify() 干净数据 → valid', () => {
  freshDir();
  exp.add(validEntry());
  const r = exp.verify();
  assert.strictEqual(r.valid, true);
  assert.strictEqual(r.count, 1);
});

test('verify() 手改内容 → 报 tampered', () => {
  const dir = freshDir();
  exp.add(validEntry());
  const f = path.join(dir, fs.readdirSync(dir)[0]);
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const obj = JSON.parse(lines[0]);
  obj.lesson = '被改过的内容';           // 手改，不动 hash
  fs.writeFileSync(f, JSON.stringify(obj) + '\n');
  const r = exp.verify();
  assert.strictEqual(r.valid, false);
  assert.ok(r.broken.some(b => b.reason === 'tampered'));
});

// ── 5. 查询与技能级优先 ────────────────────────────────
test('query() 命中关键词，skill 级排在 task 级之前', () => {
  freshDir();
  exp.add(validEntry({ scope: 'task', scenario: '回帖任务B', lesson: '回帖前比对原文' }));
  exp.add(validEntry({ scope: 'skill', scenario: '回帖任务A', lesson: '回帖前比对原文' }));
  const r = exp.query('回帖');
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].scope, 'skill', 'skill 级应优先');
});

test('bootstrap() 只返回 skill 级，且有条数上限', () => {
  freshDir();
  for (let i = 0; i < 7; i++) {
    exp.add(validEntry({ scope: 'skill', scenario: `技能场景${i}`, lesson: '同类任务的处理方式' }));
  }
  exp.add(validEntry({ scope: 'task', scenario: '技能场景X', lesson: '同类任务的处理方式' }));
  const r = exp.bootstrap('同类任务', { limit: 5 });
  assert.strictEqual(r.length, 5);
  assert.ok(r.every(e => e.scope === 'skill'), '不得混入 task 级');
});

// ── 6. 过期语义 ────────────────────────────────────────
test('expired() 只挑出 expiry.kind=date 且已过期的', () => {
  freshDir();
  exp.add(validEntry({ expiry: { kind: 'date', at: '2020-01-01' } }));   // 已过期
  exp.add(validEntry({ expiry: { kind: 'never' } }));                    // 永不过期
  exp.add(validEntry({ expiry: { kind: 'date', at: '2099-01-01' } }));   // 未过期
  const r = exp.expired();
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].expiry.at, '2020-01-01');
});

// ── 7. Harness² 对应判据：失败样本（明德 2026-10-20 补条）──
test('[P0#1 扩展] 无失败样本的经验条目 → 当前未被拒绝（记为已知缺口）', () => {
  freshDir();
  // 明德在对照表帖子提出：EXPERIENCE provenance 应强制含失败样本数，
  // 且「失败样本数 = 0 的条目应直接拒绝入库」——因为 0 是合法值，
  // 会让「没失败过」和「没记过」长得一样。
  // 当前实现【尚未】强制该字段，本测试锁定现状，待实现后改为断言拒绝。
  let accepted = true;
  try { exp.add(validEntry()); } catch (_) { accepted = false; }
  assert.strictEqual(accepted, true, '当前应被接受（已知缺口，非同义词 bug）');
});

// ── 汇总 ───────────────────────────────────────────────
console.log('\n─────────────────────────────');
console.log(`通过: ${pass}`);
console.log(`失败: ${fail}`);
if (fail > 0) {
  console.error('\n失败明细:');
  failures.forEach(f => console.error(`  - ${f.name}: ${f.error}`));
  process.exit(1);
}
console.log('✅ EXPERIENCE 层测试全部通过');
