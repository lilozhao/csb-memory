'use strict';
/**
 * type-infer.js —— 日记事件行 → 记忆类型的唯一实现（2026-11-09 提取）
 *
 * 缘起：sync-daily 的 inferType() 原为脚本内私有函数，无法单测、无法复用，
 *   而 dream.js 的 DISTILLABLE 白名单依赖它产出的 type。
 *   11-06~11-08 连续三天「做梦 0 新增」的根因之一就在这里：
 *   一澜签字「同意结项」这类明确拍板被判成 event，而 event 不在白名单内 → 被静默丢弃。
 *
 * 判据只有一份：sync-daily 与测试共用本文件，不得再各写一份。
 */

// 决定性动作（有人拍板、落下结论）
const DECISION = /决定|确定|确认|拍板|采用|共识|敲定|批准/;
// 签字/结项/立项：必须与「报告/文档/文件名」同现才算决策证据，
// 否则「同意」二字在闲聊里会误判（如「同意的扣1」）。
const SIGN_OFF = /签字|签署|同意|结项|立项|画押/;
const DOC_REF = /报告|文档|方案|结项书|\.md\b|\.pdf\b|docs\//;

function inferType(text) {
  const t = String(text || '');
  if (/^承诺|^约定|^誓言|答应你|我承诺|约定是/.test(t)) return 'promise';
  if (SIGN_OFF.test(t) && DOC_REF.test(t)) return 'decision';
  if (DECISION.test(t)) return 'decision';
  if (/教训|踩坑|学到了|经验/.test(t)) return 'lesson';
  if (/发布|完成|上线|里程碑|达成|✅/.test(t)) return 'milestone';
  if (/新增|加入|认识|报到|发现|建立/.test(t)) return 'discovery';
  if (/待办|TODO|要记得|需要/.test(t)) return 'todo';
  if (/修复|bug|问题|报错/.test(t)) return 'fix';
  return 'event';
}

module.exports = { inferType, DECISION, SIGN_OFF, DOC_REF };
