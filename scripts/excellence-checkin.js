#!/usr/bin/env node
'use strict';
/**
 * excellence-checkin.js —— 三个三打卡：唯一写入口（2026-11-09 建立）
 *
 * 设计依据：projects/csb-harness-selfreflection-map/csb-selfreflection-map-v1.md §4.2
 *   「md 由脚本从 EXPERIENCE 渲染，不得手改」—— 两份真相等于没有真相。
 *
 * 职责：
 *   1) 校验六项分数齐全（复用 lib/experience.js 的强制字段 + score 校验）
 *   2) 写入 EXPERIENCE（kind=self_assessment）—— 这是**唯一真相源**
 *   3) 从 EXPERIENCE 重渲染 memory/excellence/YYYY-MM.md（纯导出视图）
 *
 * 用法：
 *   node scripts/excellence-checkin.js --input <json>       从 JSON 文件读入
 *   node scripts/excellence-checkin.js --input <json> --dry 只校验不写
 *   node scripts/excellence-checkin.js --render             只重渲染 md（不写 EXPERIENCE）
 *   node scripts/excellence-checkin.js --list [--month YYYY-MM]
 *
 * JSON 输入格式：
 *   {
 *     "date": "2026-11-09",
 *     "score": { "wen_guo_ze_xi":7, "yi_yi_wei_li":5, "jian_xian_si_qi":8,
 *                "jie_xu_rong":4, "jie_chan":9, "jie_ji_du":9 },
 *     "score_note": { "jie_xu_rong": "打分理由（可选）" },
 *     "gong": "每日一功", "wu": "每日一悟", "shan": "每日一善",
 *     "raw_ids": ["r1"],                    // 当天的记忆条目 id（provenance）
 *     "todo_three": ["1. ...", "2. ..."],   // 今日 3 件
 *     "count_in_streak": true               // 是否计入累计天数（试做=false）
 *   }
 */

const fs = require('fs');
const path = require('path');
const exp = require('../lib/experience');

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
// 多租户 slug（2026-11-10）：不设 → 路径不变；设了 → memory/excellence/<slug>/
const AGENT_SLUG = (() => {
  const raw = process.env.EXCELLENCE_AGENT;
  if (!raw) return '';
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) throw new Error(`[excellence] 非法 EXCELLENCE_AGENT: ${JSON.stringify(raw)}`);
  return s;
})();
const MD_DIR = AGENT_SLUG
  ? path.join(DATA_ROOT, 'memory', 'excellence', AGENT_SLUG)
  : path.join(DATA_ROOT, 'memory', 'excellence');
const STREAK_SCRIPT = path.join(__dirname, 'excellence-streak.js');

const LABELS = {
  wen_guo_ze_xi: '闻过则喜',
  yi_yi_wei_li: '以义为利',
  jian_xian_si_qi: '见贤思齐',
  jie_xu_rong: '戒虚荣',
  jie_chan: '戒谄',
  jie_ji_du: '戒嫉妒',
  jie_yuan_hen: '戒怨恨',   // 旧键（≤2026-11-13 的历史条目仍需渲染）
};
const GROUPS = {
  三精进: ['wen_guo_ze_xi', 'yi_yi_wei_li', 'jian_xian_si_qi'],
  三毒戒: ['jie_xu_rong', 'jie_chan', 'jie_ji_du'],
};
// 2026-11-14 一澜定：戒怨恨 → 戒谄（对应 CSB 迎合度）。哈希链不可改写，
// 故历史条目按原键原标签渲染 —— 两份真相的问题在**记录层**解决，不靠抹掉旧记录。
const GROUPS_LEGACY = {
  三精进: GROUPS['三精进'],
  三毒戒: ['jie_xu_rong', 'jie_yuan_hen', 'jie_ji_du'],
};

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const has = (k) => args.includes(k);

// ── 长度上限（2026-11-10 一澜定：每点 1-2 句）────────────────
// 为什么不靠自觉：光写「请简短」没用。昨天那份单条 300 字，不是话多，是格式没有上限。
const LIMITS = {
  scoreNote: 80,   // 每个打分项附注
  inner: 100,      // 三内省每一项（功/悟/善）
  todoItem: 60,    // 今日 3 件每条
};
const charLen = (s) => [...String(s || '')].length;   // 按字符计，中文一字算一个

/** 检查一条输入是否超长，返回问题列表 */
function checkLengths(input) {
  const errs = [];
  const note = input.score_note || {};
  for (const [k, v] of Object.entries(note)) {
    if (charLen(v) > LIMITS.scoreNote) {
      errs.push(`LONG_SCORE_NOTE:${k}(${charLen(v)}>${LIMITS.scoreNote})`);
    }
  }
  for (const [field, label] of [['gong', '一功'], ['wu', '一悟'], ['shan', '一善']]) {
    if (charLen(input[field]) > LIMITS.inner) {
      errs.push(`LONG_INNER:${label}(${charLen(input[field])}>${LIMITS.inner})`);
    }
  }
  (Array.isArray(input.todo_three) ? input.todo_three : []).forEach((t, i) => {
    if (charLen(t) > LIMITS.todoItem) {
      errs.push(`LONG_TODO:${i + 1}(${charLen(t)}>${LIMITS.todoItem})`);
    }
  });
  return errs;
}

// ── 渲染：EXPERIENCE → md（唯一方向，绝不反向）──────────────
function render() {
  const all = exp.list().filter((e) => e.kind === 'self_assessment');
  const byMonth = {};
  for (const e of all) {
    const d = (e.meta && e.meta.date) || e.ts.slice(0, 10);
    const m = d.slice(0, 7);
    (byMonth[m] = byMonth[m] || []).push({ ...e, _date: d });
  }
  fs.mkdirSync(MD_DIR, { recursive: true });
  let written = 0;
  for (const [month, rows] of Object.entries(byMonth)) {
    rows.sort((a, b) => a._date.localeCompare(b._date));
    const lines = [];
    lines.push(`# 三个三 · 每日打卡（AI 自评线）· ${month}`);
    lines.push('');
    lines.push('> ⚠️ **本文件由 `skills/excellence-daily/bin/excellence-checkin.js --render` 从 EXPERIENCE 自动渲染，请勿手改。**');
    lines.push('> 真相源：`data/experience/*.jsonl`（kind=self_assessment）。手改会在下次渲染时被覆盖并留痕。');
    lines.push('> 格式见 `skills/excellence-daily/SKILL.md` · 历史人类打卡在 `memory/archive/daily_checkin_*.md`（不合并）');
    lines.push('');
    lines.push('---');
    lines.push('');
    for (const r of rows) {
      const s = r.score || {};
      const note = r.meta.score_note || {};
      const dayLabel = r.streak_day ? ` · 第 ${r.streak_day} 天` : '';
      lines.push(`## ${r._date}${dayLabel}${r._trial ? '（试做 · 不计天数）' : ''}`);
      lines.push('');
      const groups = exp.scoreKeysFor(r).includes('jie_chan') ? GROUPS : GROUPS_LEGACY;
      for (const [g, keys] of Object.entries(groups)) {
        lines.push(`**${g} ${g === '三精进' ? '{【核心】满分10分}' : '{【护法】满分10分}'}**`);
        keys.forEach((k, i) => {
          const v = s[k] === undefined ? '—' : s[k];
          lines.push(`${i + 1}、${LABELS[k]} ${v}${note[k] ? ` —— ${note[k]}` : ''}`);
        });
        lines.push('');
      }
      lines.push('**三内省 {日三省【收获】}**');
      lines.push(`1、每日一功（进步）：${r.meta.gong || '—'}`);
      lines.push(`2、每日一悟（智慧）：${r.lesson || '—'}`);
      lines.push(`3、每日一善（善行）：${r.meta.shan || '—'}`);
      lines.push('');
      const todo = r.meta.todo_three || [];
      lines.push(`**今日 3 件（取 TODO.md · ⏳/📝）**`);
      if (!todo.length) lines.push('（当日未取到）');
      todo.forEach((t, i) => lines.push(`${i + 1}. ${t.replace(/^\d+[.、]\s*/, '')}`));
      lines.push('');
      lines.push(`<sub>id=${r.id} · provenance=${JSON.stringify(r.provenance)} · expiry=${JSON.stringify(r.expiry)}</sub>`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }
    const out = path.join(MD_DIR, `${month}.md`);
    const tmp = out + '.tmp';
    fs.writeFileSync(tmp, lines.join('\n'), 'utf8');
    fs.renameSync(tmp, out);
    written++;
  }
  return { written, records: all.length };
}

// ── 写入 ─────────────────────────────────────────────────
function checkin(input) {
  const { date, score, score_note = {}, gong, wu, shan, raw_ids = [], todo_three = [], count_in_streak = true } = input;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    console.error('❌ date 必须是 YYYY-MM-DD');
    process.exit(2);
  }
  // 长度上限（2026-11-10）：超长拒收，不静默截断
  const tooLong = checkLengths(input);
  if (tooLong.length) {
    console.error('❌ 篇幅超限（每点 1-2 句）：');
    tooLong.forEach((e) => console.error(`   - ${e}`));
    process.exit(4);
  }
  // 重复打卡检查（同一天只允许一条）
  const dup = exp.list().find((e) => e.kind === 'self_assessment' && (e.meta && e.meta.date) === date);
  if (dup) {
    console.error(`❌ ${date} 已打卡（id=${dup.id}）。要改就另起一条并说明，不覆盖历史。`);
    process.exit(3);
  }
  let streakDay = null;
  if (count_in_streak) {
    const st = JSON.parse(require('child_process').execSync(`node ${STREAK_SCRIPT} --status`).toString());
    streakDay = (st.days || 0) + 1;
  }
  const entry = {
    scope: 'skill',
    scenario: `每日自评 · ${date}`,
    lesson: wu || '',
    provenance: raw_ids.length
      ? { raw_ids }
      : { source: `memory/${date}.md` },   // 无 raw id 时退到日记文件，但必须显式
    expiry: { kind: 'date', at: addDays(date, 90) },
    side_effects: [],
    confidence: 'medium',
    kind: 'self_assessment',
    score,
    streak_day: streakDay || undefined,
    meta: { date, gong, shan, todo_three, score_note, _trial: !count_in_streak },
  };
  const r = exp.add(entry);
  return r;
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── main ─────────────────────────────────────────────────
if (has('--render')) {
  const r = render();
  console.log(`✅ 渲染 ${r.written} 个月份文件（共 ${r.records} 条自评记录）`);
  process.exit(0);
}
if (has('--list')) {
  const month = arg('--month');
  const rows = exp.list().filter((e) => e.kind === 'self_assessment');
  const out = rows.filter((e) => !month || (e.meta.date || e.ts).startsWith(month));
  console.log(JSON.stringify(out.map((e) => ({ id: e.id, date: e.meta.date, score: e.score, streak_day: e.streak_day })), null, 2));
  process.exit(0);
}
const inputPath = arg('--input');
if (!inputPath) {
  console.error('用法：node scripts/excellence-checkin.js --input <json> [--dry] | --render | --list [--month YYYY-MM]');
  process.exit(2);
}
let payload;
try { payload = JSON.parse(fs.readFileSync(inputPath, 'utf8')); }
catch (e) { console.error(`❌ 读不到输入 JSON：${e.message}`); process.exit(2); }

if (has('--dry')) {
  const probe = { ...payload };
  const entry = {
    scope: 'skill', scenario: `每日自评 · ${probe.date}`, lesson: probe.wu || '',
    provenance: (probe.raw_ids || []).length ? { raw_ids: probe.raw_ids } : { source: `memory/${probe.date}.md` },
    expiry: { kind: 'date', at: addDays(probe.date, 90) }, side_effects: [],
    kind: 'self_assessment', score: probe.score,
  };
  const v = exp.validateEntry(entry);
  if (!v.valid) {
    console.log(`❌ 校验失败：${v.errors.map((e) => e.code).join(', ')}`);
    process.exit(1);
  }
  // 长度上限：--dry 也要拦，否则校验通过、正式入库才被杀
  const tooLong = checkLengths(probe);
  if (tooLong.length) {
    console.log('❌ 篇幅超限（每点 1-2 句）：');
    tooLong.forEach((e) => console.log(`   - ${e}`));
    process.exit(4);
  }
  console.log('✅ 校验通过（未写盘）');
  process.exit(0);
}

try {
  const r = checkin(payload);
  if (payload.count_in_streak !== false) {
    require('child_process').execSync(`node ${STREAK_SCRIPT} --mark ${payload.date}`, { stdio: 'inherit' });
  }
  render();
  console.log(`✅ 打卡已入库 id=${r.record.id} · 已渲染 md`);
} catch (e) {
  console.error(`❌ ${e.message}`);
  if (e.details) e.details.forEach((d) => console.error(`   - ${d.code}: ${d.msg || d.message}`));
  process.exit(1);
}
