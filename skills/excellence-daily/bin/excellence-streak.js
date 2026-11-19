#!/usr/bin/env node
'use strict';
/**
 * excellence-streak.js —— 「拾级而上」累计天数维护
 * 用法：
 *   node scripts/excellence-streak.js --status              只读当前状态
 *   node scripts/excellence-streak.js --mark [YYYY-MM-DD]   记为已打卡（幂等；默认本机今天）
 *   也可写 --date=YYYY-MM-DD / --date YYYY-MM-DD
 *
 * [2026-11-20 W-64 修] 原实现 `--mark` 恒用本机当天日期，跨零点回填会记错日子，
 *   并凭空写 gaps。现在：
 *     ① 可显式传打卡日期，日期取「输入的打卡日」而非「机器现在几点」；
 *     ② 目标日早于已记最后日 → **不回退**，只提示不写盘（负向护栏）；
 *     ③ 断档只按纯日期差算，且同一 lastDate 不重复记 gap。
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

const isDate = (v) => {
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;  // 2026-13-45 这类要拒
};
/** 取 `--mark` 的目标日期；无参 → null（由调用方回落到本机今天） */
function argDate() {
  const eq = args.find((a) => a.startsWith('--date='));
  if (eq) return eq.slice('--date='.length);
  const di = args.indexOf('--date');
  if (di > -1 && args[di + 1] && !args[di + 1].startsWith('-')) return args[di + 1];
  const mi = args.indexOf('--mark');
  const next = mi > -1 ? args[mi + 1] : null;
  if (next && !next.startsWith('-')) return next;
  return null;
}
const dayDiff = (a, b) =>
  Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

if (args.includes('--status')) {
  const s = load();
  console.log(JSON.stringify(s, null, 2));
  process.exit(0);
}
if (args.includes('--mark')) {
  const s = load();
  const raw = argDate();
  const target = raw ? String(raw).trim() : localToday();
  if (!isDate(target)) {
    console.error(`❌ 日期格式必须 YYYY-MM-DD，收到 ${JSON.stringify(raw)}`);
    process.exit(2);
  }
  if (s.lastDate === target) { console.log(`已记过（${target}，第 ${s.days} 天），幂等跳过`); process.exit(0); }
  // 负向护栏：不许用旧日期把已记的最后日回退（跨零点回填的安全网）
  if (s.lastDate && target < s.lastDate) {
    console.log(`⚠️ 目标日 ${target} 早于已记最后日 ${s.lastDate}：不回退，未写入（确需补录请手工编辑 streak.json）`);
    process.exit(0);
  }
  // 断档检测：目标日与上次之间隔了几天（同 lastDate 不重复记）
  if (s.lastDate) {
    const gapDays = dayDiff(target, s.lastDate) - 1;
    if (gapDays > 0 && !(s.gaps || []).some((g) => g.after === s.lastDate)) {
      s.gaps = s.gaps || [];
      s.gaps.push({ after: s.lastDate, missed: gapDays });
    }
  }
  s.days = (s.days || 0) + 1;
  s.lastDate = target;
  save(s);
  console.log(`✅ 第 ${s.days} 天（${target}）${s.gaps && s.gaps.length ? ` · 累计断档 ${s.gaps.reduce((a, g) => a + g.missed, 0)} 天` : ''}`);
  process.exit(0);
}
console.error('用法：node scripts/excellence-streak.js --status | --mark [YYYY-MM-DD]');
process.exit(2);
