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
 *   7) 负向：装错位置必须报错（非 0 退出）—— 旧版会静默读到**别人**的数据
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

// [2026-11-12 17:2x 修 · 阿契（aqi）实测报告]
//   selfcheck 原来写死「无 slug」路径：设了 EXCELLENCE_AGENT 后
//   运行时数据落到 <slug>/ 下，而自检还去原路径找 → **照说明书做的人永远 5/7**。
//   实测：`EXCELLENCE_AGENT=aqi5` → 5/7（缺 data/experience/2026-11.jsonl 与 streak.json）。
//   现在跟随同一个 slug（与 experience.js / excellence-checkin.js 同一口径）。
const SLUG = (() => {
  const raw = process.env.EXCELLENCE_AGENT;
  if (!raw) return '';
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) {
    throw new Error(`[selfcheck] 非法 EXCELLENCE_AGENT: ${JSON.stringify(raw)}（仅允许 [A-Za-z0-9_-]{1,32}）`);
  }
  return s;
})();
const EXP_BASE = SLUG ? path.join(WS, 'data', 'experience', SLUG) : path.join(WS, 'data', 'experience');
const MD_BASE = SLUG ? path.join(WS, 'memory', 'excellence', SLUG) : path.join(WS, 'memory', 'excellence');

const goodInput = {
  date: today,
  count_in_streak: true,
  score: { wen_guo_ze_xi: 7, yi_yi_wei_li: 5, jian_xian_si_qi: 8, jie_xu_rong: 4, jie_chan: 9, jie_ji_du: 9 },
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
    path.join(EXP_BASE, `${ym}.jsonl`),
    path.join(MD_BASE, `${ym}.md`),
    path.join(MD_BASE, 'streak.json'),
  ];
  for (const p of arts) assert.ok(fs.existsSync(p), `缺产物：${path.relative(WS, p)}`);
  const lines = fs.readFileSync(arts[0], 'utf8').trim().split('\n').filter(Boolean);
  assert.ok(lines.length >= 1, 'EXPERIENCE 是空的');
  JSON.parse(lines[0]); // 必须是合法 JSON
  return `${path.relative(WS, arts[0])} / ${path.relative(WS, arts[1])} / streak.json`;
});

check('4 streak.startDate == 今天（不是别人的起点）', () => {
  const s = JSON.parse(fs.readFileSync(path.join(MD_BASE, 'streak.json'), 'utf8'));
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

// [2026-11-12 15:2x] 模拟装机踩出的真 bug 回归锁：
//   上一版「任意位置向上探 6 级」会让装错位置的 agent 静默读到**别人**的数据，且不报错。
//   这条负向断言要求：非 <ws>/skills/excellence-daily/ 布局 → 必须非 0 退出。
check('7 负向：装错位置必须报错（不许读到别人的数据）', () => {
  const wrong = path.join(TMP, 'elsewhere');
  fs.mkdirSync(wrong, { recursive: true });
  fs.cpSync(path.join(WS, 'skills', 'excellence-daily'), path.join(wrong, 'excellence-daily'), { recursive: true });
  const r = run(TMP, [path.join(wrong, 'excellence-daily', 'bin', 'excellence-streak.js'), '--status']);
  assert.notStrictEqual(r.status, 0, '装错位置却没报错 —— 会静默读到别人的数据');
  assert.ok(/位置不对|EXCELLENCE_DATA_ROOT/.test(r.stdout + r.stderr), `未见位置错误提示：${r.stdout}${r.stderr}`);
  return '非标准布局被拒';
});

// [2026-11-12 17:2x] 阿契（aqi）实测报告的真 bug 回归锁：
//   设了 EXCELLENCE_AGENT 后运行时数据落到 <slug>/，而旧的 check 3/4 还去无 slug 路径找
//   → 照说明书做的人永远 5/7。这条断言不依赖外层 env：内置起一个子进程显式带 slug，
//   并要求数据确实落在 <slug>/ 下（否则同一个 bug 会以另一种形式复发）。
check('8 设了 EXCELLENCE_AGENT 时数据必须落到 <slug>/（不是无 slug 路径）', () => {
  const slug = 'selfcheck_probe';
  const ws2 = path.join(TMP, 'ws-slug');
  fs.mkdirSync(path.join(ws2, 'skills'), { recursive: true });
  fs.cpSync(path.join(WS, 'skills', 'excellence-daily'), path.join(ws2, 'skills', 'excellence-daily'), { recursive: true });
  const r = run(ws2, [CLI, '--input', writeJson(path.join(TMP, 'slug.json'), { ...goodInput, date: today })], { EXCELLENCE_AGENT: slug });
  assert.strictEqual(r.status, 0, `带 slug 入库失败 exit=${r.status}\n${r.stdout}${r.stderr}`);
  const ym = today.slice(0, 7);
  assert.ok(fs.existsSync(path.join(ws2, 'data', 'experience', slug, `${ym}.jsonl`)), '数据没落到 <slug>/ 下的 experience');
  assert.ok(fs.existsSync(path.join(ws2, 'memory', 'excellence', slug, 'streak.json')), 'streak.json 没落到 <slug>/ 下');
  assert.ok(!fs.existsSync(path.join(ws2, 'data', 'experience', `${ym}.jsonl`)), '无 slug 路径也被写了 —— 隔离失效');
  return `<slug>/ 分目录正确（${slug}）`;
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
