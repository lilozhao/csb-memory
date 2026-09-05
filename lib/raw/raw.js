/**
 * raw.js — CSB-Memory v1.1 全量底仓层（RAW）
 *
 * 金字塔最底层：原始证据底座，全量永久保存。
 *
 * 设计原则（MEM-012）：
 * - append-only 流水：写入端"笨"，不筛选、不蒸馏、不总结
 * - 全量永久：不分热冷；成本靠"降权"（移出索引）而非"删除"
 * - 时态三态：burning（燃烧）/ ash（灰烬）/ sealed（封口，蒸馏自动触发）
 * - derived_from 硬字段：蒸馏结论必须可溯源到底仓（双向链接 distilled_to）
 * - 私有边界：底仓不进 HIVE、不进传播协议
 *
 * 存储：memory/raw/YYYY-MM-DD.jsonl（按天分片，JSON Lines append-only）
 */

const fs = require('fs');
const path = require('path');

let RAW_DIR = path.join(__dirname, '..', '..', 'data', 'raw');

const STATES = ['burning', 'ash', 'sealed'];

// 测试/自定义目录（模块内部统一走此函数，避免 const 闭包问题）
function setRawDir(dir) {
  RAW_DIR = dir;
}

function getRawDir() {
  return RAW_DIR;
}

function ensureDir() {
  if (!fs.existsSync(RAW_DIR)) {
    fs.mkdirSync(RAW_DIR, { recursive: true });
  }
}

function dayFile(dateStr) {
  return path.join(RAW_DIR, `${dateStr}.jsonl`);
}

function now() {
  return new Date().toISOString();
}

function generateId() {
  return 'raw_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function evolutionId() {
  return 'evo_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

// ============================================
// P0-4 不可篡改进化日志（2026-09-05）
// 锚定：内容不可变（append-only）+ 变更审计流（哈希链）
// 设计：raw 行内容一经 append 永不修改；状态流转/蒸馏链接是
//   「机制运转」不是「内容修改」——保留原行更新，但每次变更
//   追加一条审计事件（action/from/to/intent/ts/prev_hash/hash），
//   篡改任一条 → verifyEvolution 必检出。修正/补记 = 新条目 + derived_from。
// ============================================

/** 变更审计流文件（与 raw 同目录） */
function evolutionFile() {
  return path.join(RAW_DIR, 'raw-evolution.jsonl');
}

/** 读取全部变更审计事件 */
function readEvolution() {
  const f = evolutionFile();
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean);
}

/** 追加一条变更审计事件（带哈希链） */
function appendEvolution(event) {
  ensureDir();
  const f = evolutionFile();
  let prevHash = 'GENESIS';
  const existing = readEvolution();
  if (existing.length) prevHash = existing[existing.length - 1].hash;
  const body = { ...event, ts: event.ts || now(), prev_hash: prevHash };
  const hash = require('crypto').createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const record = { ...body, hash };
  fs.appendFileSync(f, JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/**
 * 校验变更审计流哈希链（P0-4 · 篡改必检出）
 * @returns {{valid: boolean, count: number, brokenAt?: number, reason?: string}}
 */
function verifyEvolution() {
  const events = readEvolution();
  let prev = 'GENESIS';
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.prev_hash !== prev) return { valid: false, count: events.length, brokenAt: i, reason: 'hash_chain_broken' };
    const { hash, ...rest } = e;
    const calc = require('crypto').createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    if (calc !== hash) return { valid: false, count: events.length, brokenAt: i, reason: 'entry_tampered' };
    prev = hash;
  }
  return { valid: true, count: events.length };
}

/** 变更审计统计 */
function evolutionStats() {
  const events = readEvolution();
  const byAction = {};
  for (const e of events) byAction[e.action] = (byAction[e.action] || 0) + 1;
  const chain = verifyEvolution();
  return { total: events.length, byAction, chainValid: chain.valid };
}

/**
 * 原子写文件（临时文件 + rename，防写一半损坏）
 */
function atomicWrite(file, content) {
  const tmp = file + '.tmp' + Date.now();
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, file);
}

/**
 * 追加一条原始流水（append-only，写入端不筛选）
 * @param {object} entry { session, type, content, meta, state, intent, mutations_tried, outcome, derived_from }
 *   - intent / mutations_tried / outcome：EvolutionEvent 式审计字段（P0-4，可选）
 *   - derived_from：修正/补记时指回旧条目（P0-4：修改 = 新条目 + derived_from，禁止原地改旧内容）
 * @returns {object} 写入的完整流水条目
 */
function append(entry = {}) {
  if (!entry.content) {
    throw new Error('缺少必填字段: content（底仓写入端不做筛选，但必须有内容）');
  }
  ensureDir();
  const record = {
    id: generateId(),
    ts: entry.ts || now(),
    session: entry.session || 'unknown',
    type: entry.type || 'conversation',
    content: entry.content,
    state: STATES.includes(entry.state) ? entry.state : 'burning',
    distilled_to: entry.distilled_to || [],
    meta: entry.meta || {},
  };
  // P0-4：EvolutionEvent 审计字段（有才写，向后兼容）
  const evo = {};
  if (entry.intent !== undefined) evo.intent = entry.intent;
  if (entry.mutations_tried !== undefined) evo.mutations_tried = entry.mutations_tried;
  if (entry.outcome !== undefined) evo.outcome = entry.outcome;
  if (Object.keys(evo).length) record.evolution = evo;
  // P0-4：修正/补记溯源（修改 = 新条目 + derived_from）
  if (entry.derived_from) {
    record.derived_from = Array.isArray(entry.derived_from) ? entry.derived_from : [entry.derived_from];
  }
  // P0-2：可核实证据（晋升门槛字段，有才写，向后兼容）
  if (entry.verification_evidence !== undefined) {
    record.verification_evidence = entry.verification_evidence;
  }
  const dateStr = record.ts.slice(0, 10);
  fs.appendFileSync(dayFile(dateStr), JSON.stringify(record) + '\n', 'utf8');
  return record;
}

/**
 * 读取某天的流水（可过滤）
 * @param {string} dateStr 日期 YYYY-MM-DD（默认今天）
 * @param {object} opts { state, keyword, session, limit }
 * @returns {Array<object>}
 */
function query(dateStr, opts = {}) {
  const d = dateStr || new Date().toISOString().slice(0, 10);
  const file = dayFile(d);
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let results = lines.map((l) => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);

  if (opts.state) results = results.filter((r) => r.state === opts.state);
  if (opts.session) results = results.filter((r) => r.session === opts.session);
  if (opts.keyword) {
    const kw = opts.keyword.toLowerCase();
    results = results.filter((r) => r.content.toLowerCase().includes(kw));
  }
  if (opts.limit) results = results.slice(-opts.limit);
  return results;
}

/**
 * 读取单条流水（按 id 全量扫描——底仓无索引，检索靠扫描/指回）
 */
function get(rawId) {
  if (!rawId) return null;
  const dir = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.jsonl'));
  for (const f of dir) {
    const lines = fs.readFileSync(path.join(RAW_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const r = JSON.parse(l);
        if (r.id === rawId) return r;
      } catch (e) { /* 跳过坏行 */ }
    }
  }
  return null;
}

/**
 * 标记时态（burning / ash / sealed）
 * 注：sealed 通常由 link() 蒸馏时自动触发，也可手动
 * P0-4：状态流转 = 机制运转，保留原行更新（原子写），每次变更追加审计事件（哈希链）
 * @param {string} rawId 流水 id
 * @param {string} state 目标时态
 * @param {object} [opts] { intent } 变更意图（EvolutionEvent 审计字段）
 */
function markState(rawId, state, opts = {}) {
  if (!STATES.includes(state)) {
    throw new Error(`非法时态: ${state}（可选: ${STATES.join(' | ')}）`);
  }
  const record = get(rawId);
  if (!record) return { success: false, message: `未找到流水 ${rawId}` };
  if (record.state === state) {
    return { success: false, message: `${rawId} 已是 ${state}，无变更` };
  }
  const from = record.state;

  // 原子重写该行（append-only 的机制例外：仅 state 字段；内容/derived_from 不变）
  const file = dayFile(record.ts.slice(0, 10));
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const out = lines.map((l) => {
    try {
      const r = JSON.parse(l);
      if (r.id === rawId) {
        r.state = state;
        return JSON.stringify(r);
      }
    } catch (e) { /* 保留原行 */ }
    return l;
  });
  atomicWrite(file, out.join('\n') + '\n');

  // P0-4：变更审计事件
  appendEvolution({
    id: evolutionId(),
    action: 'state_change',
    raw_id: rawId,
    from,
    to: state,
    intent: opts.intent || 'manual',
    outcome: 'success',
  });
  return { success: true, message: `${rawId} → ${state}` };
}

/**
 * 蒸馏链接（核心操作）：结论指回底仓 + 底仓自动封口
 * P0-4：保留原行更新（原子写），每次链接追加审计事件（哈希链）
 * @param {string} rawId 底仓流水 id
 * @param {string} distilledId 蒸馏结论 id（core 记忆条目 id）
 * @param {object} [opts] { intent } 变更意图
 * @returns {{success: boolean, message: string}}
 */
function link(rawId, distilledId, opts = {}) {
  const record = get(rawId);
  if (!record) return { success: false, message: `未找到流水 ${rawId}` };

  const file = dayFile(record.ts.slice(0, 10));
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  let updated = false;
  const out = lines.map((l) => {
    try {
      const r = JSON.parse(l);
      if (r.id === rawId) {
        if (!r.distilled_to.includes(distilledId)) {
          r.distilled_to.push(distilledId);
        }
        if (r.state !== 'sealed') r.state = 'sealed'; // 蒸馏完成即封口（自动触发）
        updated = true;
        return JSON.stringify(r);
      }
    } catch (e) { /* 保留原行 */ }
    return l;
  });
  atomicWrite(file, out.join('\n') + '\n');

  // P0-4：变更审计事件（幂等：已链接过的重复 link 不重复记录）
  if (updated && record.state !== 'sealed') {
    appendEvolution({
      id: evolutionId(),
      action: 'link',
      raw_id: rawId,
      from: record.state,
      to: 'sealed',
      distilled_id: distilledId,
      intent: opts.intent || 'dream-distill',
      outcome: 'success',
    });
  }
  return {
    success: updated,
    message: updated
      ? `✅ 流水 ${rawId} → 结论 ${distilledId}（已封口 sealed）`
      : `流水 ${rawId} 未更新`,
  };
}

/** 只列日期分片的 raw 文件（排除 raw-evolution.jsonl 等审计文件） */
function rawFiles() {
  return fs.readdirSync(RAW_DIR).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f));
}

/**
 * 底仓统计
 */
function stats() {
  ensureDir();
  const files = rawFiles();
  let total = 0;
  const byState = { burning: 0, ash: 0, sealed: 0 };
  for (const f of files) {
    const lines = fs.readFileSync(path.join(RAW_DIR, f), 'utf8').split('\n').filter(Boolean);
    for (const l of lines) {
      try {
        const r = JSON.parse(l);
        total++;
        if (byState[r.state] !== undefined) byState[r.state]++;
      } catch (e) { /* 跳过坏行 */ }
    }
  }
  return { files: files.length, total, byState };
}

/**
 * 删除前校验（MEM-006 7.3 红线）：物理删除前必须确认底仓有原始记录
 * @param {string} rawId 待校验的底仓流水 id
 * @returns {boolean} 底仓中存在该原始记录
 */
function hasRaw(rawId) {
  return get(rawId) !== null;
}

function help() {
  return [
    'raw 命令：',
    '  raw.append({content, session, type}) — 追加原始流水（写入端笨）',
    '  raw.query(date, {state, keyword})    — 按天/状态/关键词检索',
    '  raw.get(rawId)                       — 按 id 读取单条',
    '  raw.markState(rawId, state)          — 标记时态（burning/ash/sealed）',
    '  raw.link(rawId, distilledId)         — 蒸馏链接（自动封口）',
    '  raw.stats()                          — 统计',
    '  raw.hasRaw(rawId)                    — 删除前校验（红线）',
  ].join('\n');
}

module.exports = { append, query, get, markState, link, stats, hasRaw, help, setRawDir, getRawDir, RAW_DIR, STATES, appendEvolution, verifyEvolution, evolutionStats, readEvolution, atomicWrite };
