#!/usr/bin/env node
'use strict';
/**
 * excellence-streak.js —— 「拾级而上」累计天数维护
 * 用法：
 *   node scripts/excellence-streak.js --status   只读当前状态
 *   node scripts/excellence-streak.js --mark     把今天记为已打卡（幂等）
 */
const fs = require('fs');
const path = require('path');
// 数据根（2026-11-12 统一）：显式 EXCELLENCE_DATA_ROOT 优先；否则从脚本位置向上探测
// 「同时含 memory/ 与 data/」的 workspace 根。
// 为什么探测而不是写死层数：同一份代码会被放在 skills/excellence-daily/bin/（装机后）
// 和 csb-memory/skills/excellence-daily/bin/（仓库内分发源）两处，层数不同 —— 写死必有一处错。
const DATA_ROOT = (() => {
  if (process.env.EXCELLENCE_DATA_ROOT) return path.resolve(process.env.EXCELLENCE_DATA_ROOT);
  // 仓库根（csb-memory）不是 agent workspace：分发源放在 <repo>/skills/ 下时不能把 repo 当 ws
  const isRepoRoot = (d) => {
    try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name === 'csb-memory'; }
    catch { return false; }
  };
  // ① 装机主场景：<ws>/skills/excellence-daily/{bin,lib}/ → ws = skills 的父目录
  //    （不用「含 memory/」判据：新装 agent 首次自检时 ws 里可能还没有 memory/）
  const segs = __dirname.split(path.sep);
  const iSkills = segs.lastIndexOf('skills');
  let dir;
  if (iSkills > 0) {
    const root = segs.slice(0, iSkills).join(path.sep) || path.sep;
    if (!isRepoRoot(root)) return root;
    dir = root;
  } else {
    dir = __dirname;
  }
  // ② 仓库内运行：csb-memory/{scripts,lib}/ → 向上找同时含 memory/ 与 data/ 的根
  for (let i = 0; i < 6; i++) {
    dir = path.dirname(dir);
    if (fs.existsSync(path.join(dir, 'memory')) && fs.existsSync(path.join(dir, 'data'))) return dir;
  }
  throw new Error('[excellence] 找不到 workspace 根（需同时含 memory/ 与 data/）→ 请显式设置 EXCELLENCE_DATA_ROOT');
})();
// 多租户 slug（2026-11-10）：与 experience.js / excellence-checkin.js 同一口径
const AGENT_SLUG = (() => {
  const raw = process.env.EXCELLENCE_AGENT;
  if (!raw) return '';
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) throw new Error(`[excellence] 非法 EXCELLENCE_AGENT: ${JSON.stringify(raw)}`);
  return s;
})();
const FILE = AGENT_SLUG
  ? path.join(DATA_ROOT, 'memory', 'excellence', AGENT_SLUG, 'streak.json')
  : path.join(DATA_ROOT, 'memory', 'excellence', 'streak.json');

const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

/**
 * 起点日（首次运行时要写进 streak.json 的那个 startDate）。
 *
 * [2026-11-12] 修：原来硬编码 `const START = '2026-11-09'`，那是**若兰自己的**起点。
 *   后果：任何 Agent 装上这个推广包，第一天就会显示「起点 2026-11-09」——
 *   他自己的第 1 天被记成了别人的日期。已落盘的 streak.json 不受影响
 *   （load() 只在文件不存在时才用这个默认值），所以本机无需迁移。
 *   需要显式回溯起点时用 EXCELLENCE_START_DATE；否则默认 = 首次运行当天。
 */
function defaultStartDate() {
  const raw = process.env.EXCELLENCE_START_DATE;
  if (!raw) return localToday();
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`[excellence] 非法 EXCELLENCE_START_DATE: ${JSON.stringify(raw)}（须 YYYY-MM-DD）`);
  }
  return s;
}

function load() {
  if (!fs.existsSync(FILE)) return { startDate: defaultStartDate(), lastDate: null, days: 0, gaps: [] };
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { console.error(`❌ streak.json 损坏：${e.message}`); process.exit(2); }
}

function save(s) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2) + '\n');
}

const args = process.argv.slice(2);
if (args.includes('--status')) {
  const s = load();
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
if (args.includes('--mark')) {
  const s = load();
  const today = localToday();
  if (s.lastDate === today) { console.log(`已记过（${today}，第 ${s.days} 天），幂等跳过`); process.exit(0); }
  // 断档检测：今天与上次之间隔了几天
  if (s.lastDate) {
    const gapDays = Math.round((new Date(today) - new Date(s.lastDate)) / 86400000) - 1;
    if (gapDays > 0) s.gaps.push({ after: s.lastDate, missed: gapDays });
  }
  s.days = (s.days || 0) + 1;
  s.lastDate = today;
  save(s);
  console.log(`✅ 第 ${s.days} 天（${today}）${s.gaps.length ? ` · 累计断档 ${s.gaps.reduce((a, g) => a + g.missed, 0)} 天` : ''}`);
  process.exit(0);
}
console.error('用法：node scripts/excellence-streak.js --status | --mark');
process.exit(2);
