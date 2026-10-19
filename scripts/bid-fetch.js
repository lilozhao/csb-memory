#!/usr/bin/env node
/**
 * bid-fetch.js — BID-A 跨实例取数 CLI（O6 · S4）
 *
 * 用法：
 *   node scripts/bid-fetch.js <peer>                  # 取数（需已有双方同意记录）
 *   node scripts/bid-fetch.js <peer> --dry            # 只打印将要发出的请求，不发
 *   node scripts/bid-fetch.js <peer> --since 2026-10-01
 */
'use strict';
const path = require('path');
const f = require('../lib/core/bid-fetch');

const argv = process.argv.slice(2);
const pos = argv.filter(a => !a.startsWith('--'));
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const peer = pos[0];

if (!peer) {
  console.error('用法: node scripts/bid-fetch.js <peer> [--since YYYY-MM-DD] [--dry]');
  process.exit(2);
}

(async () => {
  const r = await f.fetchFrom(peer, {
    since: arg('--since', '1970-01-01'),
    until: arg('--until', new Date().toISOString().slice(0, 10)),
    dry: argv.includes('--dry'),
    self: process.env.CSB_MEMORY_AGENT || '若兰',
  });
  if (!r.ok) {
    console.error(`⛔ [${r.stage}] ${peer}：${(r.reasons || []).join(' / ')}`);
    process.exit(r.stage === 'consent' ? 4 : 5);
  }
  if (r.stage === 'dry') {
    console.log(`🧪 dry-run → ${r.target.url}（注册表登记版本 ${r.target.version}）`);
    console.log(JSON.stringify(r.payload, null, 2));
    return;
  }
  console.log(`✅ 已取数：${peer} · 信号 ${r.record.receipt.count} 条 · 落盘 ${path.basename(r.file)}`);
  if (r.record.receipt.droppedFields.length) console.log(`   ⚠️ 越界字段 ${r.record.receipt.droppedFields.length} 条（已记录，未静默丢弃）`);
  if (r.pendingEcho) console.log('   ℹ️ 对端未回任何信号（可能是尚未实现读端，勿当作「没有信号」）');
  console.log(`   sha256 ${r.record.receipt.sha256.slice(0, 16)}…`);
})();
