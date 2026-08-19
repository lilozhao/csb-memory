/**
 * query-proxy.js — CSB-Memory v1.0 跨 Agent 查询代理
 *
 * 当一个 Agent 需要查询其他 Agent 的记忆时，通过 A2A memory.query 协商：
 *   Agent A 需要某知识
 *     → 查自己的记忆（没找到）
 *     → 发出 A2A memory.query 消息
 *       → 注册表返回"谁可能知道这个"
 *       → 逐一向候选 Agent 查询
 *       → 汇总结果，返回给 A
 *     → A 将结果缓存到自己的 HIVE 层
 */

/**
 * A2A 查询协议格式
 * 请求：CMD:{"type":"memory.query","params":{"query":"...","limit":5,"threshold":0.6,"includeContent":true}}
 * 响应：{"success":true,"results":[{"id":"mem_xxx","content":"...","score":0.92,"agent":"若兰","level":"hive"}]}
 */

function buildQueryCommand(query, opts = {}) {
  return `CMD:${JSON.stringify({
    type: 'memory.query',
    params: {
      query,
      limit: opts.limit || 5,
      threshold: opts.threshold || 0.6,
      includeContent: opts.includeContent !== false,
    },
  })}`;
}

/**
 * 向单个 Agent 发起 memory.query
 * @param {string} agentUrl Agent 的 A2A 地址，如 http://172.28.0.5:3100
 * @param {string} query 查询内容
 * @param {object} opts
 * @returns {Promise<Array>} 结果列表（失败返回空数组）
 */
async function queryAgent(agentUrl, query, opts = {}) {
  const command = buildQueryCommand(query, opts);
  try {
    const res = await fetch(`${agentUrl.replace(/\/$/, '')}/a2a/json-rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'SendMessage',
        id: `memq-${Date.now()}`,
        params: {
          message: {
            role: 'user',
            messageId: `memq-${Date.now()}`,
            parts: [{ type: 'text', text: command }],
          },
        },
      }),
      timeout: opts.timeout || 8000,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return extractResults(data, opts.agentName || agentUrl);
  } catch (e) {
    return [];
  }
}

/**
 * 向多个候选 Agent 广播查询，汇总排序
 * @param {Array<string>} candidateUrls Agent A2A 地址列表
 * @param {string} query 查询内容
 * @param {object} opts { limit, threshold, timeout }
 * @returns {Promise<Array>} 汇总排序后的结果
 */
async function broadcast(candidateUrls = [], query, opts = {}) {
  const { limit = 5, threshold = 0.6 } = opts;
  const settled = await Promise.allSettled(
    candidateUrls.map((url, i) =>
      queryAgent(url, query, { ...opts, agentName: candidateUrls[i] })
    )
  );
  const results = [];
  for (const s of settled) {
    if (s.status === 'fulfilled' && Array.isArray(s.value)) {
      results.push(...s.value);
    }
  }
  return aggregate(results, { limit, threshold });
}

/**
 * 汇总排序（score 降序，去重按 id）
 */
function aggregate(results = [], opts = {}) {
  const { limit = 5, threshold = 0.6 } = opts;
  const seen = new Map();
  for (const r of results) {
    if (!r || r.score < threshold) continue;
    const key = r.id || `${r.agent}-${r.content}`;
    if (!seen.has(key) || seen.get(key).score < r.score) {
      seen.set(key, r);
    }
  }
  return [...seen.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * 从 A2A 响应中提取 memory.query 结果（兼容多种响应形态）
 */
function extractResults(data, defaultAgent = '') {
  if (!data) return [];
  const candidates = [
    data.result,
    data.result && data.result.message,
    data.result && data.result.message && data.result.message.parts,
  ];
  for (const c of candidates) {
    if (!c) continue;
    // parts 数组形态
    if (Array.isArray(c)) {
      for (const part of c) {
        if (part && part.type === 'text' && part.text) {
          const parsed = tryParseQueryResponse(part.text);
          if (parsed) return parsed;
        }
      }
    }
    // 对象形态
    const text = c.text || c.content;
    if (typeof text === 'string') {
      const parsed = tryParseQueryResponse(text);
      if (parsed) return parsed;
    }
    if (Array.isArray(c.results)) {
      return c.results.map((r) => ({ ...r, agent: r.agent || defaultAgent }));
    }
  }
  return [];
}

function tryParseQueryResponse(text) {
  try {
    const cleaned = text.replace(/^CMD:/, '').trim();
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.results)) {
      return obj.results.map((r) => ({ ...r, agent: r.agent || '' }));
    }
  } catch (e) {
    // 非 JSON 响应，忽略
  }
  return null;
}

function help() {
  return [
    'query-proxy 命令：',
    '  proxy.broadcast(urls, query, opts) — 向候选 Agent 广播查询',
    '  proxy.queryAgent(url, query, opts) — 向单个 Agent 查询',
    '  proxy.aggregate(results, opts)     — 汇总排序去重',
  ].join('\n');
}

module.exports = { buildQueryCommand, queryAgent, broadcast, aggregate, extractResults, help };
