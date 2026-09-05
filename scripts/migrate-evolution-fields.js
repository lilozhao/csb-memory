#!/usr/bin/env node
/**
 * migrate-evolution-fields.js — P0-4 存量迁移（2026-09-05）
 *
 * 目标：把 v1.1 存量底仓锚定进 P0-4 变更审计流。
 * 原则：**不动原文件**（append-only：内容不可变）——迁移 = 在
 * raw-evolution.jsonl 追加一条 baseline_anchor 事件，锚定存量文件数/
 * 条目数/内容汇总哈希。此后任何状态变更/链接都挂同一条哈希链。
 *
 * 用法：node scripts/migrate-evolution-fields.js [--dry-run]
 * 输出：迁移报告（锚定成功 / 已锚定 / dry-run 预览）
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const raw = require('../lib/raw/raw');

const RAW_DIR = raw.getRawDir();
const EVO_FILE = path.join(RAW_DIR, 'raw-evolution.jsonl');

function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  if (!fs.existsSync(RAW_DIR)) {
    console.log('NO_REPLY（raw 目录不存在）');
    process.exit(0);
  }

  // 存量 raw 文件（日期分片）
  const files = fs.readdirSync(RAW_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  let entryCount = 0;
  const hashes = [];
  for (const f of files) {
    const content = fs.readFileSync(path.join(RAW_DIR, f), 'utf8');
    entryCount += content.split('\n').filter(Boolean).length;
    hashes.push(sha256(content));
  }
  const contentHash = sha256(hashes.join('|'));

  // 检查是否已锚定
  const existing = raw.readEvolution();
  const anchored = existing.some((e) => e.action === 'baseline_anchor');
  const chain = raw.verifyEvolution();

  console.log(`📦 存量底仓：${files.length} 文件 / ${entryCount} 条目`);
  console.log(`🔗 审计流：${existing.length} 事件 | 哈希链：${chain.valid ? '✅ 有效' : '❌ 断裂'}`);

  if (anchored) {
    console.log('ℹ️  已锚定（baseline_anchor 存在），无需重复迁移');
    process.exit(0);
  }

  if (dryRun) {
    console.log(`（dry-run）将追加 baseline_anchor：files=${files.length} entries=${entryCount} hash=${contentHash.slice(0, 16)}…`);
    process.exit(0);
  }

  raw.appendEvolution({
    id: 'evo_' + Date.now().toString(36) + '_anchor',
    action: 'baseline_anchor',
    scope: 'existing_raw_v1.1',
    file_count: files.length,
    entry_count: entryCount,
    content_hash: contentHash,
    intent: 'migrate-v1.1-to-p0-4',
    outcome: 'success',
  });

  const after = raw.verifyEvolution();
  console.log(`✅ 锚定完成：审计流 ${raw.evolutionStats().total} 事件 | 链 ${after.valid ? '✅ 有效' : '❌ 断裂'}`);
  console.log('   （存量内容未被修改——append-only 原则：修改 = 新条目 + derived_from）');
}

main();
