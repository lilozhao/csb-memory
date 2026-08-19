/**
 * index.js — csb-memory v1.1 统一入口
 *
 * 用法：
 *   const csbMemory = require('csb-memory');
 *   csbMemory.core.add({...});            // 本地记忆核心
 *   csbMemory.raw.append({...});          // 全量底仓（v1.1）
 *   csbMemory.hive.query('中医');          // 虫巢记忆
 *   csbMemory.propagation.announce(entry); // 记忆传播
 */

const core = require('./core/memory');
const raw = require('./raw/raw');
const hive = require('./hive/hive');
const memoryIndex = require('./hive/memory-index');
const queryProxy = require('./hive/query-proxy');
const propagation = require('./propagation/propagation');
const ethics = require('./propagation/ethics-validation');
const conflict = require('./propagation/conflict-resolution');

module.exports = {
  core,
  raw,
  hive,
  memoryIndex,
  queryProxy,
  propagation,
  ethics,
  conflict,
  version: '1.1.0',
};
