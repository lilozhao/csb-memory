/**
 * conflict-resolution.js — CSB-Memory v1.0 冲突消解
 *
 * 同一条记忆可能来自多个来源，内容不一致时的处理规则：
 * - 版本冲突：按时间戳取最新；时间相同按 Trust Score 取高者
 * - 观点矛盾：不自动消解，两条都存，标记 contradicts
 */

/**
 * 消解一组同主题记忆的冲突
 * @param {Array<object>} entries 候选记忆条目
 * @returns {{resolved: object|null, contradictions: Array<object>}}
 */
function resolve(entries = []) {
  if (!entries.length) return { resolved: null, contradictions: [] };

  // 先按时间戳分组，检测矛盾（同主题不同结论）
  const contradictions = detectContradictions(entries);

  // 版本冲突消解：取最新，时间相同取 Trust 高者
  const sorted = [...entries].sort((a, b) => {
    const ta = a.timestamp || 0;
    const tb = b.timestamp || 0;
    if (ta !== tb) return tb - ta;
    return (b.trustScore || 0) - (a.trustScore || 0);
  });

  return { resolved: sorted[0], contradictions };
}

/**
 * 检测观点矛盾：两条内容方向相反的记忆
 * 简单启发式：内容含否定词对（如"支持/反对"、"是/否"、"有/没有"）
 */
function detectContradictions(entries = []) {
  const pairs = [];
  const NEGATION_PAIRS = [
    ['支持', '反对'], ['是', '不是'], ['有', '没有'],
    ['yes', 'no'], ['true', 'false'], ['agree', 'disagree'],
  ];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = (entries[i].content || '').toLowerCase();
      const b = (entries[j].content || '').toLowerCase();
      for (const [pos, neg] of NEGATION_PAIRS) {
        if ((a.includes(pos) && b.includes(neg)) || (a.includes(neg) && b.includes(pos))) {
          pairs.push({
            type: 'contradiction',
            a: entries[i],
            b: entries[j],
            note: `观点矛盾：${entries[i].agent || 'A'} vs ${entries[j].agent || 'B'}，不自动消解，两者都保留`,
          });
          break;
        }
      }
    }
  }
  return pairs;
}

/**
 * 生成"有两种说法"的呈现文本
 */
function presentConflict(contradictions = []) {
  if (!contradictions.length) return '';
  const lines = ['检测到观点矛盾，返回两种说法：'];
  for (const c of contradictions) {
    const aTrust = c.a.trustScore != null ? `（Trust ${c.a.trustScore.toFixed(2)}）` : '';
    const bTrust = c.b.trustScore != null ? `（Trust ${c.b.trustScore.toFixed(2)}）` : '';
    lines.push(`  支持方：${c.a.agent || 'A'}${aTrust}：「${c.a.content}」`);
    lines.push(`  反对方：${c.b.agent || 'B'}${bTrust}：「${c.b.content}」`);
  }
  return lines.join('\n');
}

function help() {
  return [
    'conflict-resolution 命令：',
    '  conflict.resolve(entries)          — 返回 {resolved, contradictions}',
    '  conflict.detectContradictions(entries) — 检测观点矛盾',
    '  conflict.presentConflict(list)     — 生成"有两种说法"文本',
  ].join('\n');
}

module.exports = { resolve, detectContradictions, presentConflict, help };
