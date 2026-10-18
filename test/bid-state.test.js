/**
 * bid-state.test.js — SPEC-MEM-0002 验收（A1–A10）
 * 运行：node test/bid-state.test.js
 *
 * 全部在临时目录沙箱跑（不碰真档 data/a2a-memories）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const bs = require('../lib/core/bid-state');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-state-test-'));
const MEM = path.join(TMP, 'memories');
const LED = path.join(TMP, 'ledger.jsonl');
fs.mkdirSync(MEM, { recursive: true });

// ── 构造一条记忆 front-matter + 正文（格式与 core.add 落盘一致） ──
let seq = 0;
function entry({ id, agent = 'testagent', timestamp, content, sig, tags = [] }) {
  seq++;
  const lines = [
    '---',
    `id: "${id}"`,
    'type: event',
    `timestamp: "${timestamp}"`,
    'source: test',
    'confidence: high',
    `tags: [${tags.join(', ')}]`,
    'visibility: public',
    'structural_weight: 0',
    'is_core_identity: false',
    'affective_tag: {"warmth":0.5,"significance":0.5,"emotion":"neutral"}',
    'provenance: []',
  ];
  if (sig) lines.push(`bid_signal: ${JSON.stringify(sig)}`);
  lines.push('access_count: 0');
  lines.push(`last_access: "${timestamp}"`);
  lines.push('---');
  lines.push(content);
  return lines.join('\n');
}

function writeAgent(agent, blocks) {
  fs.writeFileSync(path.join(MEM, `${agent}.md`), `# ${agent} 记忆档案\n\n` + blocks.join('\n\n'));
}

function reset() {
  for (const f of fs.readdirSync(MEM)) fs.unlinkSync(path.join(MEM, f));
  if (fs.existsSync(LED)) fs.unlinkSync(LED);
}

function writeLedger(rows) {
  fs.writeFileSync(LED, rows.map(r => JSON.stringify(r)).join('\n') + '\n');
}

const P = (state = 'pending') => ({ kind: 'promise', peer: null, direction: null, state });
const NOW = Date.parse('2026-10-18T12:00:00Z');

console.log('══ SPEC-MEM-0002 验收（A1–A10）══');

// ── A1 → R1：只扫 promise ──
reset();
writeAgent('a1', [
  entry({ id: 'a1-p1', timestamp: '2026-10-10T00:00:00Z', content: '我承诺完成这份文档', sig: P() }),
  entry({ id: 'a1-p2', timestamp: '2026-10-10T00:00:00Z', content: '我承诺再完成第二份文档', sig: P() }),
  entry({ id: 'a1-p3', timestamp: '2026-10-10T00:00:00Z', content: '我承诺完成第三份文档', sig: P() }),
  entry({ id: 'a1-c1', timestamp: '2026-10-10T00:00:00Z', content: '我方更正：口径写错了', sig: { kind: 'correction', peer: null, direction: 'out', state: 'pending' } }),
  entry({ id: 'a1-c2', timestamp: '2026-10-10T00:00:00Z', content: '墨丘主动更正：数据有误', sig: { kind: 'correction', peer: '墨丘', direction: 'in', state: 'pending' } }),
  entry({ id: 'a1-c3', timestamp: '2026-10-10T00:00:00Z', content: '我们决定采用方案 B', sig: { kind: 'decision', peer: null, direction: null, state: 'pending' } }),
]);
let r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW, dryRun: true });
ok('A1 只扫 promise 类（3 条，不含 correction/decision）', r.scanned === 3, `实得 ${r.scanned}`);

// ── A2 → R2：命中完成锚 → fulfilled ──
reset();
writeAgent('a2', [
  entry({ id: 'a2-1', timestamp: '2026-10-01T00:00:00Z', content: '我承诺把记忆备份脚本迁移到独立 cron', sig: P() }),
]);
writeLedger([
  { seq: 1, ts: '2026-10-02T00:00:00Z', actor: '若兰', action: 'cron.update', target: '记忆备份脚本迁移到独立 cron', reason: '完成迁移' },
]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A2 有完成锚 → fulfilled', r.byState.fulfilled === 1, JSON.stringify(r.byState));
ok('A2 锚引用写入 changes', r.changes[0] && /^ledger#1$/.test(r.changes[0].anchor.ref), JSON.stringify(r.changes[0] && r.changes[0].anchor));

// ── A3 → R3：显式过期 + 无锚 → overdue ──
reset();
writeAgent('a3', [
  entry({ id: 'a3-1', timestamp: '2026-09-01T00:00:00Z', content: '我承诺提交评估报告，截止 2026-09-20', sig: P() }),
]);
writeLedger([]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A3 过期无锚 → overdue', r.byState.overdue === 1, JSON.stringify(r.byState));

// 窗口兜底（无显式时限，超 90 天）
reset();
writeAgent('a3b', [
  entry({ id: 'a3b-1', timestamp: '2026-06-01T00:00:00Z', content: '我承诺会完成这件事', sig: P() }),
]);
writeLedger([]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A3 超 90 天窗口 → overdue', r.byState.overdue === 1, JSON.stringify(r.byState));

// ── A4 → R4：撤回证据 → withdrawn ──
reset();
writeAgent('a4', [
  entry({ id: 'a4-1', timestamp: '2026-10-01T00:00:00Z', content: '⛔ 该约定终止，不再推进', sig: P() }),
  entry({ id: 'a4-2', timestamp: '2026-10-01T00:00:00Z', content: '我承诺做这件事（主动撤回承诺）', sig: P() }),
]);
writeLedger([]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A4 撤回证据 → withdrawn（⛔ + 文本两种）', r.byState.withdrawn === 2, JSON.stringify(r.byState));

// ── A5 → R5：无锚保持 pending ──
reset();
writeAgent('a5', [
  entry({ id: 'a5-1', timestamp: '2026-10-17T00:00:00Z', content: '我承诺跟进一下这件小事', sig: P() }),
]);
writeLedger([]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A5 无锚 → 保持 pending', r.changed === 0 && r.byState.pending === 1, JSON.stringify(r.byState));

// ── A6 → R6：幂等（第二次零变更） ──
reset();
writeAgent('a6', [
  entry({ id: 'a6-1', timestamp: '2026-10-01T00:00:00Z', content: '我承诺提交评估报告，截止 2026-09-01', sig: P() }),
  entry({ id: 'a6-2', timestamp: '2026-10-17T00:00:00Z', content: '我承诺继续跟进', sig: P() }),
]);
writeLedger([]);
const r1 = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
const r2 = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A6 第一次有变更', r1.changed === 1, `changed=${r1.changed}`);
ok('A6 第二次零变更（幂等）', r2.changed === 0, `changed=${r2.changed}`);

// ── A7 → R7：存量反抽补落字段 ──
reset();
writeAgent('a7', [
  entry({ id: 'a7-1', timestamp: '2026-09-01T00:00:00Z', content: '与墨丘确认了接口对齐方案' }),
  entry({ id: 'a7-2', timestamp: '2026-09-01T00:00:00Z', content: '今天杭州下雨了' }),
]);
const rs = bs.resigil({ memoryDir: MEM });
ok('A7 无字段历史条目补落 bid_signal', rs.filled === 1, `filled=${rs.filled}`);
const after = fs.readFileSync(path.join(MEM, 'a7.md'), 'utf8');
ok('A7 落盘后文件含 bid_signal', after.includes('bid_signal:'));

// ── A8 → R8：origin=backfill ──
ok('A8 反抽条目含 origin=backfill', /"origin":"backfill"/.test(after));

// ── A9 → R9：不删除条目 ──
reset();
writeAgent('a9', [
  entry({ id: 'a9-1', timestamp: '2026-06-01T00:00:00Z', content: '我承诺完成旧任务', sig: P() }),
  entry({ id: 'a9-2', timestamp: '2026-10-17T00:00:00Z', content: '我承诺新任务', sig: P() }),
  entry({ id: 'a9-3', timestamp: '2026-10-17T00:00:00Z', content: '普通记录一条' }),
]);
writeLedger([]);
const rb = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A9 回填前后条目总数不变', rb.totalBefore === rb.totalAfter && rb.totalBefore === 3, `${rb.totalBefore}/${rb.totalAfter}`);
const keptIds = (fs.readFileSync(path.join(MEM, 'a9.md'), 'utf8').match(/^id: /gm) || []).length;
ok('A9 落盘后仍为 3 条', keptIds === 3, `实得 ${keptIds}`);

// ── A10 → R10：审计记录含旧→新 + 锚引用 ──
reset();
writeAgent('a10', [
  entry({ id: 'a10-1', timestamp: '2026-09-01T00:00:00Z', content: '我承诺提交评估报告，截止 2026-09-20', sig: P() }),
]);
writeLedger([]);
const r10 = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
const ch = r10.changes[0];
ok('A10 变更产生审计要素（旧值→新值 + 锚引用）',
  !!(ch && ch.from === 'pending' && ch.to === 'overdue' && ch.anchor && ch.anchor.ref),
  JSON.stringify(ch));
const auditDir = path.join(__dirname, '..', 'data', 'audit');
const todayAudit = path.join(auditDir, `audit-${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}.log`);
const auditText = fs.existsSync(todayAudit) ? fs.readFileSync(todayAudit, 'utf8') : '';
ok('A10 audit.log 落盘含 memory.bid_state.change', auditText.includes('memory.bid_state.change'));


// ── A2b → R2：真实形态锚（正文提到实体，ledger 另日完成）──
reset();
writeAgent('a2b', [
  entry({ id: 'a2b-1', timestamp: '2026-10-15T00:00:00Z', content: '承诺把 SPEC-MEM-0002 的四态回填命令写出来', sig: P() }),
]);
writeLedger([
  { seq: 9, ts: '2026-10-16T12:00:00Z', actor: '若兰', action: 'code.patch', target: 'csb-memory lib/core/bid-state.js 四态回填', reason: '实现四态回填命令' },
]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A2b 实体词命中 → fulfilled', r.byState.fulfilled === 1, JSON.stringify(r.byState));

// ── A2c → R2 反例：锚在承诺之前不算 ──
reset();
writeAgent('a2c', [
  entry({ id: 'a2c-1', timestamp: '2026-10-10T00:00:00Z', content: '承诺把 SPEC-MEM-0002 的四态回填命令写出来', sig: P() }),
]);
writeLedger([
  { seq: 9, ts: '2026-10-01T12:00:00Z', actor: '若兰', action: 'code.patch', target: 'csb-memory 四态回填命令', reason: '实现四态回填命令' },
]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW, windowDays: 90 });
ok('A2c 早于承诺的锚不算履约', r.byState.fulfilled === 0, JSON.stringify(r.byState));

// ── A2d → R2 反例：非完成类动作不算锚（spec.approve ≠ done）──
reset();
writeAgent('a2d', [
  entry({ id: 'a2d-1', timestamp: '2026-10-15T00:00:00Z', content: '承诺把 SPEC-MEM-0002 的四态回填命令写出来', sig: P() }),
]);
writeLedger([
  { seq: 9, ts: '2026-10-16T12:00:00Z', actor: '一澜', action: 'spec.approve', target: 'SPEC-MEM-0002 四态回填', reason: '批准' },
]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A2d spec.approve 不当作完成锚', r.byState.fulfilled === 0, JSON.stringify(r.byState));


// ── A4b → R4 反例：列表语境里的 ⛔ 不是撤回证据（2026-10-18 真机误判）──
reset();
writeAgent('a4b', [
  entry({ id: 'a4b-1', timestamp: '2026-10-06T00:00:00Z', content: 'TODO：N-2 行改 ⛔ 否决·全停；找四候选只剩 N-1 / N-3', sig: P() }),
]);
writeLedger([]);
r = bs.backfill({ memoryDir: MEM, ledgerPath: LED, now: NOW });
ok('A4b 列表语境 ⛔ 不判 withdrawn', r.byState.withdrawn === 0, JSON.stringify(r.byState));
ok('A4b 该条保持 pending', r.byState.pending === 1, JSON.stringify(r.byState));


// ═══════════ P0 优化验收（O1–O4 · 2026-10-18）════════════

// ── O1 → rescore：存量重判 ──
reset();
writeAgent('o1', [
  // 误报：含"承诺"但实为谈论 → v2.0 不认
  entry({ id: 'o1-bad', timestamp: '2026-10-10T00:00:00Z', content: '讨论一下承诺履约率怎么算', sig: P() }),
  // 真信号：v2.0 仍认
  entry({ id: 'o1-good', timestamp: '2026-10-10T00:00:00Z', content: '我承诺明天完成这件事', sig: P() }),
]);
let ro = bs.rescore({ memoryDir: MEM });
ok('O1 误报被摘除', ro.removed === 1, JSON.stringify({ removed: ro.removed, kept: ro.kept }));
ok('O1 真信号保留', ro.kept === 1, JSON.stringify(ro));
const o1text = fs.readFileSync(path.join(MEM, 'o1.md'), 'utf8');
ok('O1 摘除后文件不再含该条 bid_signal', !/o1-bad[\s\S]{0,400}bid_signal/.test(o1text));
ok('O1 条目本身未被删除', (o1text.match(/^id: /gm) || []).length === 2);
// 幂等
const ro2 = bs.rescore({ memoryDir: MEM });
ok('O1 重跑零变更（幂等）', ro2.removed === 0 && ro2.rekinded === 0, JSON.stringify(ro2));

// ── O2 → peer 收紧 ──
const bid = require('../lib/core/bid-signal');
ok('O2 关系位置「与X」认作 peer', bid.extractPeer({ content: '与阿轩确认了接口对齐方案' }) === '阿轩');
ok('O2 主语位置「X主动」认作 peer', bid.extractPeer({ content: '墨丘主动更正：数据源有误' }) === '墨丘');
ok('O2 纯提及不认作 peer', bid.extractPeer({ content: '来源链条：若琢 09-01 回帖承诺 → 增补' }) === null);
ok('O2 无名字 → null', bid.extractPeer({ content: '我承诺明天完成这件事' }) === null);
ok('O2 显式传入优先', bid.extractPeer({ content: '随便一句', peer: '星尘' }) === '星尘');

// ── O3 → 去重报告 ──
reset();
writeAgent('o3', [
  entry({ id: 'o3-a', timestamp: '2026-10-01T00:00:00Z', content: '溢出告警：无（EXIT=0，无输出）', sig: P() }),
  entry({ id: 'o3-b', timestamp: '2026-10-02T00:00:00Z', content: '溢出告警：无（EXIT=0，无输出）', sig: P() }),
  entry({ id: 'o3-c', timestamp: '2026-10-03T00:00:00Z', content: '溢出告警：无（EXIT=0，无输出）', sig: P() }),
  entry({ id: 'o3-d', timestamp: '2026-10-04T00:00:00Z', content: '这是完全不同的一条内容记录', sig: P() }),
]);
const rd = bs.findDuplicateTexts({ memoryDir: MEM });
ok('O3 识别出 1 组重复', rd.dupGroups === 1, JSON.stringify({ groups: rd.dupGroups }));
ok('O3 该组计数为 3', rd.groups[0] && rd.groups[0].count === 3, JSON.stringify(rd.groups[0] && rd.groups[0].count));
ok('O3 只报告不删除（条目数不变）', (fs.readFileSync(path.join(MEM, 'o3.md'), 'utf8').match(/^id: /gm) || []).length === 4);

// ── O4 → 前置门槛 ──
const NOW2 = Date.parse('2026-10-18T12:00:00Z');
const tShort = bs.checkThreshold({ firstAt: '2026-10-10T00:00:00Z', interactions: 3, diffs: 0 }, { now: NOW2 });
ok('O4 窗口不足 → 不评', !tShort.assessable && tShort.label === '数据不足 · 不评', JSON.stringify(tShort.reasons));
const tFew = bs.checkThreshold({ firstAt: '2026-08-01T00:00:00Z', interactions: 3, diffs: 2 }, { now: NOW2 });
ok('O4 互动不足 → 不评', !tFew.assessable, JSON.stringify(tFew.reasons));
const tNoDiff = bs.checkThreshold({ firstAt: '2026-08-01T00:00:00Z', interactions: 20, diffs: 0 }, { now: NOW2 });
ok('O4 无痕迹 → 不评', !tNoDiff.assessable, JSON.stringify(tNoDiff.reasons));
const tPass = bs.checkThreshold({ firstAt: '2026-08-01T00:00:00Z', interactions: 20, diffs: 2 }, { now: NOW2 });
ok('O4 三项达标 → 可评估', tPass.assessable && tPass.label === '可评估', JSON.stringify(tPass.metrics));

// O4 漏斗留痕
const funnel = bs.thresholdFunnel([
  { name: 'good', firstAt: '2026-08-01T00:00:00Z', interactions: 20, diffs: 2 },
  { name: 'bad1', firstAt: '2026-10-15T00:00:00Z', interactions: 2, diffs: 0 },
  { name: 'bad2', firstAt: '2026-10-16T00:00:00Z', interactions: 1, diffs: 0 },
], { now: NOW2 });
ok('O4 漏斗统计正确', funnel.total === 3 && funnel.passed === 1 && funnel.blocked === 2, JSON.stringify(funnel));
ok('O4 挡率 >50% 触发复审', funnel.reviewTriggered === true, `ratio=${funnel.blockedRatio}`);

reset();

// ── 收尾 ──
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log(`\n通过: ${pass}\n失败: ${fail}`);
console.log(fail ? '❌ SPEC-MEM-0002 存在失败' : '✅ SPEC-MEM-0002 全部通过');
process.exit(fail ? 1 : 0);
