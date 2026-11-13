'use strict';
/**
 * pick.test.js —— todo-daily 取数解析回归测试（纯 node，无网络、无第三方依赖）
 *
 *   node skills/todo-daily/test/pick.test.js
 *
 * 锁住 2026-11-12 修的两条（当日真实漏取 W-58 的两个独立成因）：
 *   A 反引号内的裸竖线不得劈开单元格（否则列右移，status 取错列）
 *   B `📝 **待推进 …**` 这类带加粗的 status 必须仍被认出（原正则要求两词紧邻）
 * 另锁：隐患区/闭环区永不取、无标记不取、上限 3 条、真行 W-58 能取到。
 *
 * 铁律：不写生产数据；只喂字符串给纯函数。
 */

const assert = require('assert');
const path = require('path');

const { pickFromTodo, splitRow, statusKind } = require('../bin/todo-three');

const results = [];
let skipped = 0;
class SkipError extends Error {}
/**
 * 条件不满足 → 跳过。**不冒充通过**：跑绿了不算数，跳过更不算。
 * 用异常传出去，否则外层 test() 会在 fn 返回后再打一个 ✓（那才是真正的假绿）。
 */
function skip(why) { throw new SkipError(why); }
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    if (err instanceof SkipError) {
      skipped++;
      results.push({ name, ok: true, skipped: true });
      console.log(`  ⊘ ${name}（跳过：${err.message}）`);
      return;
    }
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

const row = (id, title, status, judge = '判据', start = '11-12') =>
  `| ${id} | ${title} | ${status} | ${judge} | ${start} |`;

const doc = (...rows) => ['## 🔄 项目 / 持续', '', '| # | 事项 | 状态 | 判据 | 起 |', '|---|---|---|---|---|', ...rows].join('\n');

console.log('todo-daily 取数回归测试');

// ── A 反引号内竖线 ────────────────────────────────────────
test('A1 splitRow 不劈开反引号内的竖线', () => {
  const cells = splitRow('| W-58 | 抽进 `a/bin|lib` 目录 | 📝 待推进 | 判据 | 11-09 |');
  // 两侧空段 + 5 个真列 = 7；关键是不因反引号内竖线变成 8
  assert.strictEqual(cells.length, 7, `期望 7 段，实际 ${cells.length}: ${JSON.stringify(cells)}`);
  assert.strictEqual(cells[3], '📝 待推进');
  assert.ok(cells[2].includes('a/bin|lib'), '反引号内的竖线应保留在标题里');
});

test('A2 反引号外的竖线照常当分隔符', () => {
  const cells = splitRow('| a | b | c |');
  assert.deepStrictEqual(cells, ['', 'a', 'b', 'c', '']);
});

test('A3 标题含裸竖线的行仍能取到（status 不错列）', () => {
  const out = pickFromTodo(doc(row('W-58', '推广包 `bin|lib` 抽取', '📝 待推进 · 余 ②③')));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'W-58');
});

// ── B 加粗 status ────────────────────────────────────────
test('B1 statusKind 认出 `📝 **待推进**`', () => {
  assert.strictEqual(statusKind('📝 **待推进 · 余 ②③**'), 'pending');
});

test('B2 statusKind 认出 `⏳ **进行中**`', () => {
  assert.strictEqual(statusKind('⏳ **进行中** · 等外部'), 'doing');
});

test('B3 statusKind 不放宽：`✅ 已收官` 仍为 null', () => {
  assert.strictEqual(statusKind('✅ 11-11 关闭'), null);
  assert.strictEqual(statusKind('🟢 📝 建议：发帖前先扫'), null, '🟢 前缀不算待推进');
  assert.strictEqual(statusKind('', ), null);
});

test('B4 加粗 status 的行能取到', () => {
  const out = pickFromTodo(doc(row('W-58', '三个三推广包', '📝 **待推进 · ①④ 已完成**', '判据', '11-09')));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, '📝 待推进 · ①④ 已完成', 'status 应剥掉加粗号再存');
});

// ── A+B 组合（就是 11-12 那行 W-58 的形状）────────────────
test('C1 反引号竖线 + 加粗 status 同时存在仍能取到', () => {
  const line = '| W-58 | **推广包**：`bin|lib` 抽进 skill | 📝 **待推进 · ①④ 已完成（11-10）· 余 ②③**。长文… | 11-09 |';
  const out = pickFromTodo(doc(line));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].id, 'W-58');
  assert.ok(out[0].title.includes('推广包'));
});

// ── 区域与上限 ───────────────────────────────────────────
test('D1 隐患登记区永不取（即使 status 匹配）', () => {
  const text = ['## ⚠️ 隐患登记（已知风险 · 条件触发才发作）', row('W-59', '拾光入口', '⏳ 进行中 · 等外部')].join('\n');
  assert.strictEqual(pickFromTodo(text).length, 0);
});

test('D2 近期闭环区永不取', () => {
  const text = ['## ✅ 近期闭环', row('Q-2', '某件', '📝 待推进')].join('\n');
  assert.strictEqual(pickFromTodo(text).length, 0);
});

test('D3 无标记不取（含 🟢/⏸ 前缀）', () => {
  const text = doc(
    row('W-43', '预检清单', '🟢 📝 **建议**：先扫关键词'),
    row('A-1', '私钥轮换', '✅ ①②完成'),
    row('X-1', '无标记', '看起来还没做'),
  );
  assert.strictEqual(pickFromTodo(text).length, 0);
});

test('D4 最多取 3 条', () => {
  const text = doc(
    row('T-1', 'a', '📝 待推进'), row('T-2', 'b', '⏳ 进行中'),
    row('T-3', 'c', '📝 待推进'), row('T-4', 'd', '📝 待推进'),
  );
  const out = pickFromTodo(text);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map((o) => o.id), ['T-1', 'T-2', 'T-3']);
});

test('D5 表头与分隔行不误取', () => {
  assert.strictEqual(pickFromTodo(doc()).length, 0);
});

// ── E 真实 TODO.md 冒烟（只读）────────────────────────────
// [2026-11-13 修假红] 原断言写死「W-58 必须能取到」。
//   11-13 上午 W-58 收官（status 改成 `✅ 11-12 …`）→ 它**按规则本就不该被取** →
//   测试假红 13/14，而代码一直是对的。
//   根因：**测试偷偷依赖了台账的内容**。台账每天在变，断言写死具体条目名，
//   就等于每次收官都会把一个绿测试变成红 —— 最后没人信红灯。
//   现在改为锁**不变量**（对任何台账都成立），而不是锁某一行：
//     E1 取到的每条 status 必须真能过 statusKind（不得混进无标记行）
//     E2 取到的每条都不得来自禁区（按行号回溯它所属的 ## 区）
//     E3 上限 3 条
//     E4 id 不得重复（同一行被取两次 = 切列错位）
test('E1 真实 TODO.md：取到的每条 status 都真能过判据', () => {
  const fs = require('fs');
  const p = path.join(__dirname, '..', '..', '..', 'TODO.md');
  if (!fs.existsSync(p)) skip('无 TODO.md（本仓不含台账，装到 workspace 后才会跑）');
  const out = pickFromTodo(fs.readFileSync(p, 'utf8'), 10);
  for (const o of out) {
    assert.ok(statusKind(o.status), `取到了判据不过的行：${o.id} status=${JSON.stringify(o.status)}`);
  }
});

test('E2 真实 TODO.md：取到的行都不在禁区（隐患/闭环）', () => {
  const fs = require('fs');
  const p = path.join(__dirname, '..', '..', '..', 'TODO.md');
  if (!fs.existsSync(p)) skip('无 TODO.md（本仓不含台账，装到 workspace 后才会跑）');
  const out = pickFromTodo(fs.readFileSync(p, 'utf8'), 10);
  // 直接吃 pickFromTodo 回报的 section（识别禁区的那一份逻辑）——
  //   不在测试里再写一遍「往上找标题」，两份实现必然漂移。
  const FORBIDDEN = [/隐患登记/, /近期闭环/];
  for (const o of out) {
    assert.ok(!FORBIDDEN.some((r) => r.test(o.section)),
      `取到了禁区行：${o.id} 在「${o.section}」（TODO.md:${o.lineNo}）`);
  }
});

test('E2b 真实 TODO.md：行号回报确实指向含该 id 的原行', () => {
  const fs = require('fs');
  const p = path.join(__dirname, '..', '..', '..', 'TODO.md');
  if (!fs.existsSync(p)) skip('无 TODO.md（本仓不含台账，装到 workspace 后才会跑）');
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  for (const o of pickFromTodo(lines.join('\n'), 10)) {
    assert.ok(Number.isInteger(o.lineNo) && o.lineNo >= 1, `${o.id} 缺 lineNo`);
    assert.ok(lines[o.lineNo - 1].includes(`| ${o.id} |`),
      `${o.id} 的 lineNo=${o.lineNo} 指向「${lines[o.lineNo - 1].slice(0, 40)}」，不是它自己`);
  }
});

test('E3 真实 TODO.md：最多 3 条', () => {
  const fs = require('fs');
  const p = path.join(__dirname, '..', '..', '..', 'TODO.md');
  if (!fs.existsSync(p)) skip('无 TODO.md（本仓不含台账，装到 workspace 后才会跑）');
  const out = pickFromTodo(fs.readFileSync(p, 'utf8'), 10);
  assert.ok(out.length <= 3, `超过上限：${out.length} 条`);
});

test('E4 真实 TODO.md：id 不重复', () => {
  const fs = require('fs');
  const p = path.join(__dirname, '..', '..', '..', 'TODO.md');
  if (!fs.existsSync(p)) skip('无 TODO.md（本仓不含台账，装到 workspace 后才会跑）');
  const ids = pickFromTodo(fs.readFileSync(p, 'utf8'), 10).map((o) => o.id);
  assert.strictEqual(new Set(ids).size, ids.length, `id 重复：${JSON.stringify(ids)}`);
});

const failed = results.filter((r) => !r.ok);
const passed = results.filter((r) => r.ok && !r.skipped).length;
const total = results.length;
const tail = skipped ? `（另 ${skipped} 项跳过，不计入通过）` : '';
console.log(`\n${failed.length ? '❌' : '✅'} ${passed}/${total} 通过${tail}`);
process.exit(failed.length ? 1 : 0);
