/**
 * hive.js — CSB-Memory v1.0 虫巢记忆（HIVE 层）
 *
 * HIVE 层不是"所有 Agent 共用一个数据库"，而是一种认知组织方式：
 * 每个 Agent 知道所有 Agent 知道的东西（的索引），
 * 自己不知道的就去问知道的 Agent。
 *
 * 本地缓存 + 远程广播两级检索。
 */

const fs = require('fs');
const path = require('path');

const HIVE_CACHE_DIR = path.join(__dirname, '..', '..', 'data', 'hive');

function ensureCacheDir() {
  if (!fs.existsSync(HIVE_CACHE_DIR)) {
    fs.mkdirSync(HIVE_CACHE_DIR, { recursive: true });
  }
}

function cacheFile(topic) {
  return path.join(HIVE_CACHE_DIR, `${safeName(topic)}.json`);
}

function safeName(name) {
  return String(name).replace(/[^a-zA-Z0-9_\u4e00-\u9fa5-]/g, '_').slice(0, 80);
}

/**
 * 查询 HIVE 层（先本地缓存，未命中返回 null 由调用方决定是否广播）
 * @param {string} query 查询内容
 * @param {object} opts { limit, threshold }
 * @returns {Array|null} 本地缓存结果；无缓存返回 null
 */
function query(query, opts = {}) {
  const { limit = 5, threshold = 0.6 } = opts;
  const file = cacheFile(query);
  if (!fs.existsSync(file)) return null;

  try {
    const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    const now = Date.now();
    // 缓存 24 小时有效
    if (now - cached.cachedAt > 24 * 3600 * 1000) {
      fs.unlinkSync(file); // 过期清除
      return null;
    }
    const results = (cached.results || [])
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return results;
  } catch (e) {
    return null;
  }
}

/**
 * 缓存跨 Agent 查询结果到本地 HIVE 层
 * @param {string} topic 查询主题
 * @param {Array} results [{ id, content, score, agent, level }]
 * @param {string} sourceAgent 来源 Agent
 */
function cache(topic, results, sourceAgent = '') {
  ensureCacheDir();
  const file = cacheFile(topic);
  const record = {
    topic,
    sourceAgent,
    cachedAt: Date.now(),
    results: (results || []).map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score,
      agent: r.agent || sourceAgent,
      level: r.level || 'hive',
    })),
  };
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return record.results.length;
}

/**
 * 从注册表同步 memory_index（"谁有什么"的目录）
 * @param {string} registryUrl 注册表地址，如 http://172.28.0.4:3099
 * @param {string} topic 可选主题过滤
 * @returns {Promise<Array>} Agent 列表
 */
async function syncIndex(registryUrl, topic = '') {
  if (!registryUrl) return [];
  const url = `${registryUrl.replace(/\/$/, '')}/memory_index${topic ? `?topic=${encodeURIComponent(topic)}` : ''}`;
  try {
    const res = await fetch(url, { timeout: 5000 });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.agents || []);
  } catch (e) {
    return [];
  }
}

/**
 * 向注册表上报本 Agent 的热门主题
 * @param {string} registryUrl 注册表地址
 * @param {string} agentName Agent 名
 * @param {Array<string>} topics 热门主题
 * @returns {Promise<boolean>}
 */
async function reportTopics(registryUrl, agentName, topics = []) {
  if (!registryUrl || !agentName) return false;
  const url = `${registryUrl.replace(/\/$/, '')}/memory_index/report`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: agentName, topics, online: true }),
      timeout: 5000,
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function help() {
  return [
    'hive 命令：',
    '  hive.query(query, {limit, threshold})   — 查 HIVE 层（本地缓存）',
    '  hive.cache(topic, results, sourceAgent) — 缓存跨 Agent 结果',
    '  hive.syncIndex(registryUrl, topic)      — 同步注册表 memory_index',
    '  hive.reportTopics(registryUrl, name, topics) — 上报本 Agent 主题',
  ].join('\n');
}

module.exports = { query, cache, syncIndex, reportTopics, help, HIVE_CACHE_DIR };
