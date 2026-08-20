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

/**
 * 追加一条原始流水（append-only，写入端不筛选）
 * @param {object} entry { session, type, content, meta, state }
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
  const dateStr = (record.ts.slice(0, 10));
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
 */
function markState(rawId, state) {
  if (!STATES.includes(state)) {
    throw new Error(`非法时态: ${state}（可选: ${STATES.join(' | ')}）`);
  }
  const record = get(rawId);
  if (!record) return { success: false, message: `未找到流水 ${rawId}` };

  // 重写该行（append-only 的例外：仅允许改 state/distilled_to 元字段）
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
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
  return { success: true, message: `${rawId} → ${state}` };
}

/**
 * 蒸馏链接（核心操作）：结论指回底仓 + 底仓自动封口
 * @param {string} rawId 底仓流水 id
 * @param {string} distilledId 蒸馏结论 id（core 记忆条目 id）
 * @returns {{success: boolean, message: string}}
 */
function link(rawId, distilledId) {
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
        r.state = 'sealed'; // 蒸馏完成即封口（自动触发）
        updated = true;
        return JSON.stringify(r);
      }
    } catch (e) { /* 保留原行 */ }
    return l;
  });
  fs.writeFileSync(file, out.join('\n') + '\n', 'utf8');
  return {
    success: updated,
    message: updated
      ? `✅ 流水 ${rawId} → 结论 ${distilledId}（已封口 sealed）`
      : `流水 ${rawId} 未更新`,
  };
}

/**
 * 底仓统计
 */
function stats() {
  ensureDir();
  const files = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.jsonl'));
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

module.exports = { append, query, get, markState, link, stats, hasRaw, help, setRawDir, getRawDir, RAW_DIR, STATES };
