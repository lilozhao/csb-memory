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
// [2026-11-12 15:2x 修 · 模拟装机踩出的真 bug]
//   上一版「任意位置都向上探 6 级找 memory/+data/」：skill 装错位置时（如
//   <ws>/elsewhere/excellence-daily/）会一路探到别人的 workspace，**静默读到对方数据且不报错**，
//   一旦写入就直接污染对方生产记录。现在改为：
//     ① 路径必须是 <root>/skills/excellence-daily/{bin,lib} 这个布局，root 才可能是 ws
//     ② root 若是仓库根（package.json.name==='csb-memory'）→ 说明是仓库内自测，继续向上找
//     ③ root 若是隐藏目录（如 ~/.agents）→ 不认，要求显式指定
//     ④ 其他任何情况 → **直接报错退出**，绝不猜
const DATA_ROOT = (() => {
  if (process.env.EXCELLENCE_DATA_ROOT) {
    const r = path.resolve(process.env.EXCELLENCE_DATA_ROOT);
    if (!fs.existsSync(r)) throw new Error('[excellence] EXCELLENCE_DATA_ROOT 不存在: ' + r);
    return r;
  }
  const isRepoRoot = (d) => {
    try { return JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).name === 'csb-memory'; }
    catch { return false; }
  };
  const segs = __dirname.split(path.sep);
  const iSkills = segs.lastIndexOf('skills');
  // 布局 A：<root>/skills/excellence-daily/{bin,lib} ← 装机后
  const layoutA = iSkills > 0 && segs[iSkills + 1] === 'excellence-daily';
  // 布局 B：<repo>/{scripts,lib} 且 <repo> 是 csb-memory ← 仓库运行版
  const layoutB = !layoutA && isRepoRoot(path.join(__dirname, '..'));

  let base;
  if (layoutA) {
    const root = segs.slice(0, iSkills).join(path.sep) || path.sep;
    if (!isRepoRoot(root)) {
      if (path.basename(root).startsWith('.')) {
        throw new Error(
          '[excellence] 数据根解析到隐藏目录 ' + root + '，不像 workspace。\n' +
          '  请显式设置 EXCELLENCE_DATA_ROOT=<你的 workspace 根>'
        );
      }
      return root;   // ← 装机主场景，直接就是 ws
    }
    base = root;     // 仓库内的技能包副本 → 继续向上找 ws
  } else if (layoutB) {
    base = path.join(__dirname, '..');   // 仓库根 → 向上找 ws
  } else {
    throw new Error(
      '[excellence] 技能目录位置不对：应装在 <ws>/skills/excellence-daily/，' +
      '当前在 ' + __dirname + '。\n' +
      '  两种办法：① 把整个 excellence-daily/ 移到 <ws>/skills/ 下；' +
      '② 或显式设置 EXCELLENCE_DATA_ROOT=<你的 workspace 根>'
    );
  }

  // 仓库内运行时：向上找同时含 memory/ 与 data/ 的 workspace 根
  let dir = base;
  for (let i = 0; i < 4; i++) {
    dir = path.dirname(dir);
    if (fs.existsSync(path.join(dir, 'memory')) && fs.existsSync(path.join(dir, 'data'))) return dir;
  }
  throw new Error(
    '[excellence] 在仓库内运行但找不到上层 workspace（需含 memory/ 与 data/）。\n' +
    '  请显式设置 EXCELLENCE_DATA_ROOT=<你的 workspace 根>'
  );
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
