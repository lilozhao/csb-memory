#!/usr/bin/env node
/**
 * test-skill-parity.js — 技能包与仓库运行版「单一真相」校验
 *
 * 背景（2026-11-12）：三个三打卡（excellence-daily）按 csb-selfreflection-map-v1 §3
 * 落在 C3 记忆。为了让其他 Agent 升 csb-memory 版本就能装，技能包随仓库分发：
 *   skills/excellence-daily/       ← 分发包（装机时整体拷到 <ws>/skills/）
 *   scripts/excellence-*.js        ← 本仓库运行版
 *   lib/experience.js              ← 本仓库运行版
 *
 * 这两份曾经漂移过（仓库版停在 11-09，技能版到 11-12 多了长度上限/多租户/起点修复）。
 * 本测试把「两份必须逐字相同」变成机械判据 —— 改一份不改另一份，这里立刻红。
 *
 * 允许的差异：无。DATA_ROOT 已统一为向上探测，路径逻辑不再需要两份不同写法。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');

const PAIRS = [
  ['skills/excellence-daily/bin/excellence-checkin.js', 'scripts/excellence-checkin.js'],
  ['skills/excellence-daily/bin/excellence-streak.js', 'scripts/excellence-streak.js'],
  ['skills/excellence-daily/lib/experience.js', 'lib/experience.js'],
];

let pass = 0;
let fail = 0;

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

console.log('=== 技能包 ↔ 仓库运行版 单一真相校验 ===\n');

for (const [a, b] of PAIRS) {
  const fa = path.join(ROOT, a);
  const fb = path.join(ROOT, b);
  const ok = fs.existsSync(fa) && fs.existsSync(fb) && sha(fa) === sha(fb);
  if (ok) {
    console.log(`✓ ${a} ≡ ${b}`);
    pass++;
  } else {
    console.log(`✗ ${a} ≠ ${b}`);
    if (!fs.existsSync(fa)) console.log(`   缺失: ${a}`);
    if (!fs.existsSync(fb)) console.log(`   缺失: ${b}`);
    if (fs.existsSync(fa) && fs.existsSync(fb)) console.log(`   sha256: ${sha(fa).slice(0, 12)} vs ${sha(fb).slice(0, 12)}`);
    fail++;
  }
}

// 分发源不应包含备份文件（曾混进 .bak-20261110）
const stray = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.bak($|-)/.test(e.name)) stray.push(path.relative(ROOT, p));
  }
};
walk(path.join(ROOT, 'skills/excellence-daily'));
if (stray.length === 0) {
  console.log('✓ 分发包无 .bak 残留');
  pass++;
} else {
  console.log(`✗ 分发包有 .bak 残留: ${stray.join(', ')}`);
  fail++;
}

// ── 可选交叉校验：与 workspace 生产副本对比 ──────────────────────────
// 为什么加这条：本仓的 skills/ 是**分发源**，agent 真正在跑的是 <ws>/skills/excellence-daily/。
// 只比本仓内部两份（skills/ ↔ scripts/）会漏掉「改了生产副本、没同步回仓库」——
// 那正是 2026-11-09→11-12 发生过的漂移方向（仓库版停在 11-09）。
// 找不到时就跳过（其他 agent 未必有这份 workspace 源码），找到就必须逐字相同。
const wsSkill = path.resolve(ROOT, '..', 'skills', 'excellence-daily');
const wsOverride = process.env.EXCELLENCE_PARITY_WS;
const wsDir = wsOverride ? path.join(wsOverride, 'skills', 'excellence-daily') : wsSkill;
const WS_FILES = ['bin/excellence-checkin.js', 'bin/excellence-streak.js', 'bin/selfcheck.js', 'lib/experience.js'];
if (fs.existsSync(path.join(wsDir, 'SKILL.md'))) {
  console.log(`\n  交叉校验 workspace 生产副本: ${wsDir}`);
  for (const rel of WS_FILES) {
    const wf = path.join(wsDir, rel);
    const rf = path.join(ROOT, 'skills/excellence-daily', rel);
    if (!fs.existsSync(wf)) { console.log(`  ✗ 生产副本缺文件: ${rel}`); fail++; continue; }
    if (sha(wf) === sha(rf)) { console.log(`  ✓ ${rel}`); pass++; }
    else { console.log(`  ✗ ${rel} 与生产副本不一致 → 改了生产没同步回仓库（或反之）`); fail++; }
  }
} else {
  console.log(`\n  ⚪ 跳过交叉校验（未找到 ${wsDir}）—— 非本机生产环境时正常`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed`);
// 兼容 run-all-tests.js 的计数格式
console.log(`通过: ${pass}`);
console.log(`失败: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
