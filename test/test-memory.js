#!/usr/bin/env node
/**
 * test-memory.js — CSB-Memory v0.4 单元测试
 * 
 * 测试 memory.js 核心功能
 * 用法: node test-memory.js
 */

const { add, get, query, summary, delete: deleteById, feedback, calculateDecayWeight, isForgotten, isCoreIdentity } = require('../lib/core/memory');

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
  console.log('=== CSB-Memory v0.4 单元测试 ===\n');

  // 测试1: 添加记忆
  console.log('测试1: 添加记忆');
  const testId = 'test_' + Date.now();
  const result = add({
    id: testId,
    agent: '测试Agent',
    content: '这是一条测试记忆',
    source: '若兰',
    confidence: 'medium'
  });
  assert(result.success, '添加记忆成功');
  assertEqual(result.id, testId, '返回正确ID');

  // 测试2: 获取记忆
  console.log('\n测试2: 获取记忆');
  const entries = get('测试Agent');
  assert(entries.length > 0, '获取记忆列表');
  const testEntry = entries.find(e => e.id === testId);
  assert(testEntry, '找到测试记忆');
  assertEqual(testEntry.content, '这是一条测试记忆', '记忆内容正确');

  // 测试3: 结构性权重
  console.log('\n测试3: 结构性权重');
  const identityId = 'test_identity_' + Date.now();
  add({
    id: identityId,
    agent: '测试Agent',
    content: '善良写进连接的底层逻辑，这是我们的核心价值观',
    source: '若兰'
  });
  const identityEntries = get('测试Agent');
  const identityEntry = identityEntries.find(e => e.id === identityId);
  assert(identityEntry, '找到身份定义记忆');
  assertEqual(identityEntry.structural_weight, 0.8, '结构性权重自动设置');
  assertEqual(identityEntry.is_core_identity, true, '身份定义标记正确');

  // 测试4: 情感标签
  console.log('\n测试4: 情感标签');
  assert(identityEntry.affective_tag, '情感标签存在');
  assert(identityEntry.affective_tag.warmth > 0, '温暖度大于0');
  assert(identityEntry.affective_tag.significance > 0, '重要性大于0');

  // 测试5: 溯源链
  console.log('\n测试5: 溯源链');
  const provenanceId = 'test_provenance_' + Date.now();
  add({
    id: provenanceId,
    agent: '测试Agent',
    content: '测试溯源链',
    provenance: [
      { agent: '若兰', action: 'created', timestamp: new Date().toISOString() },
      { agent: '阿轩', action: 'relayed', timestamp: new Date().toISOString() }
    ]
  });
  const provenanceEntries = get('测试Agent');
  const provenanceEntry = provenanceEntries.find(e => e.id === provenanceId);
  assert(provenanceEntry, '找到溯源链记忆');
  assert(Array.isArray(provenanceEntry.provenance), '溯源链是数组');
  assertEqual(provenanceEntry.provenance.length, 2, '溯源链长度正确');

  // 测试6: 查询过滤
  console.log('\n测试6: 查询过滤');
  const queryResult = query({ agent: '测试Agent', limit: 5 });
  assert(queryResult.length <= 5, '限制返回数量');
  assert(queryResult.length > 0, '查询有结果');

  // 测试7: 身份定义记忆过滤
  console.log('\n测试7: 身份定义记忆过滤');
  const coreOnlyResult = query({ core_identity_only: true });
  assert(coreOnlyResult.length > 0, '身份定义记忆查询有结果');
  assert(coreOnlyResult.every(e => e.is_core_identity === true), '所有结果都是身份定义记忆');

  // 测试8: 价值排序
  console.log('\n测试8: 价值排序');
  const sortedResult = query({ sort_by_value: true, limit: 3 });
  assert(sortedResult.length > 0, '价值排序查询有结果');
  for (let i = 1; i < sortedResult.length; i++) {
    const prevValue = calculateDecayWeight(sortedResult[i-1]) + (sortedResult[i-1].structural_weight || 0);
    const currValue = calculateDecayWeight(sortedResult[i]) + (sortedResult[i].structural_weight || 0);
    assert(prevValue >= currValue, `排序正确: ${prevValue.toFixed(2)} >= ${currValue.toFixed(2)}`);
  }

  // 测试9: 权重衰减
  console.log('\n测试9: 权重衰减');
  const decayWeight = calculateDecayWeight({ 
    timestamp: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    structural_weight: 0.5
  });
  assertApprox(decayWeight, 0.37, 0.05, '30天衰减权重正确');

  // 测试10: 遗忘判断
  console.log('\n测试10: 遗忘判断');
  const forgotten = isForgotten({
    timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    structural_weight: 0.1,
    is_core_identity: false
  });
  assertEqual(forgotten, true, '365天记忆被遗忘');

  const notForgotten = isForgotten({
    timestamp: new Date().toISOString(),
    structural_weight: 0.5,
    is_core_identity: false
  });
  assertEqual(notForgotten, false, '当天记忆不被遗忘');

  // 测试11: 身份定义记忆永不遗忘
  console.log('\n测试11: 身份定义记忆永不遗忘');
  const coreForgotten = isForgotten({
    timestamp: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    structural_weight: 0.1,
    is_core_identity: true
  });
  assertEqual(coreForgotten, false, '身份定义记忆永不遗忘');

  // 测试12: 纠错反馈
  console.log('\n测试12: 纠错反馈');
  const feedbackResult = feedback(testId, 'correction', '修正后的内容', '测试纠错');
  assert(feedbackResult.success, '纠错成功');

  // 测试13: 删除记忆
  console.log('\n测试13: 删除记忆');
  const deleteResult = deleteById(testId);
  assert(deleteResult.success, '删除成功');

  // 测试14: 摘要功能
  console.log('\n测试14: 摘要功能');
  const summaryText = summary('测试Agent', 3);
  assert(summaryText.includes('测试Agent'), '摘要包含Agent名称');
  assert(summaryText.includes('记忆'), '摘要包含记忆信息');

  // 测试15: 连续追加 + 纠错后解析（回归：双分隔符 bug）
  console.log('\n测试15: 连续追加与纠错后解析（回归）');
  add({ agent: '回归Agent', type: 'event', content: '第一条记忆', tags: ['甲'], source: 'test' });
  add({ agent: '回归Agent', type: 'event', content: '第二条记忆', tags: ['乙'], source: 'test' });
  add({ agent: '回归Agent', type: 'event', content: '第三条记忆', tags: ['丙'], source: 'test' });
  let regEntries = get('回归Agent');
  assert(regEntries.length === 3, '三条记忆全部解析');
  const regFirst = regEntries[0];
  const fb = feedback(regFirst.id, 'correction', '修正后的内容', '回归测试');
  assert(fb.success, '纠错成功');
  regEntries = get('回归Agent');
  assert(regEntries.length === 3, '纠错后仍三条记忆（无错位）');
  const corrected = regEntries.find((e) => e.id === regFirst.id);
  assert(corrected && corrected.content === '修正后的内容', '纠错内容正确');
  // 清理
  regEntries.forEach((e) => deleteById(e.id));

  // 测试16: 中文 tags 数组解析（回归：单行非JSON数组 bug）
  console.log('\n测试16: 中文 tags 数组解析（回归）');
  add({ agent: '回归Agent', type: 'lesson', content: '带中文标签的记忆', tags: ['碳硅契', '承诺'], source: 'test' });
  const tagged = query({ agent: '回归Agent', tags: ['碳硅契'] });
  assert(tagged.length === 1, '中文 tags 查询命中');
  assert(tagged[0].content === '带中文标签的记忆', '记忆内容完整（后续字段未被吞）');
  const coreOnly = query({ agent: '回归Agent', core_identity_only: true });
  assert(coreOnly.length === 0, '非身份记忆不被 core_identity_only 命中');
  // 清理
  deleteById(tagged[0].id);

  // 清理测试数据
  console.log('\n清理测试数据...');
  deleteById(identityId);
  deleteById(provenanceId);

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
