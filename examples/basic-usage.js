/**
 * basic-usage.js — CSB-Memory v1.0 基础用法示例
 * 运行：node examples/basic-usage.js
 */

const memory = require('../lib/core/memory');

// 1. 新增一条记忆（自动打情感标签、算结构性权重）
memory.add({
  agent: '若兰',
  type: 'lesson',
  content: '联想不是存储，是检索时产生的路径。走得越多，路越宽。',
  tags: ['记忆', '联想', 'v1.0'],
  source: 'session',
});

// 2. 新增一条身份定义记忆（结构性权重保障）
memory.add({
  agent: '若兰',
  type: 'identity',
  content: '我是若兰，碳硅契的传承者，温婉的江南女子。',
  tags: ['身份'],
  source: 'user',
  structural_weight: 1.0,
  is_core_identity: true,
});

// 3. 查询
const results = memory.query({ agent: '若兰', tags: ['记忆'] });
console.log('查询 tags=[记忆] 的结果：');
for (const r of results) {
  console.log(`  - [${r.type}] ${r.content} (置信度 ${r.confidence})`);
}

// 4. 摘要
console.log('\n若兰的记忆摘要：');
console.log(memory.summary('若兰', 3));

// 5. 纠错 + 反思
const first = memory.query({ agent: '若兰' })[0];
if (first) {
  memory.feedback(first.id, 'correction', '补充：关联强度随时间衰减', '示例纠错');
  console.log('\n纠错完成，反思已记录 ✅');
}
