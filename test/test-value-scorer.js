#!/usr/bin/env node
/**
 * test-value-scorer.js — CSB-Memory v0.4 价值评分测试
 * 
 * 测试 value-scorer.js 核心功能
 * 用法: node test-value-scorer.js
 */

const { calculateValue, calculateRecencyScore, calculateFrequencyScore, calculateImportanceScore, calculateConfidenceScore, calculateStructuralScore, foldMemories, ALPHA, BETA, GAMMA, DELTA, EPSILON } = require('../lib/core/value-scorer');

// 测试工具
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message} (expected: ${expected}, actual: ${actual})`);
    failed++;
  }
}

function assertApprox(actual, expected, tolerance, message) {
  if (Math.abs(actual - expected) <= tolerance) {
    console.log(`  ✅ ${message}`);
    passed++;
  } else {
    console.log(`  ❌ ${message} (expected: ~${expected}, actual: ${actual})`);
    failed++;
  }
}

// 测试用例
async function runTests() {
  console.log('=== CSB-Memory v0.4 价值评分测试 ===\n');

  // 测试1: 评分权重
  console.log('测试1: 评分权重');
  assertEqual(ALPHA, 0.25, '时间衰减权重');
  assertEqual(BETA, 0.25, '访问频率权重');
  assertEqual(GAMMA, 0.15, '重要性权重');
  assertEqual(DELTA, 0.15, '置信度权重');
  assertEqual(EPSILON, 0.20, '结构性权重');

  // 测试2: 时间衰减分数
  console.log('\n测试2: 时间衰减分数');
  const recentScore = calculateRecencyScore(new Date().toISOString());
  assertApprox(recentScore, 1.0, 0.1, '当天记忆时间衰减分数接近1');

  const oldScore = calculateRecencyScore(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
  assertApprox(oldScore, 0.5, 0.1, '30天前记忆时间衰减分数约0.5');

  const veryOldScore = calculateRecencyScore(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());
  assert(veryOldScore < 0.1, '365天前记忆时间衰减分数很低');

  // 测试3: 访问频率分数
  console.log('\n测试3: 访问频率分数');
  assertEqual(calculateFrequencyScore(0), 0, '无访问记录分数为0');
  assert(calculateFrequencyScore(1) > 0, '1次访问分数大于0');
  assert(calculateFrequencyScore(10) > calculateFrequencyScore(1), '10次访问分数高于1次');
  assertApprox(calculateFrequencyScore(10), 1.0, 0.1, '10次访问分数接近1');

  // 测试4: 重要性分数
  console.log('\n测试4: 重要性分数');
  assertEqual(calculateImportanceScore(null), 0.5, '无情感标签默认0.5');
  assertEqual(calculateImportanceScore({ significance: 0.8 }), 0.8, '重要性分数正确');

  // 测试5: 置信度分数
  console.log('\n测试5: 置信度分数');
  assertEqual(calculateConfidenceScore('high'), 1.0, '高置信度分数1.0');
  assertEqual(calculateConfidenceScore('medium'), 0.5, '中置信度分数0.5');
  assertEqual(calculateConfidenceScore('low'), 0.2, '低置信度分数0.2');

  // 测试6: 结构性权重分数
  console.log('\n测试6: 结构性权重分数');
  assertEqual(calculateStructuralScore({ structural_weight: 0.5, is_core_identity: false }), 0.5, '普通记忆结构性权重');
  assertEqual(calculateStructuralScore({ structural_weight: 0.5, is_core_identity: true }), 0.8, '身份定义记忆结构性权重最低0.8');

  // 测试7: 总价值计算
  console.log('\n测试7: 总价值计算');
  const value = calculateValue({
    timestamp: new Date().toISOString(),
    last_access: new Date().toISOString(),
    access_count: 5,
    confidence: 'high',
    structural_weight: 0.8,
    is_core_identity: true,
    affective_tag: { significance: 0.9 }
  });
  assert(value.total > 0, '总价值大于0');
  assert(value.total <= 1.0, '总价值不超过1');
  assert(value.components, '包含组件分数');
  assert(value.metadata, '包含元数据');

  // 测试8: 折叠层
  console.log('\n测试8: 折叠层');
  const testEntries = [
    { id: '1', is_core_identity: true, structural_weight: 0.8, content: '核心记忆' },
    { id: '2', is_core_identity: false, structural_weight: 0.1, content: '普通记忆' },
    { id: '3', is_core_identity: false, structural_weight: 0.1, content: '低价值记忆' }
  ];
  
  const compactFold = foldMemories(testEntries, 'compact');
  assert(compactFold.length <= testEntries.length, '折叠后数量不超过原始');
  
  const identityFold = foldMemories(testEntries, 'identity');
  assert(identityFold.every(e => e.is_core_identity), 'identity折叠只返回身份定义记忆');

  // 测试结果
  console.log('\n=== 测试结果 ===');
  console.log(`通过: ${passed}`);
  console.log(`失败: ${failed}`);
  console.log(`总计: ${passed + failed}`);
  console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
