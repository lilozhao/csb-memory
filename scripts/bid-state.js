#!/usr/bin/env node
/**
 * bid-state.js — 承诺四态回填 + 存量反抽 · CLI（SPEC-MEM-0002）
 *
 * 用法：
 *   node scripts/bid-state.js backfill [--dry] [--window 90] [--now ISO]
 *   node scripts/bid-state.js resigil  [--dry] [--kinds promise,correction]
 *   node scripts/bid-state.js rescore  [--dry]        # O1 存量重判（v2.0 对齐）
 *   node scripts/bid-state.js dups     [--min N]      # O3 重复正文报告（只读）
 *   node scripts/bid-state.js stats
 *
 * 纪律：默认只读预览（--dry 可省，本 CLI **默认真实写入**——与一期 sync 脚本一致；
 *       正式跑前建议先 --dry 看读数）。
 */

'use strict';

const bs = require('../lib/core/bid-state');

const argv = process.argv.slice(2);
const cmd = argv[0] || 'stats';
const has = n => argv.includes(n);
const arg = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const dryRun = has('--dry') || has('--dry-run');

function printBackfill(r) {
  console.log(`══ 四态回填${dryRun ? '（预览）' : ''} ══`);
  console.log(`扫描 promise 条目=${r.scanned} · 变更=${r.changed}`);
  console.log(`  fulfilled=${r.byState.fulfilled} · overdue=${r.byState.overdue} · withdrawn=${r.byState.withdrawn} · 保持 pending=${r.byState.pending}`);
  console.log(`条目总数 before=${r.totalBefore} after=${r.totalAfter} ${r.totalBefore === r.totalAfter ? '✅ 不删除' : '❌ 条数变化'}`);
  for (const c of r.changes.slice(0, 20)) {
    console.log(`  [${c.from}→${c.to}] ${c.agent}#${c.id} · 锚=${c.anchor.type}:${c.anchor.ref}`);
  }
  if (r.changes.length > 20) console.log(`  … 另 ${r.changes.length - 20} 条`);
}

function printResigil(r) {
  console.log(`══ 存量反抽${dryRun ? '（预览）' : ''} ══`);
  console.log(`扫描无字段条目=${r.scanned} · 补落=${r.filled}`);
  const byKind = {};
  for (const e of r.entries) byKind[e.kind] = (byKind[e.kind] || 0) + 1;
  console.log(`kind 分布: ${JSON.stringify(byKind)}`);
  for (const e of r.entries.slice(0, 10)) console.log(`  ${e.agent}#${e.id} · ${e.kind} · peer=${e.peer || '-'}`);
}

switch (cmd) {
  case 'backfill': {
    const now = arg('--now') ? Date.parse(arg('--now')) : Date.now();
    const r = bs.backfill({ dryRun, now, windowDays: parseInt(arg('--window', '90'), 10) });
    printBackfill(r);
    process.exit(0);
  }
  case 'resigil': {
    const kindsArg = arg('--kinds'); // 如 --kinds promise,correction
    const kinds = kindsArg ? kindsArg.split(',').map(s => s.trim()).filter(Boolean) : null;
    const r = bs.resigil({ dryRun, kinds });
    printResigil(r);
    process.exit(0);
  }
  case 'rescore': {
    const r = bs.rescore({ dryRun });
    console.log(`══ 存量重判${dryRun ? '（预览）' : ''} ══`);
    console.log(`扫描带信号条目=${r.scanned}`);
    console.log(`  摘除误报=${r.removed} · 类别变更=${r.rekinded} · 保持=${r.kept}`);
    for (const c of r.changes.slice(0, 25)) {
      console.log(`  ${c.action === 'removed' ? '🗑 ' : '↻ '}${c.agent}#${c.id} · ${c.from}${c.to ? '→' + c.to : ''}`);
    }
    if (r.changes.length > 25) console.log(`  … 另 ${r.changes.length - 25} 条`);
    process.exit(0);
  }
  case 'dups': {
    const r = bs.findDuplicateTexts({ minCount: parseInt(arg('--min', '2'), 10) });
    console.log('══ 重复正文报告 ══');
    console.log(`条目总数=${r.total} · 重复组=${r.dupGroups} · 牵涉条目=${r.dupEntries}`);
    for (const g of r.groups.slice(0, 15)) {
      console.log(`  ×${g.count} [${g.agent}] ${g.sample}${g.withSignal ? ` (含信号 ${g.withSignal})` : ''}`);
    }
    process.exit(0);
  }
  case 'stats':
  default: {
    const b = bs.backfill({ dryRun: true });
    console.log(`promise 条目=${b.scanned}（可回填=${b.changed}）`);
    process.exit(0);
  }
}
