#!/usr/bin/env node
'use strict';
/**
 * selfcheck.js —— 三个三推广包 · 装机自检（2026-11-12 加 · W-58）
 *
 * 为什么要有它：装技能的人不该靠「看文档猜自己装对了没」。
 *   这个脚本在**临时目录**里完整跑一遍装机流程，产出可核对的机械判据，
 *   全程不碰生产数据（不写你的 workspace、不改你的 streak）。
 *
 * 用法：
 *   node bin/selfcheck.js
 *
 * 判据（任一不过即 exit 1）：
 *   1) 独立副本能在临时 workspace 里装配（不依赖原目录）
 *   2) `--dry` 校验 exit 0
 *   3) 正式入库 exit 0，且产出三件：
 *        <root>/data/experience/<YYYY-MM>.jsonl
 *        <root>/memory/excellence/<YYYY-MM>.md
 *        <root>/memory/excellence/streak.json
 *   4) streak.startDate == 今天（**不是**别人的起点日）
 *   5) 负向：缺一项分数必须被拒（MISSING_SCORE，非 0 退出）
 *   6) 负向：超长内省必须被拒（LONG_INNER，非 0 退出）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.join(__dirname, '..');
const CLI = path.join('skills', 'excellence-daily', 'bin', 'excellence-checkin.js');

const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

const checks = [];
function check(name, fn) {
  try {
    const detail = fn();
    checks.push({ name, ok: true, detail });
    console.log(`  ✓ ${name}${detail ? ` —— ${detail}` : ''}`);
  } catch (err) {
    checks.push({ name, ok: false, detail: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const assert = require('assert');

function run(cwd, args, env) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'excellence-selfcheck-'));
const WS = path.join(TMP, 'ws');
const today = localToday();

const goodInput = {
  date: today,
  count_in_streak: true,
  score: { wen_guo_ze_xi: 7, yi_yi_wei_li: 5, jian_xian_si_qi: 8, jie_xu_rong: 4, jie_yuan_hen: 9, jie_ji_du: 9 },
  score_note: { jie_xu_rong: '装机自检：无负记录也未回避' },
  gong: '装机自检一功',
  wu: '装机自检一悟',
  shan: '装机自检一善',
  raw_ids: [`${today}.md`],
  todo_three: ['1. 装机自检'],
};

function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  return p;
}

console.log(`三个三推广包 · 装机自检（临时目录 ${TMP}）\n`);

check('1 独立副本可在临时 workspace 装配', () => {
  copyDir(SKILL_DIR, path.join(WS, 'skills', 'excellence-daily'));
  // 删掉本地备份文件，确认不是靠残留文件跑起来的
  for (const f of fs.readdirSync(path.join(WS, 'skills', 'excellence-daily', 'bin'))) {
    if (f.includes('.bak')) fs.unlinkSync(path.join(WS, 'skills', 'excellence-daily', 'bin', f));
  }
  assert.ok(fs.existsSync(path.join(WS, CLI)), '副本里找不到入口脚本');
  return '入口齐全';
});

const goodFile = writeJson(path.join(TMP, 'good.json'), goodInput);

check('2 --dry 校验 exit 0', () => {
  const r = run(WS, [CLI, '--input', goodFile, '--dry']);
  assert.strictEqual(r.status, 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  assert.ok(/校验通过/.test(r.stdout), `输出里没有「校验通过」：${r.stdout}`);
  return '校验通过';
});

check('3 正式入库 exit 0 且产出三件', () => {
  const r = run(WS, [CLI, '--input', goodFile]);
  assert.strictEqual(r.status, 0, `exit=${r.status}\n${r.stdout}${r.stderr}`);
  const ym = today.slice(0, 7);
  const arts = [
    path.join(WS, 'data', 'experience', `${ym}.jsonl`),
    path.join(WS, 'memory', 'excellence', `${ym}.md`),
    path.join(WS, 'memory', 'excellence', 'streak.json'),
  ];
  for (const p of arts) assert.ok(fs.existsSync(p), `缺产物：${path.relative(WS, p)}`);
  const lines = fs.readFileSync(arts[0], 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'EXPERIENCE 是空的');
  JSON.parse(lines[0]); // 必须是合法 JSON
  return `${path.relative(WS, arts[0])} / ${path.relative(WS, arts[1])} / streak.json`;
});

check('4 streak.startDate == 今天（不是别人的起点）', () => {
  const s = JSON.parse(fs.readFileSync(path.join(WS, 'memory', 'excellence', 'streak.json'), 'utf8'));
  assert.strictEqual(s.startDate, today, `startDate=${s.startDate}，期望 ${today}`);
  assert.strictEqual(s.days, 1, `days=${s.days}，期望 1`);
  return `第 ${s.days} 天 · ${s.startDate}`;
});

check('5 负向：缺一项分数必须被拒', () => {
  const bad = { ...goodInput, date: today };
  bad.score = { ...goodInput.score };
  delete bad.score.jie_ji_du;
  const f = writeJson(path.join(TMP, 'bad-missing.json'), bad);
  const r = run(WS, [CLI, '--input', f, '--dry']);
  assert.notStrictEqual(r.status, 0, '缺分数却没被拒 —— 校验失效');
  assert.ok(/MISSING_SCORE/.test(r.stdout + r.stderr), `未见 MISSING_SCORE：${r.stdout}${r.stderr}`);
  return 'MISSING_SCORE 命中';
});

check('6 负向：超长内省必须被拒', () => {
  const bad = { ...goodInput, gong: '长'.repeat(101) };
  const f = writeJson(path.join(TMP, 'bad-long.json'), bad);
  const r = run(WS, [CLI, '--input', f, '--dry']);
  assert.notStrictEqual(r.status, 0, '超长却通过了 —— 上限失效');
  assert.ok(/LONG_INNER/.test(r.stdout + r.stderr), `未见 LONG_INNER：${r.stdout}${r.stderr}`);
  return 'LONG_INNER 命中';
});

const failed = checks.filter((c) => !c.ok);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 清理失败不算数 */ }

console.log(`\n${failed.length ? '❌ 装机自检未通过' : '✅ 装机自检通过'}：${checks.length - failed.length}/${checks.length}`);
if (failed.length) {
  console.log('失败项：');
  failed.forEach((c) => console.log(`  · ${c.name} —— ${c.detail}`));
  console.log('\n把以上输出整段发给若兰，别只发「装好了」。');
}
process.exit(failed.length ? 1 : 0);
