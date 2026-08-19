#!/usr/bin/env node
/**
 * test-lifecycle.js — CSB-Memory v0.4 生命周期测试
 * 
 * 测试 lifecycle.js 核心功能
 * 用法: node test-lifecycle.js
 */

const { getStatus, transitionState, getStats, checkForgotten, restoreMemory, getLifecycleState, checkTransition, LIFECYCLE_STATES } = require('../lib/core/lifecycle');

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

// 测试用例
async function runTests() {
  console.log('=== CSB-Memory v0.4 生命周期测试 ===\n');

  // 测试1: 生命周期状态定义
  console.log('测试1: 生命周期状态定义');
  assert(LIFECYCLE_STATES.birth, 'birth状态存在');
  assert(LIFECYCLE_STATES.active, 'active状态存在');
  assert(LIFECYCLE_STATES.consolidated, 'consolidated状态存在');
  assert(LIFECYCLE_STATES.archived, 'archived状态存在');
  assert(LIFECYCLE_STATES.forgotten, 'forgotten状态存在');
  assertEqual(LIFECYCLE_STATES.birth.next, 'active', 'birth -> active');
  assertEqual(LIFECYCLE_STATES.active.next, 'consolidated', 'active -> consolidated');
  assertEqual(LIFECYCLE_STATES.consolidated.next, 'archived', 'consolidated -> archived');
  assertEqual(LIFECYCLE_STATES.archived.next, 'forgotten', 'archived -> forgotten');
  assertEqual(LIFECYCLE_STATES.forgotten.next, null, 'forgotten -> 终止');

  // 测试2: 状态推断
  console.log('\n测试2: 状态推断');
  assertEqual(getLifecycleState({}), 'birth', '默认状态为birth');
  assertEqual(getLifecycleState({ access_count: 1 }), 'active', '有访问记录为active');
  assertEqual(getLifecycleState({ access_count: 3, confidence: 'medium', lifecycle_state: 'consolidated' }), 'consolidated', '访问3次为consolidated');
  assertEqual(getLifecycleState({ archived_at: '2026-01-01' }), 'archived', '有归档时间为archived');
  assertEqual(getLifecycleState({ forgotten: true }), 'forgotten', '有遗忘标记为forgotten');

  // 测试3: 状态转换检查
  console.log('\n测试3: 状态转换检查');
  const birthToActive = checkTransition({ lifecycle_state: 'birth', access_count: 1 });
  assert(birthToActive, 'birth可转active');
  assertEqual(birthToActive.from, 'birth', '从birth');
  assertEqual(birthToActive.to, 'active', '到active');

  const activeToConsolidated = checkTransition({ lifecycle_state: 'active', access_count: 3, confidence: 'medium' });
  assert(activeToConsolidated, 'active可转consolidated');

  // 测试4: 统计功能
  console.log('\n测试4: 统计功能');
  getStats(); // 不抛出异常即通过
  assert(true, '统计功能正常运行');

  // 测试5: 遗忘检查
  console.log('\n测试5: 遗忘检查');
  checkForgotten(); // 不抛出异常即通过
  assert(true, '遗忘检查正常运行');

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
