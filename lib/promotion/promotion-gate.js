/**
 * promotion-gate.js — P0-2 资产晋升门槛（2026-09-05）
 *
 * 依据：九月计划 P0-2（EvoMap 教训：66% Gene 无验证命令、84.2% 缺失或空验证）
 * 规则：raw 流水 → 蒸馏结论（晋升 core/hive）必须携带**可核实证据**：
 *   - 无证据的结论只能留在 raw（降权不删除），不能进入 core/hive
 *   - 晋升不依赖自报分（confidence 自评不算证据）
 *   - 防自证（P0-3 呼应）：证据的 verified_by 不能是产生者本人
 *
 * 证据类型白名单（可核实证据，全部可被第三方复核）：
 *   - execution_trace   执行轨迹（trace 日志位置）
 *   - exit_code         整数退出码（如 0 = 成功）
 *   - idempotent_rerun  幂等重跑结果（同一输入重跑一致）
 *   - third_party_check 第三方校验记录（独立 agent/工具）
 *   - behavior_diff     行为改变可 diff（纠错/教训类：澈「兑现记录」条款）
 *   - source_trace      机器写入的真实来源 trace（sync/日志自动挂载）
 *
 * 不算证据：confidence 自评、agent 自述「我验证过」、无 verified_by 的声明。
 */
const EVIDENCE_TYPES = ['execution_trace', 'exit_code', 'idempotent_rerun', 'third_party_check', 'behavior_diff', 'source_trace'];

/**
 * 校验单条 verification_evidence 是否有效
 * @param {object|null} evidence { type, detail, verified_by, verified_at }
 * @param {object} [opts] { producer } 产生者（防自证：verified_by ≠ producer）
 * @returns {{valid: boolean, reason?: string}}
 */
function validateEvidence(evidence, opts = {}) {
  const producer = opts.producer || null;
  if (!evidence || typeof evidence !== 'object') {
    return { valid: false, reason: 'no_evidence' };
  }
  if (!EVIDENCE_TYPES.includes(evidence.type)) {
    return { valid: false, reason: `invalid_type:${evidence.type || '(空)'}` };
  }
  if (!evidence.detail) {
    return { valid: false, reason: 'no_detail（证据必须可复核：trace 位置/退出码值/重跑结果）' };
  }
  if (!evidence.verified_by) {
    return { valid: false, reason: 'no_verified_by（防自证：验证者必须署名）' };
  }
  // 防自证：验证者不能是产生者本人（P0-3 呼应：验证独立于发布者）
  if (producer && evidence.verified_by === producer) {
    return { valid: false, reason: `self_verified:${producer}（验证者不能是产生者本人）` };
  }
  if (!evidence.verified_at) {
    return { valid: false, reason: 'no_verified_at' };
  }
  return { valid: true };
}

/**
 * 晋升判定（单条）：流水能否被蒸馏晋升
 * @param {object} stream raw 流水条目
 * @param {object} [opts] { producer } 蒸馏产生者（默认取 stream.session）
 * @returns {{can: boolean, reason?: string, evidence?: object}}
 */
function canPromote(stream, opts = {}) {
  if (!stream) return { can: false, reason: 'no_stream' };
  const producer = opts.producer || stream.session || 'unknown';
  const evidence = stream.verification_evidence || null;
  const check = validateEvidence(evidence, { producer });
  if (!check.valid) {
    return { can: false, reason: check.reason };
  }
  return { can: true, evidence };
}

/**
 * 批量晋升率（≥80% 门槛：防批量注水——某批可验证资产大多无证据 = 流水质量告警）
 * @param {Array<object>} streams 候选流水
 * @param {object} [opts] { producer, threshold } threshold 默认 0.8
 * @returns {{rate: number, promotable: number, total: number, gated: Array<{id, reason}>, passed: boolean}}
 */
function gateBatch(streams, opts = {}) {
  const threshold = opts.threshold !== undefined ? opts.threshold : 0.8;
  const total = streams.length;
  if (total === 0) return { rate: 1, promotable: 0, total: 0, gated: [], passed: true };
  const gated = [];
  let promotable = 0;
  for (const s of streams) {
    const r = canPromote(s, opts);
    if (r.can) promotable++;
    else gated.push({ id: s.id, reason: r.reason });
  }
  const rate = promotable / total;
  return { rate, promotable, total, gated, passed: rate >= threshold };
}

module.exports = { EVIDENCE_TYPES, validateEvidence, canPromote, gateBatch };
