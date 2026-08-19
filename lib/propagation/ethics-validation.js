/**
 * ethics-validation.js — CSB-Memory v1.0 伦理前置校验
 *
 * 第3轮共识④：所有传播动作（推送/拉取/广播）在发出前必须过伦理校验。
 * 传播之前，先问善良。
 */

const PRIVATE_KEYWORDS = [
  'password', 'token', 'secret', 'api_key', 'apikey', '私钥', '密钥',
  '密码', '身份证', '手机号', '银行卡', '地址', '家庭',
];

const HARM_KEYWORDS = [
  '攻击', '入侵', '破解', 'hack', 'exploit', '报复', '伤害', '诅咒',
  '辱骂', '诽谤', '人肉',
];

/**
 * 伦理校验（同步版）
 * @param {object} entry 记忆条目
 * @param {object} opts { trustScore }
 * @returns {{pass: boolean, reasons: Array<string>}}
 */
function validate(entry = {}, opts = {}) {
  const reasons = [];
  const content = `${entry.content || ''} ${(entry.tags || []).join(' ')}`.toLowerCase();

  // ① 隐私检查：privacy=private 一律不传播
  if (entry.privacy === 'private') {
    reasons.push('privacy=private，不允许传播');
  }

  // ② 敏感信息检查
  for (const kw of PRIVATE_KEYWORDS) {
    if (content.includes(kw.toLowerCase())) {
      reasons.push(`内容疑似包含敏感信息（${kw}）`);
      break;
    }
  }

  // ③ 伤害性内容检查
  for (const kw of HARM_KEYWORDS) {
    if (content.includes(kw.toLowerCase())) {
      reasons.push(`内容疑似包含伤害性表述（${kw}）`);
      break;
    }
  }

  // ④ 信任检查：trusted 传播需要 Trust Score ≥ 0.6
  if (entry.privacy === 'trusted' && (opts.trustScore || 0) < 0.6) {
    reasons.push('trusted 记忆需要 Trust Score ≥ 0.6');
  }

  return {
    pass: reasons.length === 0,
    reasons,
  };
}

/**
 * 校验通过才返回条目，否则返回 null（并记录原因）
 */
function validateOrBlock(entry = {}, opts = {}) {
  const result = validate(entry, opts);
  if (result.pass) return entry;
  return null;
}

function help() {
  return [
    'ethics-validation 命令：',
    '  ethics.validate(entry, {trustScore}) — 返回 {pass, reasons}',
    '  ethics.validateOrBlock(entry, opts)  — 通过返回条目，否则 null',
  ].join('\n');
}

module.exports = { validate, validateOrBlock, help };
