#!/usr/bin/env node
/**
 * health-check.js — 🌡️ 记忆系统健康巡检
 *
 * 归属：csb-memory 仓库（2026-08-20 创建，一澜提议）
 * 协议依据：MEM-013 记忆入口规范 + 记忆系统运维
 *
 * 每天定时检查五件事：
 *   ① 数据量    — 档案总条数、今日新增 vs 昨日（连续 2 天零新增 = 异常）
 *   ② 入口完整性 — 日记事件/学习心得/社区摘要 今日是否入库（某入口连续断流 = 异常）
 *   ③ RAW 底仓  — 流水数、burning 堆积（burning 占比过高且增长 = dream 可能挂了）
 *   ④ 蒸馏      — dream 今日产出、封口率（0 产出 = 异常）
 *   ⑤ 备份      — backup.log 今日记录（没备份 = 异常）
 *
 * 输出逻辑（与待办追踪一致）：
 *   ✅ 一切正常 → NO_REPLY（静默）
 *   ⚠️ 发现异常 → 输出具体报告（哪个环节断了）
 *
 * 用法：
 *   node scripts/health-check.js            # 默认检查昨天（23:30 后跑，检查今天）
 *   node scripts/health-check.js 2026-08-20 # 指定日期
 *   node scripts/health-check.js --verbose  # 总是输出完整报告（调试用）
 */

const fs = require('fs');
const path = require('path');
const core = require('../lib/core/memory');

const WORKSPACE = path.join(__dirname, '..', '..');
const MEMORY_DIR = path.join(WORKSPACE, 'memory');
const RAW_DIR = path.join(__dirname, '..', 'data', 'raw');
const BACKUP_LOG = path.join(MEMORY_DIR, 'backup.log');
// agent 可配置（--agent 参数或环境变量），默认若兰
function resolveAgent(args) {
  const idx = args.indexOf('--agent');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return process.env.CSB_MEMORY_AGENT || '若兰';
}
const AGENT = resolveAgent(process.argv.slice(2));

// ---------- 工具 ----------
function todayStr() {
  return new Date().toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
}

function parseDate(d) {
  return d.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return parseDate(d);
}

// 相对某日期前 n 天（用于对比检查日期而非今天）
function dateBefore(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - n);
  return dt.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
}

// ---------- ① 数据量 ----------
function checkVolume(checkDate, prevDate) {
  const entries = core.get(AGENT);
  const total = entries.length;
  // 按 day: 标签统计每日新增（daily-sync + dream 的 day 标签）
  const dayCount = {};
  for (const e of entries) {
    const tag = (e.tags || []).find((t) => t.startsWith('day:'));
    if (tag) dayCount[tag.slice(4)] = (dayCount[tag.slice(4)] || 0) + 1;
  }
  const today = dayCount[checkDate] || 0;
  const prev = dayCount[prevDate] || 0;
  return {
    ok: today > 0 || prev > 0, // 至少一天有新增（今天还没到同步时间也正常）
    total, today, prev,
    detail: `档案共 ${total} 条 | ${checkDate} 新增 ${today} 条 | ${prevDate} 新增 ${prev} 条`,
  };
}

// ---------- ② 入口完整性 ----------
function checkEntries(checkDate) {
  const entries = core.get(AGENT);
  const dayEntries = entries.filter((e) =>
    (e.tags || []).includes(`day:${checkDate}`) && e.source === 'daily-sync'
  );
  const sources = {
    diary: dayEntries.filter((e) => e.type !== 'lesson' && e.type !== 'community').length,
    lesson: dayEntries.filter((e) => e.type === 'lesson').length,
    community: dayEntries.filter((e) => e.type === 'community').length,
  };
  // 昨天（用于对比断流）
  const prevDate = dateBefore(checkDate, 1);
  const prevEntries = entries.filter((e) =>
    (e.tags || []).includes(`day:${prevDate}`) && e.source === 'daily-sync'
  );
  const prevSources = {
    diary: prevEntries.filter((e) => e.type !== 'lesson' && e.type !== 'community').length,
    lesson: prevEntries.filter((e) => e.type === 'lesson').length,
    community: prevEntries.filter((e) => e.type === 'community').length,
  };
  // 日记入口断流判定：昨天有今天无，且今天日记文件存在但没同步
  const diaryFile = path.join(MEMORY_DIR, `${checkDate}.md`);
  const diaryExists = fs.existsSync(diaryFile);
  const issues = [];
  if (diaryExists && sources.diary === 0 && prevSources.diary > 0) {
    issues.push('日记事件入口断流（今天日记文件存在但无入库记录）');
  }
  if (prevSources.lesson > 0 && sources.lesson === 0) {
    issues.push('学习心得入口断流（昨天有今天无）');
  }
  if (prevSources.community > 0 && sources.community === 0) {
    issues.push('社区摘要入口断流（昨天有今天无）');
  }
  return {
    ok: issues.length === 0,
    sources, issues,
    detail: `日记 ${sources.diary} | 学习 ${sources.lesson} | 社区 ${sources.community}`,
  };
}

// ---------- ③ RAW 底仓 ----------
function checkRaw() {
  if (!fs.existsSync(RAW_DIR)) {
    return { ok: false, detail: 'RAW 底仓目录不存在！', issues: ['RAW 目录缺失'] };
  }
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.jsonl'));
  let total = 0, sealed = 0, burning = 0;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(RAW_DIR, f), 'utf8').split('\n').filter(Boolean);
    total += lines.length;
    for (const l of lines) {
      try {
        const r = JSON.parse(l);
        if (r.state === 'sealed') sealed++;
        else if (r.state === 'burning') burning++;
      } catch (e) { /* 跳过坏行 */ }
    }
  }
  const burnRatio = total > 0 ? burning / total : 0;
  const issues = [];
  if (total === 0) issues.push('RAW 底仓为空（流水从未写入）');
  if (burnRatio > 0.8 && total > 20) {
    issues.push(`RAW burning 占比过高（${(burnRatio * 100).toFixed(0)}%）— dream 蒸馏可能未运行`);
  }
  return {
    ok: issues.length === 0,
    total, sealed, burning, issues,
    detail: `RAW 共 ${total} 条 | 封口 ${sealed} | 燃烧中 ${burning}（${(burnRatio * 100).toFixed(0)}%）`,
  };
}

// ---------- ④ 蒸馏 ----------
function checkDream(checkDate) {
  const entries = core.get(AGENT);
  const dreamToday = entries.filter((e) =>
    e.source === 'dream' && (e.tags || []).includes(`day:${checkDate}`)
  ).length;
  const prevDate = dateBefore(checkDate, 1);
  const dreamPrev = entries.filter((e) =>
    e.source === 'dream' && (e.tags || []).includes(`day:${prevDate}`)
  ).length;
  // dream 的 day 标签可能不存在（dream.js 用 day: 标签），fallback：检查 source=dream 的时间戳
  const issues = [];
  // dream 断流判定：昨天有产出今天没有（且今天 RAW 有新增流水）
  if (dreamPrev > 0 && dreamToday === 0) {
    issues.push(`dream 蒸馏今日无产出（昨日 ${dreamPrev} 条）`);
  }
  return {
    ok: issues.length === 0,
    today: dreamToday, prev: dreamPrev, issues,
    detail: `dream 今日 ${dreamToday} 条 | 昨日 ${dreamPrev} 条`,
  };
}

// ---------- ⑤ 备份 ----------
function checkBackup(checkDate) {
  if (!fs.existsSync(BACKUP_LOG)) {
    return { ok: false, detail: 'backup.log 不存在', issues: ['备份日志缺失'] };
  }
  const log = fs.readFileSync(BACKUP_LOG, 'utf-8');
  const dateCompact = checkDate.replace(/-/g, '');
  const prevDate = dateBefore(checkDate, 1);
  const prevCompact = prevDate.replace(/-/g, '');
  const hasToday = log.includes(`[${dateCompact}_`);
  const hasPrev = log.includes(`[${prevCompact}_`);
  const issues = [];
  if (!hasToday && hasPrev) {
    issues.push(`${checkDate} 备份未执行（${prevDate} 有）`);
  }
  if (!hasPrev && !hasToday) {
    issues.push('备份日志无近期记录');
  }
  return {
    ok: issues.length === 0,
    hasToday, issues,
    detail: `${checkDate} 备份 ${hasToday ? '✅' : '❌'} | ${prevDate} ${hasPrev ? '✅' : '❌'}`,
  };
}

// ---------- 主流程 ----------
function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes('--verbose');
  // 检查日期：默认昨天（昨天 23:30 的任务已跑完，数据完整）；指定日期用于回查
  // 今天的数据要等今天 23:30 同步/23:50 蒸馏/23:30 备份完成后才完整
  const checkDate = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || daysAgo(1);
  const prevDate = dateBefore(checkDate, 1);

  const results = {
    volume: checkVolume(checkDate, prevDate),
    entries: checkEntries(checkDate),
    raw: checkRaw(),
    dream: checkDream(checkDate),
    backup: checkBackup(checkDate),
  };

  const issues = [];
  for (const [key, r] of Object.entries(results)) {
    if (!r.ok) issues.push(...(r.issues || [`${key} 异常`]));
  }

  if (issues.length === 0 && !verbose) {
    console.log('NO_REPLY');
    return;
  }

  // 输出报告
  console.log(`🌡️ 记忆系统健康巡检 · ${checkDate}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  const icons = { volume: '📊 数据量', entries: '🚪 入口', raw: '🗄️ RAW', dream: '🌙 蒸馏', backup: '💾 备份' };
  for (const [key, r] of Object.entries(results)) {
    console.log(`${r.ok ? '✅' : '⚠️'} ${icons[key]}: ${r.detail}`);
  }
  if (issues.length > 0) {
    console.log('\n🚨 异常项:');
    for (const i of issues) console.log(`  - ${i}`);
  } else {
    console.log('\n🎉 全部正常');
  }
}

main();
