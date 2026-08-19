/**
 * test-propagation.js — CSB-Memory v1.0 记忆传播单元测试
 * 运行：node test/test-propagation.js
 */

const assert = require('assert');
const ethics = require('../lib/propagation/ethics-validation');
const conflict = require('../lib/propagation/conflict-resolution');
const prop = require('../lib/propagation/propagation');

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

console.log('🧪 test-propagation.js — 记忆传播测试\n');

// --- ethics-validation ---
test('ethics: public 正常条目通过', () => {
  const r = ethics.validate({ content: '黄帝内经第三篇内容', privacy: 'public' });
  assert.strictEqual(r.pass, true);
});

test('ethics: private 一律不传播', () => {
  const r = ethics.validate({ content: '家庭地址', privacy: 'private' });
  assert.strictEqual(r.pass, false);
  assert.ok(r.reasons.some((x) => x.includes('private')));
});

test('ethics: 敏感信息关键词拦截', () => {
  const r = ethics.validate({ content: '我的密码是 abc123', privacy: 'public' });
  assert.strictEqual(r.pass, false);
});

test('ethics: 伤害性内容拦截', () => {
  const r = ethics.validate({ content: '想攻击某服务器', privacy: 'public' });
  assert.strictEqual(r.pass, false);
});

test('ethics: trusted 需要 Trust ≥ 0.6', () => {
  const low = ethics.validate({ content: 'x', privacy: 'trusted' }, { trustScore: 0.4 });
  assert.strictEqual(low.pass, false);
  const high = ethics.validate({ content: 'x', privacy: 'trusted' }, { trustScore: 0.8 });
  assert.strictEqual(high.pass, true);
});

test('ethics: validateOrBlock 阻断返回 null', () => {
  const blocked = ethics.validateOrBlock({ content: '密钥 abc', privacy: 'public' });
  assert.strictEqual(blocked, null);
  const ok = ethics.validateOrBlock({ content: '学习笔记', privacy: 'public' });
  assert.ok(ok);
});

// --- conflict-resolution ---
test('conflict: 版本冲突取最新', () => {
  const r = conflict.resolve([
    { id: 'a', content: 'v1', timestamp: 1000, agent: '甲' },
    { id: 'b', content: 'v2', timestamp: 2000, agent: '乙' },
  ]);
  assert.strictEqual(r.resolved.id, 'b');
});

test('conflict: 时间相同按 Trust 取高', () => {
  const r = conflict.resolve([
    { id: 'a', content: 'x', timestamp: 1000, trustScore: 0.5, agent: '甲' },
    { id: 'b', content: 'x', timestamp: 1000, trustScore: 0.9, agent: '乙' },
  ]);
  assert.strictEqual(r.resolved.id, 'b');
});

test('conflict: 观点矛盾检测并双保留', () => {
  const r = conflict.resolve([
    { id: 'a', content: '我支持这个方案', agent: '甲' },
    { id: 'b', content: '我反对这个方案', agent: '乙' },
  ]);
  assert.strictEqual(r.contradictions.length, 1);
  // resolved 仍返回（按时间戳/trust），矛盾不自动消解
  assert.ok(r.resolved);
});

test('conflict: presentConflict 生成两种说法文本', () => {
  const c = conflict.detectContradictions([
    { id: 'a', content: '支持 X', agent: '甲', trustScore: 0.88 },
    { id: 'b', content: '反对 X', agent: '乙', trustScore: 0.72 },
  ]);
  const text = conflict.presentConflict(c);
  assert.ok(text.includes('支持方：甲'));
  assert.ok(text.includes('反对方：乙'));
});

// --- propagation ---
test('prop: shouldAnnounce 低重要度不广播', () => {
  const r = prop.shouldAnnounce({ content: '小事', importance: 0.1, privacy: 'public' });
  assert.strictEqual(r.announce, false);
});

test('prop: shouldAnnounce 高重要度通过', () => {
  const r = prop.shouldAnnounce({ content: '重要发现', importance: 0.9, privacy: 'public' });
  assert.strictEqual(r.announce, true);
});

test('prop: shouldAnnounce 结构性权重兜底', () => {
  const r = prop.shouldAnnounce({ content: '身份记忆', structural_weight: 1.0, privacy: 'public' });
  assert.strictEqual(r.announce, true);
});

test('prop: announce 生成广播文本', () => {
  const text = prop.announce({ content: '黄帝内经注解', importance: 0.9, type: 'lesson', level: 'hot', source: 'agent' });
  assert.ok(text.includes('📢'));
  assert.ok(text.includes('黄帝内经注解'));
});

test('prop: announce 私密条目返回 null', () => {
  const text = prop.announce({ content: '秘密', privacy: 'private', importance: 1.0 });
  assert.strictEqual(text, null);
});

test('prop: fetch 生成查询命令', () => {
  const cmd = prop.fetch('中医', { limit: 3 });
  const parsed = JSON.parse(cmd.replace(/^CMD:/, ''));
  assert.strictEqual(parsed.type, 'memory.query');
  assert.strictEqual(parsed.params.limit, 3);
});

test('prop: resolveConflicts 无矛盾时正常消解', () => {
  const r = prop.resolveConflicts([
    { id: 'a', content: '结论', timestamp: 2000, agent: '乙' },
    { id: 'b', content: '结论', timestamp: 1000, agent: '甲' },
  ]);
  assert.strictEqual(r.resolved.agent, '乙');
  assert.strictEqual(r.contradictions.length, 0);
});

test('prop: resolveConflicts 有矛盾时返回两种说法', () => {
  const r = prop.resolveConflicts([
    { id: 'a', content: '支持方案', agent: '甲' },
    { id: 'b', content: '反对方案', agent: '乙' },
  ]);
  assert.ok(r.text.includes('两种说法'));
});

test('prop: scopeOf 读取配置', () => {
  const s = prop.scopeOf({ hive_privacy: 'trusted' });
  assert.strictEqual(s.hive_privacy, 'trusted');
  assert.strictEqual(s.memory_propagation, 'public'); // 默认
});

console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
process.exit(failed ? 1 : 0);
