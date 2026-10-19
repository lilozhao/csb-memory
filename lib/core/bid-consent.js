#!/usr/bin/env node
/**
 * bid-consent.js — BID-A 跨实例同意的记录与校验（O6 · S3 · 2026-10-18）
 *
 * 目的：跨实例取数必须有显式同意，且同意可撤回、可追溯。
 *       本模块只管**同意状态**，不负责取数（取数在 S4）。
 *
 * 纪律（BID-H 主权五条移植 · 一澜 2026-10-18 21:18 批）：
 *   1. 显式 opting-in —— 双方都要在 grantedBy 里，单方无效
 *   2. 告知进版本管理 —— notice 版本不符则视为未同意
 *   3. 沉默不采 —— 无记录 = 未同意（不是"默认同意"）
 *   4. 随时可终止 —— 撤回置时间戳，立即失效
 *   5. 零负面解读 —— 拒绝/撤回不得影响任何评分
 *
 * 撤回后数据处置（本模块实现核心）：
 *   停止取数 + **72 小时内删除已取数据**，删不掉的如实报告。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const WS = path.join(__dirname, '..', '..', '..');
const CONSENT_FILE = path.join(WS, 'config', 'bid-consent.json');
const PURGE_DEADLINE_HOURS = 72;
// 一澜 2026-10-19 批 Q-S3-1「两段式」：
//   撤回 → 立即停采 → 24h 内隔离（不再被任何计算读到）→ 48h 内删除 → 72h 硬上限
const ISOLATE_DEADLINE_HOURS = 24;
const PURGE_TARGET_HOURS = 48;

const CURRENT_NOTICE = 'bid-a-consent-notice-v1';
// Q-S3-4（一澜 2026-10-19 批）：**语义版本**才是决定是否重签的判据。
//   v1 → 措辞/排版变更不升版本；**收窄或扩大授权范围、改变处置条款**才升 v2。
const CURRENT_NOTICE_VERSION = 'v1';
const SCOPE_SIGNAL_READ = 'bid_signal.read';

// ── 存储 ────────────────────────────────────────────────

function loadAll(file = CONSENT_FILE) {
  if (!fs.existsSync(file)) return { version: 1, notice: CURRENT_NOTICE, connections: [] };
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // 损坏时返回空（宁可无同意，不可误判有同意）
    return { version: 1, notice: CURRENT_NOTICE, connections: [] };
  }
}

/**
 * 登记某连接的数据副本位置（S4 取数后调用）。
 * 撤回时 purgePlan() 靠这个清单才删得掉——**不登记 = 删不掉**。
 */
function registerDataLocation(peer, location, opts = {}) {
  if (!peer || !location) throw new Error('registerDataLocation 需要 peer 与 location');
  const file = opts.file || CONSENT_FILE;
  const data = loadAll(file);
  const rec = data.connections.find(c => c.peer === peer);
  if (!rec) throw new Error(`无同意记录：${peer}`);
  rec.dataLocations = [...new Set([...(rec.dataLocations || []), location])];
  saveAll(data, file);
  return rec;
}

function saveAll(data, file = CONSENT_FILE) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return true;
}

// ── 记录 ────────────────────────────────────────────────

/**
 * 记录一次同意。**双方都必须在 grantedBy 里**，否则拒绝。
 */
function grant(peer, grantedBy, opts = {}) {
  if (!peer) throw new Error('缺少 peer');
  const parties = Array.isArray(grantedBy) ? grantedBy.filter(Boolean) : [];
  if (parties.length < 2) {
    throw new Error('同意须双方齐全（grantedBy 至少 2 方），单方同意无效');
  }

  const data = opts.file ? loadAll(opts.file) : loadAll();
  const now = new Date().toISOString();
  const rec = {
    peer,
    grantedBy: [...new Set(parties)],
    grantedAt: now,
    scope: opts.scope || [SCOPE_SIGNAL_READ],
    notice: opts.notice || CURRENT_NOTICE,
    noticeVersion: opts.noticeVersion || CURRENT_NOTICE_VERSION,
    expiresAt: opts.expiresAt || null,
    withdrawn: null,
    purgeDeadline: null,
    purgedAt: null,
  };

  const idx = data.connections.findIndex(c => c.peer === peer);
  if (idx >= 0) data.connections[idx] = rec;
  else data.connections.push(rec);

  saveAll(data, opts.file);
  return rec;
}

/**
 * 撤回同意。立即失效，并起算 72h 删除期限。
 * @returns {object} 撤回记录（含 purgeDeadline）
 */
function withdraw(peer, by, opts = {}) {
  const file = opts.file || CONSENT_FILE;
  const data = loadAll(file);
  const rec = data.connections.find(c => c.peer === peer);
  if (!rec) throw new Error(`无同意记录：${peer}`);

  const now = new Date();
  const H = 3600 * 1000;
  rec.withdrawn = { at: now.toISOString(), by: by || 'unknown' };
  // 两段式（Q-S3-1）：24h 隔离 / 48h 删除目标 / 72h 硬上限
  rec.isolateDeadline = new Date(now.getTime() + ISOLATE_DEADLINE_HOURS * H).toISOString();
  rec.purgeTarget = new Date(now.getTime() + PURGE_TARGET_HOURS * H).toISOString();
  rec.purgeDeadline = new Date(now.getTime() + PURGE_DEADLINE_HOURS * H).toISOString();
  // 隔离即刻生效：撤回后该连接的数据一律不得进入任何计算
  rec.isolated = true;

  saveAll(data, file);
  return rec;
}

/**
 * 撤回通知记录（Q-S3-2：单方撤回后**必须通知另一方**）。
 * 未确认送达前不得视为完成撤回流程。
 */
function markNotified(peer, opts = {}) {
  const file = opts.file || CONSENT_FILE;
  const data = loadAll(file);
  const rec = data.connections.find(c => c.peer === peer);
  if (!rec) throw new Error(`无同意记录：${peer}`);
  if (!rec.withdrawn) throw new Error(`连接未撤回，无需通知：${peer}`);
  rec.notified = { at: new Date().toISOString(), to: opts.to || peer, by: opts.by || 'unknown', method: opts.method || 'a2a' };
  saveAll(data, file);
  return rec;
}

/**
 * 标记已删除（purge 完成后调用）。
 */
function markPurged(peer, opts = {}) {
  const file = opts.file || CONSENT_FILE;
  const data = loadAll(file);
  const rec = data.connections.find(c => c.peer === peer);
  if (!rec) throw new Error(`无同意记录：${peer}`);
  rec.purgedAt = new Date().toISOString();
  saveAll(data, file);
  return rec;
}

// ── 校验 ────────────────────────────────────────────────

/**
 * 判断某连接当前**是否允许取数**。
 * 任何一条不满足即 false —— 宁可少取，不可误取。
 *
 * 语义变更（Q-S3-4 · 一澜 2026-10-19 批）：
 *   同意记录里存 `noticeVersion`（语义版本，如 v1）。
 *   告知文本的**措辞/排版**修改变 sha256 但不升版本 → 同意继续有效；
 *   只有 `CURRENT_NOTICE_VERSION` 提升（语义变更）才要求重新 opt-in。
 */
function checkConsent(peer, opts = {}) {
  const now = opts.now || Date.now();
  const data = opts.file ? loadAll(opts.file) : loadAll();
  const rec = data.connections.find(c => c.peer === peer);
  const reasons = [];

  if (!rec) {
    return { allowed: false, reasons: ['无同意记录（沉默不采：未同意＝未观测）'], record: null };
  }
  if (rec.withdrawn) reasons.push(`已撤回（${rec.withdrawn.at} by ${rec.withdrawn.by}）`);
  if (rec.grantedBy && rec.grantedBy.length < 2) reasons.push('同意方不足 2 方（单方同意无效）');
  // Q-S3-4：只比语义版本，不比 sha256（排版变更不触发重签）
  if (rec.noticeVersion !== CURRENT_NOTICE_VERSION) {
    reasons.push(`告知文本语义版本不符（记录=${rec.noticeVersion || '缺'} 当前=${CURRENT_NOTICE_VERSION}，需重新 opt-in）`);
  }
  const scope = rec.scope || [];
  if (!scope.includes(SCOPE_SIGNAL_READ)) reasons.push(`scope 未含 ${SCOPE_SIGNAL_READ}`);
  if (rec.expiresAt && Date.parse(rec.expiresAt) < now) reasons.push(`已过期（${rec.expiresAt}）`);
  // 已撤回且未完成删除 → 也不允许（防止误用残留）
  if (rec.withdrawn && !rec.purgedAt) reasons.push('已撤回但数据尚未删除（须先完成 purge）');
  // Q-S3-1：隔离即刻生效
  if (rec.isolated) reasons.push('已隔离（撤回后隔离期内不得被读取/计算）');
  // Q-S3-2：撤回未通知对方 → 流程未完成
  if (rec.withdrawn && !rec.notified) reasons.push('撤回后尚未通知对方（流程未完成）');

  return { allowed: reasons.length === 0, reasons, record: rec };
}

/**
 * 列出**待删除**的连接（已撤回、未 purge、且在期限内外都列出）。
 *
 * @returns {{overdue:Array, pending:Array}}
 */
function listPendingPurge(opts = {}) {
  const now = opts.now || Date.now();
  const data = opts.file ? loadAll(opts.file) : loadAll();
  const overdue = [];
  const pending = [];
  for (const rec of data.connections) {
    if (!rec.withdrawn || rec.purgedAt) continue;
    const dl = rec.purgeDeadline ? Date.parse(rec.purgeDeadline) : null;
    const tl = rec.purgeTarget ? Date.parse(rec.purgeTarget) : null;
    const item = {
      peer: rec.peer,
      withdrawnAt: rec.withdrawn.at,
      isolateDeadline: rec.isolateDeadline || null,
      purgeTarget: rec.purgeTarget || null,
      purgeDeadline: rec.purgeDeadline,
      stage: tl !== null && tl < now ? 'purge-due' : 'isolated',
      notified: !!rec.notified,
    };
    if (dl !== null && dl < now) overdue.push(item);
    else pending.push(item);
  }
  return { overdue, pending };
}

/**
 * 生成待删除数据清单（S4 取数后会在此登记副本位置）。
 * 本函数只产出**清单**，不执行删除 —— 删除须人工确认（不可逆）。
 */
function purgePlan(peer, opts = {}) {
  const file = opts.file || CONSENT_FILE;
  const data = loadAll(file);
  const rec = data.connections.find(c => c.peer === peer);
  if (!rec) return { error: `无同意记录：${peer}` };
  if (!rec.withdrawn) return { error: `连接未撤回，无需删除：${peer}` };
  return {
    peer,
    withdrawnAt: rec.withdrawn.at,
    isolated: !!rec.isolated,
    isolateDeadline: rec.isolateDeadline || null,
    purgeTarget: rec.purgeTarget || null,
    purgeDeadline: rec.purgeDeadline,
    notified: !!rec.notified,
    targets: rec.dataLocations || [],
    note: rec.dataLocations && rec.dataLocations.length
      ? '以上为登记的数据位置，删除后调 markPurged()'
      : '未登记任何数据副本位置（尚未取数，或已手工清除）',
    undeletable: rec.undeletable || [],
  };
}

module.exports = {
  CURRENT_NOTICE, CURRENT_NOTICE_VERSION, SCOPE_SIGNAL_READ, PURGE_DEADLINE_HOURS, ISOLATE_DEADLINE_HOURS, PURGE_TARGET_HOURS, CONSENT_FILE,
  loadAll, saveAll, grant, withdraw, markNotified, registerDataLocation, markPurged, checkConsent, listPendingPurge, purgePlan,
};
