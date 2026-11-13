#!/usr/bin/env node
'use strict';
/**
 * todo-three.js —— 今日 3 件：唯一取数/记账入口
 *
 * 定位：这是「计划」侧的 skill。与「三个三」（自评侧）**分开存放、只做交叉引用**。
 *   计划 → TODO.md（真相源）
 *   实际 → memory/<date>.md
 *   自评 → data/experience/*.jsonl（kind=self_assessment，excellence-daily 管）
 * 本脚本只碰前两样 + 一份轻量的「取件快照」，**不写自评、不碰分数**。
 *
 * 用法：
 *   node bin/todo-three.js --pick              从 TODO.md 机械取今日 3 件（打印 + 存快照）
 *   node bin/todo-three.js --pick --dry        只打印，不存快照
 *   node bin/todo-three.js --show [--date D]   看某天的计划与完成情况
 *   node bin/todo-three.js --mark-done <#n>    标记第 n 件完成
 *   node bin/todo-three.js --mark-miss <#n> --reason "…"   标记未完成并写原因
 *
 * 取数判据（一澜 2026-10-27 定 · 机械可核，不许放宽）：
 *   status 列以 **⏳ 进行中** 或 **📝 待推进** 开口的行才可取。
 *   「开口」不等于「紧邻」——emoji 与词之间夹 `**` 照算（见 statusKind）。
 *   ⚠️ 隐患登记区 + ✅ 近期闭环区 **永不取**。无标记 = 不取。不足 3 条就报几条，不硬凑。
 *
 * 用法约束（为什么不在 skill 里也不要别的脚本碰）：
 *   两份真相等于没有真相。今日 3 件只由本脚本写入 store/<YYYY-MM>.json。
 */

const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.join(__dirname, '..');
const DATA_ROOT = process.env.TODO_DATA_ROOT || path.join(SKILL_DIR, '..', '..');
const TODO_MD = path.join(DATA_ROOT, 'TODO.md');
// 多租户 slug（2026-11-10）：与 excellence-daily 同一口径
//   不设 TODO_AGENT → data/todo-three/YYYY-MM.json（向后兼容）
//   设了 → data/todo-three/<slug>/YYYY-MM.json
const AGENT_SLUG = (() => {
  const raw = process.env.TODO_AGENT;
  if (!raw) return '';
  const s = String(raw).trim();
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(s)) throw new Error(`[todo-daily] 非法 TODO_AGENT: ${JSON.stringify(raw)}`);
  return s;
})();
const STORE_DIR = AGENT_SLUG
  ? path.join(DATA_ROOT, 'data', 'todo-three', AGENT_SLUG)
  : path.join(DATA_ROOT, 'data', 'todo-three');
const MAX = 3;

const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const localToday = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString().slice(0, 10);

// ── 解析 TODO.md ────────────────────────────────────────────
// 永不取的区域（按 ## 标题识别）
const FORBIDDEN_SECTIONS = [/隐患登记/, /近期闭环/];

/**
 * 按 `|` 切表格行，但**跳过反引号内的竖线**。
 *
 * [2026-11-12] 为什么：TODO.md 里写 `skills/excellence-daily/bin|lib` 这种裸竖线时，
 *   朴素 split('|') 会把一个单元格劈成两个 → 列整体右移 → status 取到判据列。
 *   今日的 W-58 就是这条（W-34/W-59 因无裸竖线而未受影响）。
 */
function splitRow(line) {
  const cells = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '`') { inCode = !inCode; cur += ch; continue; }
    if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * 判据只看 status 的**语义前缀**，不看 Markdown 修饰。
 *
 * [2026-11-12] 为什么：`📝 **待推进 · …**` 里 `📝` 与 `待推进` 之间夹了 `**`，
 *   原正则为 `/^(⏳ 进行中|📝 待推进)/` 要求两者紧邻 → 不匹配 → 静默跳过。
 *   这是 W-58 漏取的**真正主因**（裸竖线是第二重隐患，独立存在）。
 *   修法：剥掉 `**`（成对加粗）与零宽字符后再匹配；不剥其它符号，判据不放宽。
 */
function statusKind(status) {
  const s = String(status || '').replace(/\*\*/g, '').replace(/\u200b/g, '').trim();
  if (/^⏳ 进行中/.test(s)) return 'doing';
  if (/^📝 待推进/.test(s)) return 'pending';
  return null;
}

// 可取数区域的行：表格行，第 4 列（status）以 ⏳ 进行中 / 📝 待推进 开头
function pickFromTodo(text, limit = MAX) {
  const lines = text.split('\n');
  const out = [];
  let section = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = line.match(/^##\s+(.*)$/);
    if (h) { section = h[1]; continue; }
    if (FORBIDDEN_SECTIONS.some((re) => re.test(section))) continue;
    if (!line.trim().startsWith('|')) continue;

    const cells = splitRow(line);
    // 形如 ['', '#', '事项', '状态', '判据', '起', ''] —— 至少 5 段
    if (cells.length < 5) continue;
    const id = cells[1];
    const title = cells[2];
    const status = cells[3];
    if (!id || /^[-:]+$/.test(id) || /^#+$/.test(id)) continue; // 表头/分隔行
    if (!statusKind(status)) continue;

    out.push({
      id,
      // [2026-11-13] 带上原行号与所属区名：诊断时不用靠标题/status 内容回溯，
      //   也避免测试里再写一份「找原行」的取巧逻辑（那份逻辑自己会坏）。
      lineNo: i + 1,
      section: section.trim(),
      title: title.replace(/\*\*/g, '').slice(0, 90),
      status: status.replace(/\*\*/g, '').slice(0, 60),
    });
    if (out.length >= limit) break;
  }
  return out;
}

// ── 快照存储（按月分片，append 语义：一天一条）────────────
function storePath(date) { return path.join(STORE_DIR, `${date.slice(0, 7)}.json`); }

function loadStore(date) {
  const p = storePath(date);
  if (!fs.existsSync(p)) return [];
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`❌ 快照损坏：${p} —— ${e.message}`); process.exit(2); }
}

function saveStore(date, rows) {
  fs.mkdirSync(STORE_DIR, { recursive: true });
  const p = storePath(date);
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

function upsert(date, entry) {
  const rows = loadStore(date);
  const i = rows.findIndex((r) => r.date === date);
  if (i >= 0) rows[i] = entry; else rows.push(entry);
  rows.sort((a, b) => a.date.localeCompare(b.date));
  saveStore(date, rows);
}

// ── 命令 ───────────────────────────────────────────────────
function cmdPick(dry) {
  if (!fs.existsSync(TODO_MD)) { console.error(`❌ 找不到 ${TODO_MD}`); process.exit(2); }
  const date = localToday();
  const picked = pickFromTodo(fs.readFileSync(TODO_MD, 'utf8'));

  console.log(`📋 今日 3 件 · ${date}`);
  if (picked.length === 0) {
    console.log('⚠️ 没有符合取数判据的条目（status 须以 ⏳ 进行中 / 📝 待推进 开头）。不硬凑。');
  } else {
    picked.forEach((p, i) => console.log(`  ${i + 1}. [${p.id}] ${p.title}`));
    if (picked.length < MAX) console.log(`  （不足 ${MAX} 条，报 ${picked.length} 条，不硬凑）`);
  }

  if (dry) { console.log('🧪 --dry：不写快照'); return; }

  const existing = loadStore(date).find((r) => r.date === date);
  if (existing) {
    console.log('ℹ️ 今天已有快照，保留原有 pick（不覆盖）—— 要改先看 --show');
    return;
  }
  upsert(date, {
    date,
    pickedAt: new Date().toISOString(),
    items: picked.map((p) => ({ ...p, done: null, missReason: null })),
  });
  console.log(`✅ 快照已存 ${path.relative(DATA_ROOT, storePath(date))}`);
}

function cmdShow(date) {
  const d = date || localToday();
  const row = loadStore(d).find((r) => r.date === d);
  if (!row) { console.log(`（${d} 无快照）`); return; }
  console.log(`📋 ${d} · 取件于 ${row.pickedAt}`);
  row.items.forEach((it, i) => {
    const mark = it.done === true ? '✅' : it.done === false ? '❌' : '⬜';
    console.log(`  ${mark} ${i + 1}. [${it.id}] ${it.title}`);
    if (it.missReason) console.log(`      未成原因：${it.missReason}`);
  });
  const done = row.items.filter((i) => i.done === true).length;
  console.log(`\n  完成 ${done}/${row.items.length}`);
}

function cmdMark(kind) {
  const n = Number(arg(kind === 'done' ? '--mark-done' : '--mark-miss'));
  const reason = arg('--reason');
  const date = arg('--date') || localToday();
  if (!Number.isInteger(n) || n < 1) { console.error('❌ 需要序号，例如 --mark-done 2'); process.exit(2); }
  if (kind === 'miss' && !reason) { console.error('❌ --mark-miss 必须带 --reason（未成原因，不许留空）'); process.exit(2); }

  const rows = loadStore(date);
  const row = rows.find((r) => r.date === date);
  if (!row) { console.error(`❌ ${date} 无快照，先跑 --pick`); process.exit(3); }
  if (!row.items[n - 1]) { console.error(`❌ ${date} 只有 ${row.items.length} 件`); process.exit(2); }

  row.items[n - 1].done = kind === 'done';
  if (kind === 'miss') row.items[n - 1].missReason = reason;
  saveStore(date, rows);
  console.log(`✅ 已记：第 ${n} 件 = ${kind === 'done' ? '完成' : '未完成'}`);
}

// 供单测 require（不触发 CLI 副作用）
module.exports = { pickFromTodo, splitRow, statusKind };

if (require.main === module) {
  if (has('--pick')) { cmdPick(has('--dry')); }
  else if (has('--show')) { cmdShow(arg('--date')); }
  else if (has('--mark-done')) { cmdMark('done'); }
  else if (has('--mark-miss')) { cmdMark('miss'); }
  else {
    console.error('用法：--pick [--dry] | --show [--date D] | --mark-done <n> | --mark-miss <n> --reason "…"');
    process.exit(2);
  }
}
