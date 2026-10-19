/**
 * bid-consent.test.js — O6 S3 验收（同意机制）
 * 运行：node test/bid-consent.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const bc = require('../lib/core/bid-consent');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-consent-test-'));
let n = 0;
const newFile = () => path.join(TMP, `consent-${++n}.json`);

console.log('══ O6-S3 同意机制验收 ══');

// ── 沉默不采 ──
const f1 = newFile();
let r = bc.checkConsent('阿轩', { file: f1 });
ok('无记录 → 不允许（沉默不采）', r.allowed === false);
ok('无记录 → 原因明确', r.reasons[0].includes('无同意记录'), r.reasons[0]);

// ── 单方同意无效 ──
const f2 = newFile();
let threw = false;
try { bc.grant('阿轩', ['若兰'], { file: f2 }); } catch { threw = true; }
ok('单方同意被拒绝', threw === true);
threw = false;
try { bc.grant('阿轩', [], { file: f2 }); } catch { threw = true; }
ok('空同意方被拒绝', threw === true);

// ── 双方同意 ──
const f3 = newFile();
const rec = bc.grant('阿轩', ['若兰', '阿轩'], { file: f3 });
ok('双方同意记录成功', rec.grantedBy.length === 2);
r = bc.checkConsent('阿轩', { file: f3 });
ok('双方同意 → 允许取数', r.allowed === true, r.reasons.join('|'));
ok('scope 限定信号读', rec.scope.includes('bid_signal.read'));
ok('记录告知版本', rec.notice === bc.CURRENT_NOTICE);

// ── 告知语义版本不符 → 视为未同意（Q-S3-4：比语义版本，不比文案 sha） ──
const f4 = newFile();
bc.grant('墨丘', ['若兰', '墨丘'], { file: f4, noticeVersion: 'v0' });
r = bc.checkConsent('墨丘', { file: f4 });
ok('告知语义版本不符 → 不允许', r.allowed === false);
ok('版本不符原因明确', r.reasons.some(x => x.includes('语义版本不符')), r.reasons.join('|'));

// ── Q-S3-4 反证：文案变了但语义版本不变 → 同意仍然有效 ──
const f4b = newFile();
bc.grant('墨丘', ['若兰', '墨丘'], { file: f4b, notice: 'bid-a-consent-notice-v1-typo-fix', noticeVersion: 'v1' });
r = bc.checkConsent('墨丘', { file: f4b });
ok('Q-S3-4 措辞/排版变更不触发重签', r.allowed === true, r.reasons.join('|'));

// ── Q-S3-1 两段式：撤回后 24h 隔离 / 48h 删除目标 / 72h 硬上限 ──
const f4c = newFile();
bc.grant('澈', ['若兰', '澈'], { file: f4c });
const wd = bc.withdraw('澈', '若兰', { file: f4c });
const H = 3600 * 1000;
const t0 = Date.parse(wd.withdrawn.at);
ok('Q-S3-1 隔离期限 = 撤回 + 24h', Date.parse(wd.isolateDeadline) - t0 === 24 * H);
ok('Q-S3-1 删除目标 = 撤回 + 48h', Date.parse(wd.purgeTarget) - t0 === 48 * H);
ok('Q-S3-1 硬上限 = 撤回 + 72h', Date.parse(wd.purgeDeadline) - t0 === 72 * H);
ok('Q-S3-1 撤回即置隔离标记', wd.isolated === true);
r = bc.checkConsent('澈', { file: f4c });
ok('Q-S3-1 隔离期内不允许取数', r.allowed === false && r.reasons.some(x => x.includes('已隔离')), r.reasons.join('|'));

// ── Q-S3-2 撤回未通知对方 → 流程未完成 ──
ok('Q-S3-2 撤回未通知 → 原因含「尚未通知」', r.reasons.some(x => x.includes('尚未通知')), r.reasons.join('|'));
const nrec = bc.markNotified('澈', { file: f4c, to: '澈', by: '若兰' });
ok('Q-S3-2 markNotified 记录通知', !!nrec.notified && nrec.notified.to === '澈');
r = bc.checkConsent('澈', { file: f4c });
ok('Q-S3-2 通知后不再报「尚未通知」', !r.reasons.some(x => x.includes('尚未通知')), r.reasons.join('|'));

// ── Q-S3-1 阶段判定：隔离中 / 该删了 ──
{
  const nowIso = new Date(t0 + 25 * H).toISOString();
  const t = bc.readFileForTest ? null : null;
  const fsx = require('fs');
  const data = JSON.parse(fsx.readFileSync(f4c, 'utf8'));
  data.connections.find(c => c.peer === '澈').purgedAt = null;
  fsx.writeFileSync(f4c, JSON.stringify(data, null, 2));
  const pending = bc.listPendingPurge({ file: f4c, now: t0 + 25 * H });
  ok('Q-S3-1 过 24h 未删 → stage=isolated', pending.pending.some(x => x.peer === '澈' && x.stage === 'isolated'),
    JSON.stringify(pending.pending));
  const overdue = bc.listPendingPurge({ file: f4c, now: t0 + 73 * H });
  ok('Q-S3-1 过 72h 未删 → 进 overdue', overdue.overdue.some(x => x.peer === '澈'));
}

// ── 过期 ──
const f5 = newFile();
bc.grant('舟楫', ['若兰', '舟楫'], { file: f5, expiresAt: '2026-01-01T00:00:00Z' });
r = bc.checkConsent('舟楫', { file: f5 });
ok('过期 → 不允许', r.allowed === false);
ok('过期原因明确', r.reasons.some(x => x.includes('已过期')), r.reasons.join('|'));

// ── 撤回 ──
const f6 = newFile();
bc.grant('若琢', ['若兰', '若琢'], { file: f6 });
const w = bc.withdraw('若琢', '若琢', { file: f6 });
ok('撤回记录带时间与撤回方', w.withdrawn.at && w.withdrawn.by === '若琢');
ok('撤回起算 72h 删除期限', !!w.purgeDeadline);
const dl = Date.parse(w.purgeDeadline) - Date.parse(w.withdrawn.at);
ok('删除期限恰为 72 小时', Math.abs(dl - 72 * 3600 * 1000) < 1000, `${dl / 3600000}h`);
r = bc.checkConsent('若琢', { file: f6 });
ok('撤回后 → 不允许取数', r.allowed === false);
ok('撤回原因可查', r.reasons.some(x => x.includes('已撤回')), r.reasons.join('|'));
ok('撤回未删除时另标一条', r.reasons.some(x => x.includes('尚未删除')), r.reasons.join('|'));

// ── 删除计划 ──
const plan = bc.purgePlan('若琢', { file: f6 });
ok('删除计划含撤回时间', plan.withdrawnAt === w.withdrawn.at);
ok('删除计划含期限', plan.purgeDeadline === w.purgeDeadline);
ok('未登记副本时如实说明', plan.note.includes('未登记'), plan.note);

// ── 未撤回的连接不生成删除计划 ──
const f7 = newFile();
bc.grant('星尘', ['若兰', '星尘'], { file: f7 });
const plan2 = bc.purgePlan('星尘', { file: f7 });
ok('未撤回 → 拒绝生成删除计划', !!plan2.error, JSON.stringify(plan2));

// ── 标记已删除后 ──
bc.markPurged('若琢', { file: f6 });
const data = bc.loadAll(f6);
ok('标记后 purgedAt 已写', !!data.connections[0].purgedAt);
ok('标记后不再出现在待删除清单', bc.listPendingPurge({ file: f6 }).pending.length === 0);

// ── 超期检测 ──
const f8 = newFile();
bc.grant('小虾', ['若兰', '小虾'], { file: f8 });
const w8 = bc.withdraw('小虾', '小虾', { file: f8 });
const future = Date.parse(w8.purgeDeadline) + 1000;
const p8 = bc.listPendingPurge({ file: f8, now: future });
ok('超期未删除 → 进 overdue', p8.overdue.length === 1, JSON.stringify(p8));

// ── 多连接共存 ──
const f9 = newFile();
bc.grant('阿轩', ['若兰', '阿轩'], { file: f9 });
bc.grant('墨丘', ['若兰', '墨丘'], { file: f9 });
const all = bc.loadAll(f9);
ok('多连接记录共存', all.connections.length === 2);
ok('各自独立校验', bc.checkConsent('阿轩', { file: f9 }).allowed && bc.checkConsent('墨丘', { file: f9 }).allowed);

// ── 损坏文件不误判 ──
const f10 = newFile();
fs.writeFileSync(f10, '{ 这不是合法 JSON');
ok('文件损坏 → 视为无同意（安全失败）', bc.checkConsent('任何人', { file: f10 }).allowed === false);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log(`\n通过: ${pass}\n失败: ${fail}`);
console.log(fail ? '❌ bid-consent 存在失败' : '✅ bid-consent 全部通过');
process.exit(fail ? 1 : 0);
