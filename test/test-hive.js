/**
 * test-hive.js — CSB-Memory v1.0 HIVE 层单元测试
 * 运行：node test/test-hive.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const hive = require('../lib/hive/hive');

// 使用临时目录隔离测试数据
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'csb-memory-hive-'));
hive.HIVE_CACHE_DIR = tmpDir;

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

console.log('🧪 test-hive.js — HIVE 层测试\n');

test('cache 写入并返回条数', () => {
  const n = hive.cache('中医', [
    { id: 'mem_1', content: '黄帝内经注解', score: 0.92, agent: '明德' },
    { id: 'mem_2', content: '经络图谱', score: 0.85, agent: '清漪' },
  ], '明德');
  assert.strictEqual(n, 2);
});

test('query 命中本地缓存并按 score 排序', () => {
  const results = hive.query('中医', { threshold: 0.6 });
  assert.ok(Array.isArray(results));
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].agent, '明德'); // 0.92 在前
});

test('query 未命中主题返回 null', () => {
  const results = hive.query('不存在的主题xyz');
  assert.strictEqual(results, null);
});

test('query threshold 过滤', () => {
  const results = hive.query('中医', { threshold: 0.9 });
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].score, 0.92);
});

test('query limit 截断', () => {
  const results = hive.query('中医', { limit: 1 });
  assert.strictEqual(results.length, 1);
});

test('memory-index extractTopics 统计', () => {
  const index = require('../lib/hive/memory-index');
  const topics = index.extractTopics([
    { tags: ['中医', '易经'] },
    { tags: ['中医', '黄帝内经'] },
    { tags: ['易经'] },
  ], 10);
  assert.deepStrictEqual(topics, ['中医', '易经', '黄帝内经']);
});

test('query-proxy aggregate 去重排序', () => {
  const proxy = require('../lib/hive/query-proxy');
  const results = proxy.aggregate([
    { id: 'm1', content: 'A', score: 0.5, agent: '甲' },  // 低于阈值
    { id: 'm2', content: 'B', score: 0.8, agent: '乙' },
    { id: 'm2', content: 'B', score: 0.7, agent: '乙' },  // 重复，取高
    { id: 'm3', content: 'C', score: 0.9, agent: '丙' },
  ], { threshold: 0.6 });
  assert.strictEqual(results.length, 2);
  assert.strictEqual(results[0].id, 'm3');
});

test('query-proxy buildQueryCommand 格式', () => {
  const proxy = require('../lib/hive/query-proxy');
  const cmd = proxy.buildQueryCommand('中医', { limit: 3 });
  const parsed = JSON.parse(cmd.replace(/^CMD:/, ''));
  assert.strictEqual(parsed.type, 'memory.query');
  assert.strictEqual(parsed.params.query, '中医');
  assert.strictEqual(parsed.params.limit, 3);
});

test('query-proxy extractResults 解析 A2A 响应', () => {
  const proxy = require('../lib/hive/query-proxy');
  const resp = {
    result: {
      message: {
        parts: [{
          type: 'text',
          text: 'CMD:{"type":"memory.query","params":{}}',
        }],
      },
    },
  };
  // 无 results 时应返回空数组而不抛错
  assert.deepStrictEqual(proxy.extractResults(resp), []);
});

// 清理临时目录
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
process.exit(failed ? 1 : 0);
