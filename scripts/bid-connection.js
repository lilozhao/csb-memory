#!/usr/bin/env node
/**
 * bid-connection.js — 连接级聚合视图 CLI（O6 · S1）
 *
 * 用法：
 *   node scripts/bid-connection.js            # 全部连接视图
 *   node scripts/bid-connection.js <peer>     # 单条连接详情
 *   node scripts/bid-connection.js --raw      # 含原始计数字段
 */

'use strict';
const bc = require('../lib/core/bid-connection');

const argv = process.argv.slice(2);
const peer = argv.find(a => !a.startsWith('--'));
const raw = argv.includes('--raw');

const r = bc.buildLocalViews();

if (peer) {
  const c = r.connections.find(x => x.peer === peer);
  if (!c) { console.error(`未找到连接：${peer}`); process.exit(1); }
  console.log(JSON.stringify(c, null, 2));
  process.exit(0);
}

console.log(`══ 连接聚合 · view=${r.view} · self=${r.self} ══`);
console.log(`条目 ${r.totalEntries} · 连接 ${r.connections.length}\n`);
console.log('peer'.padEnd(10) + '条目'.padEnd(8) + '门槛'.padEnd(16) + 'D1'.padEnd(4) + 'D2'.padEnd(4) + 'D3');
console.log('─'.repeat(58));
for (const c of r.connections) {
  const d1 = typeof c.D1 === 'object' ? '…' : c.D1;
  const d2 = typeof c.D2 === 'object' ? '…' : c.D2;
  const d3 = typeof c.D3 === 'object' ? '…' : c.D3;
  console.log(
    String(c.peer).padEnd(10) +
    String(c.raw.interactions).padEnd(8) +
    String(c.gate.label).padEnd(16) +
    String(d1).padEnd(4) + String(d2).padEnd(4) + String(d3)
  );
  if (raw) console.log('  ' + JSON.stringify(c.raw));
}
const assessable = r.connections.filter(c => c.gate.assessable).length;
console.log(`\n可评估 ${assessable} / ${r.connections.length}` + (assessable === 0 ? ' —— 全部数据不足 · 不评（诚实结果，非故障）' : ''));
