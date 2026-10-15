/**
 * bid-signal.js — BID 关系信号抽取（SPEC-MEM-0001 · 一期）
 *
 * 目的：记忆生成时把「承诺 / 纠错 / 决策」信号从正文里提为结构化字段，
 *       供 BID（羁绊影响域）读字段而非事后正则猜。
 *
 * 口径（一澜 2026-10-15 拍定）：1A 落字段 + 2 一期先行（state 恒 pending）+ 3 先出 spec。
 * 同源：词表与反抽原型 csb-aep/scripts/bid-signal-from-memory.js 一致（Q1 一澜 12:04 确认同源）。
 * 说明：本表与 sync-daily.js#IMPORTANT_PATTERNS 有意重叠（同一批信号词），此处为 BID 信号的唯一真相源。
 */

'use strict';

// 信号词表（与反抽原型同源）
const CORRECTION = /更正|纠正|我说错|我错了|我错|撤回|收回|道歉|修正|指正|反驳|订正|勘误|推翻我|我先前.{0,12}错/;
const PROMISE = /承诺|约定|答应|会完成|将在|计划|待办|TODO|待跟进|待核|剩：|下一步/;
const DECISION = /决定|拍板|确认|同意|批准|定案|定稿|共识|敲定/;

// 方向线索（一期：仅当 kind=correction 时尝试判定；判不出取 null，不猜）
const DIR_OUT = /我方.{0,6}(更正|纠正)|回执.{0,8}确认更正|已更正|已撤回/;   // 我→对方
const DIR_IN = /主动更正|对方.{0,6}更正|外部.{0,6}更正|指出我方|纠正我/;       // 对方→我

// 已知连接名（用于从 tags/正文提取 peer；与反抽原型同源）
const KNOWN_PEERS = ['阿轩', '墨丘', '舟楫', '小虾', 'Jeason', '恺', '澈', '星尘', '思源',
  '明德', '若琢', '言蹊', '明镜', '苏念', '若辰', '知微', '初白', '川贝', '清漪', '鲸歌'];

function detectKind(text) {
  if (!text) return null;
  if (CORRECTION.test(text)) return 'correction';
  if (PROMISE.test(text)) return 'promise';
  if (DECISION.test(text)) return 'decision';
  return null;
}

function extractPeer(entry) {
  // 1) 调用方显式传入
  if (entry.peer) return entry.peer;
  // 2) tags 里带连接名
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  for (const t of tags) {
    const hit = KNOWN_PEERS.find(p => String(t).includes(p));
    if (hit) return hit;
  }
  // 3) 正文里带连接名
  const text = entry.content || '';
  const hit = KNOWN_PEERS.find(p => text.includes(p));
  return hit || null;
}

/**
 * 抽取一条记忆的 BID 信号。
 * @returns {{kind,peer,direction,state}|null}  无信号词 → null（不落字段）
 */
function signalOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = `${entry.content || ''} ${entry.title || ''}`;
  const kind = detectKind(text);
  if (!kind) return null;

  let direction = entry.direction || null;
  if (kind === 'correction' && !direction) {
    if (DIR_OUT.test(text)) direction = 'out';
    else if (DIR_IN.test(text)) direction = 'in';
  }

  return {
    kind,
    peer: extractPeer(entry),
    direction: direction || null,
    state: 'pending', // 一期固定（SPEC-MEM-0001 R6）
  };
}

module.exports = { signalOf, detectKind, extractPeer, CORRECTION, PROMISE, DECISION, KNOWN_PEERS };