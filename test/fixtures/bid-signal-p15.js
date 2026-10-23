#!/usr/bin/env node
/**
 * bid-signal-p15.js —— 提取器适配壳：装好 P-15 声明后再导出
 *
 * 为什么需要这层：bid-goldset-eval 直接 require 提取器并用它判样本。
 *   csb-memory 的 signalOf 默认三类（这是 B 的「默认三类」半句，不能改）。
 *   「可扩展」必须显式装配——本壳就是**份装配演示**：
 *   `installFromDeclaration(声明)` 过了才启用 relation。
 *
 * 用法（打分器侧）：
 *   node bid-goldset-eval.js --extractor ../csb-memory/test/fixtures/bid-signal-p15.js --goldset data/bid/goldset-ruozhuo-v0.3.json
 *
 * ⚠️ 这是**量它用的测试壳**，不是生产入口。生产入口是 lib/core/memory.js#loadDeclaration()。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const sig = require('../../lib/core/bid-signal');
const DECL = path.join(__dirname, '..', '..', 'config', 'bid-declaration-ruolan-v2.5.json');
const decl = JSON.parse(fs.readFileSync(DECL, 'utf8'));
const installed = sig.installFromDeclaration(decl);
if (!installed.accepted.includes('relation')) {
  // P1：装不上就显式报错，不静默退回三类冒充「已启用」
  throw new Error('P-15 声明未能装启用：' + JSON.stringify(installed.rejected));
}

module.exports = sig;
