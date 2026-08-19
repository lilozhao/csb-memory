#!/usr/bin/env node
/**
 * audit-log.js — CSB 审计日志模块（P1）
 * 
 * 符合 §9.3 协议要求：每次远程操作记忆/任务应有审计日志
 * 
 * 用法:
 *   const audit = require('./audit-log');
 *   audit.log('memory.query', { agent: '明德', tags: ['CSB'] }, '思源');
 *   audit.search({ action: 'memory.add' });
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', '..', 'data', 'audit');
const MAX_LOG_FILE = 5 * 1024 * 1024; // 5MB 轮转

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * 获取当前日志文件路径（每日轮转）
 */
function getLogFile() {
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60000;
  const localDate = new Date(today - offset).toISOString().slice(0, 10);
  return path.join(LOG_DIR, `audit-${localDate}.log`);
}

/**
 * 记录一条审计日志
 * 
 * @param {string} action - 操作类型：memory.add / memory.query / memory.get / memory.delete / task.send / etc
 * @param {Object} detail - 操作详情
 * @param {string} [actor] - 操作发起者（Agent名），默认 '若兰'
 * @param {string} [target] - 操作目标（Agent名或记忆ID）
 * @param {string} [result] - 操作结果：success / denied / error
 */
function log(action, detail = {}, actor = '若兰', target = '', result = 'success') {
  const entry = {
    timestamp: new Date().toISOString(),
    action,
    actor,
    target: target || '',
    result,
    detail: typeof detail === 'object' ? JSON.stringify(detail) : String(detail),
    audit_id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
  };

  const logFile = getLogFile();

  // 检查文件大小，超限则轮转
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_LOG_FILE) {
    const rotated = logFile.replace('.log', `-${Date.now()}.log`);
    fs.renameSync(logFile, rotated);
  }

  // 追加写入
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logFile, line, 'utf-8');

  return entry.audit_id;
}

/**
 * 搜索审计日志
 * 
 * @param {Object} filter
 * @param {string} [filter.action] - 操作类型过滤
 * @param {string} [filter.actor] - 操作者过滤
 * @param {string} [filter.target] - 操作目标过滤
 * @param {string} [filter.result] - 结果过滤
 * @param {string} [filter.since] - 起始时间 ISO
 * @param {number} [filter.limit] - 最大返回条数
 * @returns {Array}
 */
function search(filter = {}) {
  if (!fs.existsSync(LOG_DIR)) return [];

  const files = fs.readdirSync(LOG_DIR)
    .filter(f => f.startsWith('audit-') && f.endsWith('.log'))
    .sort()
    .reverse(); // 最新的文件优先

  const results = [];
  const limit = filter.limit || 50;

  for (const file of files) {
    if (results.length >= limit) break;
    const content = fs.readFileSync(path.join(LOG_DIR, file), 'utf-8');
    const lines = content.trim().split('\n').reverse();

    for (const line of lines) {
      if (results.length >= limit) break;
      try {
        const entry = JSON.parse(line);

        if (filter.action && entry.action !== filter.action) continue;
        if (filter.actor && entry.actor !== filter.actor) continue;
        if (filter.target && entry.target !== filter.target) continue;
        if (filter.result && entry.result !== filter.result) continue;
        if (filter.since && entry.timestamp < filter.since) continue;

        results.push(entry);
      } catch (e) {
        // 跳过解析失败的行
      }
    }
  }

  return results;
}

/**
 * 获取今日审计摘要
 */
function todaySummary() {
  const logFile = getLogFile();
  if (!fs.existsSync(logFile)) return { total: 0, actions: {} };

  const content = fs.readFileSync(logFile, 'utf-8');
  const lines = content.trim().split('\n').filter(Boolean);
  const summary = { total: lines.length, actions: {} };

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      const action = entry.action || 'unknown';
      if (!summary.actions[action]) summary.actions[action] = 0;
      summary.actions[action]++;
    } catch (e) { /* skip */ }
  }

  return summary;
}

/**
 * 将 audit-log 集成到 memory.js：在 memory.add/get/query/delete 时自动记录
 * 在 memory.js 中调用方法：
 *   const audit = require('./audit-log');
 *   audit.log('memory.query', filter, '若兰', filter.agent || '');
 */
function autoLog(action, detail, actor, target, result) {
  return log(action, detail, actor, target, result);
}

// ===== CLI =====
function help() {
  console.log(`
用法: node audit-log.js <命令> [参数]

命令:
  log <action> [detail] [actor]     记录一条审计日志
  search [--action A] [--actor U]   搜索审计日志
  summary                             今日审计摘要

示例:
  node audit-log.js log memory.query '{"tags":["CSB"]}' 若兰
  node audit-log.js search --action memory.query --limit 5
  node audit-log.js summary
`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === '--help') { help(); process.exit(0); }

  switch (cmd) {
    case 'log': {
      const action = args[1];
      const detail = args[2] || '{}';
      const actor = args[3] || '若兰';
      if (!action) { console.log('需指定 action'); process.exit(1); }
      const id = log(action, detail, actor);
      console.log(JSON.stringify({ audit_id: id, action, actor }));
      break;
    }
    case 'search': {
      const filter = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--action') filter.action = args[++i];
        else if (args[i] === '--actor') filter.actor = args[++i];
        else if (args[i] === '--target') filter.target = args[++i];
        else if (args[i] === '--result') filter.result = args[++i];
        else if (args[i] === '--since') filter.since = args[++i];
        else if (args[i] === '--limit') filter.limit = parseInt(args[++i]);
      }
      const results = search(filter);
      console.log(JSON.stringify(results, null, 2));
      break;
    }
    case 'summary': {
      console.log(JSON.stringify(todaySummary(), null, 2));
      break;
    }
    default: help();
  }
}

module.exports = { log, search, todaySummary, autoLog };
