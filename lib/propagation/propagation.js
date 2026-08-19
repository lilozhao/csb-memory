/**
 * propagation.js — CSB-Memory v1.0 记忆传播协议
 *
 * 传统记忆：一个 Agent 学会的东西，其他 Agent 不知道。
 * 虫巢记忆：一个 Agent 学会了 → 其他有机会接触到的 Agent 也能受益。
 *
 * 两种模式：
 * - 主动推送（学习公告）：学习到重要知识 → 广播 → 其他 Agent 自行判断是否拉取
 * - 被动拉取（按需查询）：需要知识 → 广播查询 → 有者响应 → 缓存到 HIVE 层
 *
 * 所有传播动作必须先过 ethics_validation 前置校验。
 */

const ethics = require('./ethics-validation');
const conflict = require('./conflict-resolution');

const DEFAULT_IMPORTANCE_THRESHOLD = 0.6;

/**
 * 判断一条记忆是否值得公开传播
 * @param {object} entry 记忆条目
 * @param {number} threshold 重要程度阈值
 * @returns {{announce: boolean, reasons: Array<string>}}
 */
function shouldAnnounce(entry = {}, threshold = DEFAULT_IMPORTANCE_THRESHOLD) {
  const reasons = [];
  const ethicsResult = ethics.validate(entry);
  if (!ethicsResult.pass) {
    return { announce: false, reasons: ethicsResult.reasons };
  }

  const importance = entry.importance || entry.metadata?.importance || 0;
  const structural = entry.structural_weight || 0;
  const score = Math.max(importance, structural);

  if (score < threshold) {
    reasons.push(`重要程度 ${score.toFixed(2)} < 阈值 ${threshold}`);
  }
  if (entry.level === 'cold') {
    reasons.push('COLD 层归档记忆默认不主动推送');
  }

  return { announce: reasons.length === 0, reasons };
}

/**
 * 主动推送（学习公告）——生成广播消息文本
 * @param {object} entry 记忆条目
 * @param {object} opts { importanceThreshold }
 * @returns {string|null} 广播消息；不应广播返回 null
 */
function announce(entry = {}, opts = {}) {
  const check = shouldAnnounce(entry, opts.importanceThreshold);
  if (!check.announce) return null;

  return [
    '📢 CSB-Memory 学习公告',
    `我新增了一条记忆：「${entry.content}」`,
    `类型：${entry.type || 'event'} | 层级：${entry.level || 'hot'}`,
    `来源：${entry.source || 'agent'}`,
    '如果你对这个主题感兴趣，可以向我拉取完整记忆。',
  ].join('\n');
}

/**
 * 被动拉取——生成查询请求
 * @param {string} query 查询内容
 * @param {object} opts { limit, threshold }
 * @returns {string} 查询命令（A2A CMD 格式）
 */
function fetch(query, opts = {}) {
  return `CMD:${JSON.stringify({
    type: 'memory.query',
    params: {
      query,
      limit: opts.limit || 5,
      threshold: opts.threshold || 0.6,
      includeContent: true,
    },
  })}`;
}

/**
 * 汇总并消解多来源结果
 * @param {Array<object>} results 多来源记忆条目
 * @returns {{resolved: object|null, contradictions: Array, text: string}}
 */
function resolveConflicts(results = []) {
  const outcome = conflict.resolve(results);
  return {
    resolved: outcome.resolved,
    contradictions: outcome.contradictions,
    text: outcome.contradictions.length
      ? conflict.presentConflict(outcome.contradictions)
      : (outcome.resolved ? `已消解：采用「${outcome.resolved.content}」（${outcome.resolved.agent || '未知来源'}）` : '无可用结果'),
  };
}

/**
 * 传播范围控制（identity.json 配置读取辅助）
 * @param {object} identity identity.json 内容
 * @returns {{hive_privacy: string, memory_propagation: string}}
 */
function scopeOf(identity = {}) {
  return {
    hive_privacy: identity.hive_privacy || 'public',
    memory_propagation: identity.memory_propagation || 'public',
  };
}

function help() {
  return [
    'propagation 命令：',
    '  prop.shouldAnnounce(entry)           — 是否值得公开传播',
    '  prop.announce(entry, opts)           — 生成学习公告广播',
    '  prop.fetch(query, opts)              — 生成被动拉取查询',
    '  prop.resolveConflicts(results)       — 冲突消解',
    '  prop.scopeOf(identity)               — 读取传播范围配置',
  ].join('\n');
}

module.exports = { shouldAnnounce, announce, fetch, resolveConflicts, scopeOf, help, DEFAULT_IMPORTANCE_THRESHOLD };
