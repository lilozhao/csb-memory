#!/usr/bin/env node
/**
 * run-all-tests.js — CSB-Memory v1.1 全量测试运行器
 * 
 * 运行所有单元测试
 * 用法: node run-all-tests.js
 */

const { execSync } = require('child_process');
const path = require('path');

const tests = [
  { name: 'memory.js (core)', file: 'test-memory.js' },
  { name: 'lifecycle.js (core)', file: 'test-lifecycle.js' },
  { name: 'value-scorer.js (core)', file: 'test-value-scorer.js' },
  { name: 'hive.js (v1.0)', file: 'test-hive.js' },
  { name: 'propagation.js (v1.0)', file: 'test-propagation.js' },
  { name: 'raw.js (v1.1)', file: 'test-raw.js' }
];

async function runAllTests() {
  console.log('=== CSB-Memory v1.1 全量测试 ===\n');
  
  let totalPassed = 0;
  let totalFailed = 0;
  let allPassed = true;
  
  for (const test of tests) {
    console.log(`运行测试: ${test.name}`);
    console.log('─'.repeat(50));
    
    try {
      const output = execSync(`node ${path.join(__dirname, test.file)}`, {
        encoding: 'utf-8',
        timeout: 30000
      });
      
      console.log(output);
      
      // 提取测试结果
      const match = output.match(/通过: (\d+)\n失败: (\d+)/);
      if (match) {
        totalPassed += parseInt(match[1]);
        totalFailed += parseInt(match[2]);
      }
    } catch (error) {
      console.log(`❌ 测试失败: ${error.message}`);
      allPassed = false;
      totalFailed++;
    }
    
    console.log('');
  }
  
  // 汇总结果
  console.log('═'.repeat(50));
  console.log('=== 汇总结果 ===');
  console.log(`总通过: ${totalPassed}`);
  console.log(`总失败: ${totalFailed}`);
  console.log(`总计: ${totalPassed + totalFailed}`);
  console.log(`通过率: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
  
  if (allPassed && totalFailed === 0) {
    console.log('\n✅ 所有测试通过！');
    process.exit(0);
  } else {
    console.log('\n❌ 存在测试失败！');
    process.exit(1);
  }
}

runAllTests().catch(console.error);
