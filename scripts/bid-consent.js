#!/usr/bin/env node
/**
 * bid-consent.js — BID-A 同意机制 CLI（O6 · S3）
 *
 * 用法：
 *   node scripts/bid-consent.js list                     # 全部同意记录
 *   node scripts/bid-consent.js check <peer>             # 是否允许取数
 *   node scripts/bid-consent.js grant <peer> <a,b>       # 双方同意（必须 ≥2 方）
 *   node scripts/bid-consent.js withdraw <peer> --by X   # 撤回
 *   node scripts/bid-consent.js purge <peer>             # 删除计划
 *   node scripts/bid-consent.js purged <peer>            # 标记已删除
 *   node scripts/bid-consent.js pending                  # 待删除清单
 */

'use strict';
const bc = require('../lib/core/bid-consent');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'list';
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const pos = argv.slice(1).filter(a => !a.startsWith('--'));

function printCheck(peer) {
  const r = bc.checkConsent(peer);
  console.log(`${peer}: ${r.allowed ? '✅ 允许取数' : '⛔ 不允许'}`);
  if (r.reasons.length) r.reasons.forEach(x => console.log(`  · ${x}`));
  return r;
}

switch (cmd) {
  case 'check':
    printCheck(pos[0]);
    break;

  case 'grant': {
    const peer = pos[0];
    const parties = (pos[1] || '').split(',').map(s => s.trim()).filter(Boolean);
    try {
      const rec = bc.grant(peer, parties);
      console.log(`✅ 已记录同意：${peer}`);
      console.log(`   同意方：${rec.grantedBy.join(' / ')}`);
      console.log(`   告知版本：${rec.notice}`);
      console.log(`   范围：${rec.scope.join(', ')}`);
    } catch (e) {
      console.error(`⛔ ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case 'withdraw': {
    const peer = pos[0];
    const by = arg('--by', 'unknown');
    try {
      const rec = bc.withdraw(peer, by);
      console.log(`⛔ 已撤回：${peer}（by ${by}）`);
      console.log(`   数据删除期限：${rec.purgeDeadline}（72 小时内）`);
      console.log(`   下一步：node scripts/bid-consent.js purge ${peer}`);
    } catch (e) {
      console.error(`⛔ ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case 'purge': {
    const r = bc.purgePlan(pos[0]);
    console.log(JSON.stringify(r, null, 2));
    break;
  }

  case 'purged': {
    try {
      const rec = bc.markPurged(pos[0]);
      console.log(`✅ 已标记删除完成：${rec.peer}（${rec.purgedAt}）`);
    } catch (e) {
      console.error(`⛔ ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case 'pending': {
    const p = bc.listPendingPurge();
    if (!p.overdue.length && !p.pending.length) { console.log('✅ 无待删除项'); break; }
    if (p.overdue.length) {
      console.log(`🚨 超期未删除 ${p.overdue.length} 条：`);
      p.overdue.forEach(x => console.log(`   ${x.peer} · 撤回于 ${x.withdrawnAt} · 期限 ${x.purgeDeadline}`));
    }
    if (p.pending.length) {
      console.log(`⏳ 期限内待删 ${p.pending.length} 条：`);
      p.pending.forEach(x => console.log(`   ${x.peer} · 期限 ${x.purgeDeadline}`));
    }
    break;
  }

  case 'list':
  default: {
    const data = bc.loadAll();
    console.log(`══ BID-A 同意记录 · 告知版本 ${data.notice} ══`);
    if (!data.connections.length) { console.log('（暂无记录）'); break; }
    for (const c of data.connections) {
      const st = c.withdrawn ? (c.purgedAt ? '已撤回·已删除' : '已撤回·待删除') : '有效';
      console.log(`${String(c.peer).padEnd(10)} ${st.padEnd(14)} ${c.grantedBy.join('/')} · ${c.grantedAt.slice(0, 10)}`);
    }
    break;
  }
}
