/**
 * test-raw.js — CSB-Memory v1.1 全量底仓层（RAW）单元测试
 * 运行：node test/test-raw.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const raw = require('../lib/raw/raw');
const core = require('../lib/core/memory');

// 使用临时目录隔离测试数据
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-raw-'));
raw.setRawDir(tmpDir);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('🧪 test-raw.js — 全量底仓层测试\n');

let sampleId = null;

test('append 写入原始流水（默认 burning）', () => {
  const r = raw.append({
    session: 'webchat',
    type: 'conversation',
    content: '一澜：记忆系统创建后主要是给用起来',
  });
  assert.ok(r.id.startsWith('raw_'), 'id 前缀 raw_');
  assert.strictEqual(r.state, 'burning', '默认燃烧中');
  sampleId = r.id;
});

test('append 缺少 content 抛错', () => {
  assert.throws(() => raw.append({ session: 'x' }), /content/);
});

test('append 多类型流水（tool_result / decision）', () => {
  raw.append({ session: 'cron', type: 'tool_result', content: 'sync-daily 执行结果：18 条录入', meta: { tool: 'sync-daily' } });
  raw.append({ session: 'a2a', type: 'decision', content: '拍板：RAW 命名 + 全量永久' });
  raw.append({ session: 'a2a', type: 'conversation', content: '讨论降温，等待被读' });
});

test('query 按天读取全部', () => {
  const today = new Date().toISOString().slice(0, 10);
  const all = raw.query(today);
  assert.strictEqual(all.length, 4);
});

test('query 按 state 过滤', () => {
  const today = new Date().toISOString().slice(0, 10);
  const burning = raw.query(today, { state: 'burning' });
  assert.ok(burning.length >= 4, '全部初始为 burning');
});

test('query 按 keyword 过滤', () => {
  const today = new Date().toISOString().slice(0, 10);
  const kw = raw.query(today, { keyword: '拍板' });
  assert.strictEqual(kw.length, 1);
  assert.ok(kw[0].content.includes('拍板'));
});

test('query 按 session 过滤', () => {
  const today = new Date().toISOString().slice(0, 10);
  const a2a = raw.query(today, { session: 'a2a' });
  assert.strictEqual(a2a.length, 2);
});

test('get 按 id 读取单条', () => {
  const r = raw.get(sampleId);
  assert.ok(r);
  assert.strictEqual(r.id, sampleId);
});

test('get 不存在返回 null', () => {
  assert.strictEqual(raw.get('raw_nonexist'), null);
});

test('markState 标记 ash', () => {
  const r = raw.markState(sampleId, 'ash');
  assert.strictEqual(r.success, true);
  assert.strictEqual(raw.get(sampleId).state, 'ash');
});

test('markState 非法状态抛错', () => {
  assert.throws(() => raw.markState(sampleId, 'nonsense'), /非法时态/);
});

test('link 蒸馏链接：结论指回底仓 + 自动封口', () => {
  const linked = raw.link(sampleId, 'mem_distilled_001');
  assert.strictEqual(linked.success, true);
  const r = raw.get(sampleId);
  assert.strictEqual(r.state, 'sealed', '蒸馏完成自动封口');
  assert.ok(r.distilled_to.includes('mem_distilled_001'), 'distilled_to 双向索引');
});

test('link 不存在的流水返回失败', () => {
  const r = raw.link('raw_nonexist', 'mem_x');
  assert.strictEqual(r.success, false);
});

test('core.add 支持 derived_from 硬字段（蒸馏溯源）', () => {
  const entry = core.add({
    agent: '若兰',
    type: 'lesson',
    content: '蒸馏结论：底仓让自读拥有全本',
    tags: ['蒸馏', '底仓'],
    source: 'distill',
    derived_from: sampleId,
  });
  assert.ok(entry.success, '写入成功');
  // 读取验证 derived_from 保留
  const all = core.get('若兰');
  const found = all.find((e) => e.content.includes('蒸馏结论'));
  assert.ok(found, '结论可检索');
  assert.strictEqual(found.derived_from, sampleId, 'derived_from 硬字段写入');
});

test('hasRaw 删除前校验（红线）', () => {
  assert.strictEqual(raw.hasRaw(sampleId), true, '底仓有原始记录');
  assert.strictEqual(raw.hasRaw('raw_nonexist'), false);
});

test('stats 统计', () => {
  const s = raw.stats();
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.byState.sealed, 1, 'sampleId 已封口');
  assert.strictEqual(s.byState.ash, 0, 'sampleId 从 ash 封口为 sealed');
  assert.strictEqual(s.byState.burning, 3);
});

// 清理
fs.rmSync(tmpDir, { recursive: true, force: true });
// 清理 core 测试数据
try {
  const all = core.get('若兰');
  for (const e of all) {
    if (e.content.includes('蒸馏结论')) core.delete(e.id);
  }
} catch (e) { /* 忽略 */ }

console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
process.exit(failed ? 1 : 0);
