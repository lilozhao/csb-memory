#!/usr/bin/env node
'use strict';
/**
 * selfcheck.js —— 今日 3 件 · 装机自检（2026-11-13 加）
 *
 * 为什么要有它：装技能的人不该靠「看文档猜自己装对了没」。
 *   这个脚本在**临时目录**里完整跑一遍装机流程，产出可核对的机械判据，
 *   全程不碰生产数据（不读也不写你的 TODO.md / 快照）。
 *
 * 用法：
 *   node bin/selfcheck.js
 *
 * 判据（任一不过即 exit 1）：
 *   1) 独立副本能在临时 workspace 里跑（不依赖原目录）
 *   2) `--dry` 不写快照（测的是「说只打印就只打印」）
 *   3) 正式 `--pick` 产出 <root>/data/todo-three/<YYYY-MM>.json，且**逐字段可核**
 *   4) 快照里每条 status 都能过 statusKind（不得把无标记行记成计划）
 *   5) 文档与代码同口径：SKILL.md 必须写明「允许 `**` 加粗」（11-13 修的文档滞后）
 *   6) 负向：`--mark-miss` 不带 `--reason` 必须拒（exit 2）
 *   7) 负向：没有符合判据的条目时**不硬凑**（快照里 items 为空，不是编 3 条）
 *   8) 负向：找不到 TODO.md 必须报错退出（exit 2），不凭记忆编
 *   9) 设了 TODO_AGENT → 数据必须落 `<slug>/`；且**反向断言**：无 slug 路径不得被写
 *  10) 负向：非法 TODO_AGENT 必须拒绝启动
 *
 * 为什么第 5 条要在这：v1.7.2 修过「SKILL.md 与实现不一致，越照说明书做越失败」。
 *   这不是一次性的修，是一条**会复发的**错误类型 —— 所以做成自检项。
 *   它检查的是文字，会显得不「机械」，但判的是一个客观串是否出现，不是语义。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SKILL_DIR = path.join(__dirname, '..');
const CLI = path.join('skills', 'todo-daily', 'bin', 'todo-three.js');
const assert = require('assert');

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

/** 造一份最小可用的 TODO.md（含一个可取行 + 一个隐患区行作为负向对照） */
function writeTodo(root, { pickable = true } = {}) {
  const rows = [
    '| # | 事项 | 状态 | 判据 | 起 |',
    '|---|---|---|---|---|',
    pickable
      ? '| T-1 | 自检用条目 | 📝 **待推进 · 自检** | 判据 | 11-13 |'
      : '| T-1 | 已收官条目 | ✅ 11-13 关闭 | 判据 | 11-13 |',
    '',
    '## ⚠️ 隐患登记（自检用）',
    '',
    '| # | 事项 | 状态 | 判据 | 起 |',
    '|---|---|---|---|---|',
    '| W-X | 隐患行不该被取 | ⏳ 进行中 | 判据 | 11-13 |',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(root, 'TODO.md'), rows, 'utf8');
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-daily-selfcheck-'));
const WS = path.join(TMP, 'ws');
const today = localToday();
const storeRel = path.join('data', 'todo-three', `${today.slice(0, 7)}.json`);

// 装一份独立副本：证明这个 skill 不依赖「它正好住在若兰的 workspace 里」
copyDir(SKILL_DIR, path.join(WS, 'skills', 'todo-daily'));
writeTodo(WS);

console.log('今日 3 件 · 装机自检');
console.log(`  临时目录：${TMP}`);
console.log('');

// ── 1 独立副本可跑 ────────────────────────────────────────
check('1 独立副本能在临时 workspace 里跑（不依赖原目录）', () => {
  const r = run(WS, [CLI, '--pick', '--dry']);
  assert.strictEqual(r.status, 0, `exit ${r.status}：${r.stderr || r.stdout}`);
  assert.ok(/今日 3 件/.test(r.stdout), '未见输出头');
  return 'exit 0';
});

// ── 2 --dry 不写快照 ─────────────────────────────────────
check('2 `--dry` 不写快照（说只打印就只打印）', () => {
  const p = path.join(WS, storeRel);
  assert.ok(!fs.existsSync(p), `--dry 之后不该有 ${storeRel}`);
  return '无快照';
});

// ── 3 正式 pick 产出三件 ─────────────────────────────────
check('3 正式 `--pick` 产出 data/todo-three/<YYYY-MM>.json', () => {
  const r = run(WS, [CLI, '--pick']);
  assert.strictEqual(r.status, 0, `exit ${r.status}：${r.stderr || r.stdout}`);
  const p = path.join(WS, storeRel);
  assert.ok(fs.existsSync(p), `没生成 ${storeRel}`);
  const rows = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.ok(Array.isArray(rows) && rows.length === 1, '快照应为一个月一份数组，含当天一条');
  const row = rows[0];
  assert.strictEqual(row.date, today, `date 应该是今天 ${today}，实际 ${row.date}`);
  assert.ok(row.pickedAt, '缺 pickedAt');
  assert.ok(Array.isArray(row.items) && row.items.length === 1, `items 应有 1 条，实际 ${row.items && row.items.length}`);
  assert.strictEqual(row.items[0].id, 'T-1');
  assert.strictEqual(row.items[0].done, null, '新取的条目 done 应为 null（未表态）');
  return `1 条 · ${row.items[0].id}`;
});

// ── 4 快照里的 status 都过判据 ────────────────────────────
check('4 快照里每条 status 都能过 statusKind（不混进无标记行）', () => {
  const { statusKind } = require(path.join(WS, 'skills', 'todo-daily', 'bin', 'todo-three.js'));
  const rows = JSON.parse(fs.readFileSync(path.join(WS, storeRel), 'utf8'));
  for (const it of rows[0].items) {
    assert.ok(statusKind(it.status), `进了快照但判据不过：${it.id} ${JSON.stringify(it.status)}`);
  }
  return `${rows[0].items.length}/${rows[0].items.length}`;
});

// ── 5 文档与代码同口径 ───────────────────────────────────
check('5 SKILL.md 写明「允许 `**` 加粗」（防 v1.7.2 那类文档滞后复发）', () => {
  const md = fs.readFileSync(path.join(WS, 'skills', 'todo-daily', 'SKILL.md'), 'utf8');
  // 判的是「是否出现了这个约定」，不是语义理解：两个必备串都在即通过
  assert.ok(/开口/.test(md), 'SKILL.md 未使用「开口」这一精确措辞（旧的「开头」会被读成紧邻）');
  assert.ok(/\*\*/.test(md) && /加粗/.test(md), 'SKILL.md 未写明加粗 `**` 照算');
  return '口径一致';
});

// ── 6 负向：mark-miss 无 reason ──────────────────────────
check('6 负向：`--mark-miss` 不带 `--reason` 必须拒（exit 2）', () => {
  const r = run(WS, [CLI, '--mark-miss', '1']);
  assert.strictEqual(r.status, 2, `期望 exit 2，实际 ${r.status}：${r.stdout}`);
  assert.ok(/必须带 --reason/.test(r.stderr + r.stdout), '未见拒绝原因');
  // 零写入：done 仍为 null
  const rows = JSON.parse(fs.readFileSync(path.join(WS, storeRel), 'utf8'));
  assert.strictEqual(rows[0].items[0].done, null, '被拒的调用不该改数据');
  return 'exit 2 · 零写入';
});

// ── 7 负向：无符合条目时不硬凑 ───────────────────────────
check('7 负向：没有符合判据的条目 → 不硬凑（items 为空）', () => {
  const WS2 = path.join(TMP, 'ws-empty');
  copyDir(SKILL_DIR, path.join(WS2, 'skills', 'todo-daily'));
  writeTodo(WS2, { pickable: false });
  const r = run(WS2, [CLI, '--pick']);
  assert.strictEqual(r.status, 0, `exit ${r.status}：${r.stderr}`);
  assert.ok(/不硬凑/.test(r.stdout), '未见「不硬凑」提示');
  const rows = JSON.parse(fs.readFileSync(path.join(WS2, storeRel), 'utf8'));
  assert.strictEqual(rows[0].items.length, 0, `不该编条目，实际 ${rows[0].items.length} 条`);

  // 反向：隐患区那条 ⏳ 也没被取（禁区优先于判据）
  assert.ok(!JSON.stringify(rows).includes('W-X'), '隐患区的行被取到了');
  return '0 条 · 禁区仍未取';
});

// ── 8 负向：无 TODO.md ───────────────────────────────────
check('8 负向：找不到 TODO.md → 报错退出（不凭记忆编）', () => {
  const WS3 = path.join(TMP, 'ws-no-todo');
  copyDir(SKILL_DIR, path.join(WS3, 'skills', 'todo-daily'));
  // 故意不写 TODO.md
  const r = run(WS3, [CLI, '--pick']);
  assert.strictEqual(r.status, 2, `期望 exit 2，实际 ${r.status}：${r.stdout}`);
  assert.ok(/找不到/.test(r.stderr + r.stdout), '未见「找不到」提示');
  return 'exit 2';
});

// ── 9 多租户：slug 落盘 + 反向断言 ───────────────────────
check('9 设了 TODO_AGENT → 数据落 `<slug>/`，且无 slug 路径不得被写', () => {
  const WS4 = path.join(TMP, 'ws-slug');
  copyDir(SKILL_DIR, path.join(WS4, 'skills', 'todo-daily'));
  writeTodo(WS4);
  const slug = 'selfcheck_agent';
  const r = run(WS4, [CLI, '--pick'], { TODO_AGENT: slug });
  assert.strictEqual(r.status, 0, `exit ${r.status}：${r.stderr || r.stdout}`);

  const slugPath = path.join(WS4, 'data', 'todo-three', slug, `${today.slice(0, 7)}.json`);
  const barePath = path.join(WS4, 'data', 'todo-three', `${today.slice(0, 7)}.json`);
  assert.ok(fs.existsSync(slugPath), `设了 slug 却没写 ${path.relative(WS4, slugPath)}`);
  // 🔴 反向断言：无 slug 路径不许被写。原 excellence-daily 就是靠这条抓出「越遵守说明越失败」
  assert.ok(!fs.existsSync(barePath), `设了 slug 却仍写了无 slug 路径 ${path.relative(WS4, barePath)}`);
  return `${slug}/ 有 · 无 slug 路径无`;
});

// ── 10 负向：非法 slug ──────────────────────────────────
check('10 负向：非法 TODO_AGENT 必须拒绝启动', () => {
  const r = run(WS, [CLI, '--pick', '--dry'], { TODO_AGENT: '../evil' });
  assert.notStrictEqual(r.status, 0, `非法 slug 竟返回 0：${r.stdout}`);
  assert.ok(/非法 TODO_AGENT/.test(r.stderr + r.stdout), '未见拒绝提示');
  return 'rejected';
});

// ── 清理 ────────────────────────────────────────────────
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* 留残留不影响判据 */ }

const failed = checks.filter((c) => !c.ok);
console.log('');
if (failed.length) {
  console.log(`❌ 装机自检未通过：${checks.length - failed.length}/${checks.length}`);
  console.log('   失败项：' + failed.map((f) => f.name).join(' · '));
  process.exit(1);
}
console.log(`✅ 装机自检通过：${checks.length}/${checks.length}`);
process.exit(0);
