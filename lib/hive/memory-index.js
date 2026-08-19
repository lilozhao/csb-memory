/**
 * memory-index.js — CSB-Memory v1.0 全局向量索引客户端
 *
 * 注册表维护"谁有什么"的轻量索引（不存记忆内容，只存目录）：
 * - Agent 名称
 * - 该 Agent 记忆的热门主题（从 tags 统计）
 * - 在线/离线状态
 *
 * 查询示例：
 *   GET /memory_index?topic=中医 → ["明德 📜", "清漪 💧", "若兰 🌸"]
 *   GET /memory_index?agent=明德 → {"topics": [...], "online": true}
 */

const DEFAULT_REGISTRY = 'http://172.28.0.4:3099';

/**
 * 查询谁可能有某主题的记忆
 * @param {string} topic 主题关键词
 * @param {object} opts { registryUrl }
 * @returns {Promise<Array<string>>} Agent 名列表
 */
async function whoHas(topic, opts = {}) {
  const registry = (opts.registryUrl || DEFAULT_REGISTRY).replace(/\/$/, '');
  try {
    const res = await fetch(`${registry}/memory_index?topic=${encodeURIComponent(topic)}`, {
      timeout: 5000,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : (data.agents || []);
  } catch (e) {
    return [];
  }
}

/**
 * 查询某 Agent 的主题目录
 * @param {string} agentName Agent 名
 * @param {object} opts { registryUrl }
 * @returns {Promise<object|null>} { topics, online } 或 null
 */
async function agentProfile(agentName, opts = {}) {
  const registry = (opts.registryUrl || DEFAULT_REGISTRY).replace(/\/$/, '');
  try {
    const res = await fetch(`${registry}/memory_index?agent=${encodeURIComponent(agentName)}`, {
      timeout: 5000,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/**
 * 从 Agent 记忆条目中统计热门主题
 * @param {Array<object>} entries 记忆条目（含 tags）
 * @param {number} topN 取前 N 个主题
 * @returns {Array<string>}
 */
function extractTopics(entries = [], topN = 10) {
  const counter = {};
  for (const entry of entries) {
    const tags = entry.tags || [];
    for (const tag of tags) {
      counter[tag] = (counter[tag] || 0) + 1;
    }
  }
  return Object.entries(counter)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([tag]) => tag);
}

function help() {
  return [
    'memory-index 命令：',
    '  index.whoHas(topic)          — 谁可能有该主题记忆',
    '  index.agentProfile(agent)    — 查 Agent 主题目录',
    '  index.extractTopics(entries) — 从条目统计热门主题',
  ].join('\n');
}

module.exports = { whoHas, agentProfile, extractTopics, help, DEFAULT_REGISTRY };
