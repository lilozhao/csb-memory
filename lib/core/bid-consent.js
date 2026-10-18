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

const CURRENT_NOTICE = 'bid-a-consent-notice-v1';
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
  rec.withdrawn = { at: now.toISOString(), by: by || 'unknown' };
  rec.purgeDeadline = new Date(now.getTime() + PURGE_DEADLINE_HOURS * 3600 * 1000).toISOString();

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
 * @returns {{allowed:boolean, reasons:string[], record:object|null}}
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
  if (rec.notice !== CURRENT_NOTICE) reasons.push(`告知文本版本不符（记录=${rec.notice} 当前=${CURRENT_NOTICE}，需重新 opt-in）`);
  const scope = rec.scope || [];
  if (!scope.includes(SCOPE_SIGNAL_READ)) reasons.push(`scope 未含 ${SCOPE_SIGNAL_READ}`);
  if (rec.expiresAt && Date.parse(rec.expiresAt) < now) reasons.push(`已过期（${rec.expiresAt}）`);
  // 已撤回且未完成删除 → 也不允许（防止误用残留）
  if (rec.withdrawn && !rec.purgedAt) reasons.push('已撤回但数据尚未删除（须先完成 purge）');

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
    const item = { peer: rec.peer, withdrawnAt: rec.withdrawn.at, purgeDeadline: rec.purgeDeadline };
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
    purgeDeadline: rec.purgeDeadline,
    targets: rec.dataLocations || [],
    note: rec.dataLocations && rec.dataLocations.length
      ? '以上为登记的数据位置，删除后调 markPurged()'
      : '未登记任何数据副本位置（尚未取数，或已手工清除）',
    undeletable: rec.undeletable || [],
  };
}

module.exports = {
  CURRENT_NOTICE, SCOPE_SIGNAL_READ, PURGE_DEADLINE_HOURS, CONSENT_FILE,
  loadAll, saveAll, grant, withdraw, markPurged, checkConsent, listPendingPurge, purgePlan,
};
