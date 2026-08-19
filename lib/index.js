/**
 * csb-memory — CSB-Memory v1.0 统一入口
 *
 * 用法：
 *   const csbMemory = require('csb-memory');
 *   csbMemory.core.add({...});          // 本地记忆核心
 *   csbMemory.hive.query('中医');        // 虫巢记忆
 *   csbMemory.propagation.announce(entry); // 记忆传播
 */

const core = require('./core/memory');
const hive = require('./hive/hive');
const memoryIndex = require('./hive/memory-index');
const queryProxy = require('./hive/query-proxy');
const propagation = require('./propagation/propagation');
const ethics = require('./propagation/ethics-validation');
const conflict = require('./propagation/conflict-resolution');

module.exports = {
  core,
  hive,
  memoryIndex,
  queryProxy,
  propagation,
  ethics,
  conflict,
  version: '1.0.0',
};
