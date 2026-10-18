#!/usr/bin/env node
/**
 * bid-state.js — 承诺四态回填 + 存量信号反抽（SPEC-MEM-0002 · 二期）
 *
 * 目的：一期（SPEC-MEM-0001）只落字段，`state` 恒为 `pending`
 *       —— 单条事件只知道「说了承诺」，不知道后来履约没有。
 *       本模块做两件事：
 *         ① 四态回填：把已存在**完成锚**关联到条目，pending → fulfilled / overdue / withdrawn
 *         ② 存量反抽：为无 bid_signal 的历史条目一次性补落信号（origin=backfill）
 *
 * 不新增采集：只关联既有数据源。
 *   - 完成锚：`logs/ledger.jsonl`（外部账本，哈希链）+ A2A 任务终态
 *   - 撤回证据：正文含 `⛔` 终止标记
 *   - 到期时限：正文显式时限（`YYYY-MM-DD` / `M月D日`），无则按 BID-H A2 默认 90 天窗口
 *
 * 纪律（对齐 spec 与 BR-12）：
 *   - **无锚不改判**（R5）：取不到锚一律保持 pending，绝不猜
 *   - **幂等**（R6）：只处理 state=pending 的条目，重跑零变更
 *   - **不删除**（R9）：只更新字段
 *   - **留痕**（R10）：每次 state 变更写 audit（旧值→新值 + 锚引用）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const audit = require('./audit-log');
const bidSignal = require('./bid-signal');

const ROOT = path.join(__dirname, '..', '..');
const WORKSPACE = path.join(ROOT, '..');
const MEMORY_DIR = path.join(ROOT, 'data', 'a2a-memories');
const LEDGER = path.join(WORKSPACE, 'logs', 'ledger.jsonl');

const DEFAULT_WINDOW_DAYS = 90; // BID-H A2（docs/bid-bond-impact-domain-draft-v3.md §2.3.2）
const TERMINAL = { FULFILLED: 'fulfilled', OVERDUE: 'overdue', WITHDRAWN: 'withdrawn', PENDING: 'pending' };

// ── 日期工具 ──────────────────────────────────────────────

function parseTime(ts) {
  if (!ts) return null;
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

const DAY_MS = 86400000;

/**
 * 从正文提取显式到期时限（「到期 / 截止 / due」语境下的日期）。
 * 无显式时限 → null（由窗口兜底，不猜）。
 */
function extractDeadline(entry) {
  const text = `${entry.content || ''} ${entry.title || ''}`;
  const m = text.match(/(?:到期|截止|期限|deadline|due)[^0-9]{0,10}(\d{4})-(\d{2})-(\d{2})/i);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2]}-${m[3]}T23:59:59`);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}

// ── 锚：ledger + 任务终态 ────────────────────────────────

/**
 * 读取 ledger（只读）。文件不存在或不可解析 → 返回空集（不报错、不猜）。
 */
function loadLedgerAnchors(ledgerPath = LEDGER) {
  if (!fs.existsSync(ledgerPath)) return [];
  const lines = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const e = JSON.parse(line);
      out.push({ seq: e.seq, ts: e.ts, action: e.action, target: e.target, reason: e.reason });
    } catch { /* 损坏行跳过，不让单行毒化整批 */ }
  }
  return out;
}

/**
 * 判断一条记忆是否命中了 ledger 完成锚。
 * 匹配规则（保守，宁可漏判不可错判）：
 *   - 锚时间必须 ≥ 承诺时间（履约在承诺之后）
 *   - 正文与锚的 target/reason 共享一个长度 ≥4 的中文实体词
 *   - 锚动作属于「完成类」（排除 spec.approve 这类「批准」语义）
 */
const ANCHOR_ACTIONS = /^(spec\.done|task\.(complete|completed|done)|repo\.mirror\.push|git\.push|doc\.update|script\.change|code\.patch|skill\.(install|update|publish)|cron\.(add|update|remove)|decision\.record|learning\.notes\.backfill)$/;
const STOPWORDS = new Set(['完成', '更新', '记忆', '条目', '内容', '任务', '方案', '实现', '落位', '记录', '系统']);

function tokensOf(s) {
  const out = [];
  const raw = String(s || '');
  // 抓 2-6 字的连续中文段，再滑窗切 ≥4 的片段
  for (const seg of raw.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    if (seg.length < 2) continue;
    if (seg.length <= 6) { if (seg.length >= 4) out.push(seg); continue; }
    for (let i = 0; i + 4 <= seg.length; i++) out.push(seg.slice(i, i + 4));
  }
  return out.filter(t => !STOPWORDS.has(t));
}

function findFulfillAnchor(entry, anchors) {
  const entryTime = parseTime(entry.timestamp);
  if (entryTime === null) return null;
  const et = tokensOf(`${entry.content || ''} ${entry.title || ''}`);
  if (!et.length) return null;

  for (const a of anchors) {
    if (!ANCHOR_ACTIONS.test(a.action || '')) continue;
    const at = parseTime(a.ts);
    if (at === null || at < entryTime) continue; // 履约必须在承诺之后
    const hay = `${a.target || ''} ${a.reason || ''}`;
    const hitTok = et.find(tok => hay.includes(tok));
    if (hitTok) return { type: 'ledger', ref: `ledger#${a.seq}`, action: a.action, matched: hitTok, ts: a.ts };
  }
  return null;
}

function findWithdrawEvidence(entry) {
  const text = `${entry.content || ''} ${entry.title || ''}`;
  if (text.includes('⛔')) return { type: 'marker', ref: '⛔ 终止标记', matched: '⛔' };
  if (/主动撤回|撤回承诺|放弃该约定/.test(text)) return { type: 'text', ref: '正文撤回表述', matched: '撤回' };
  return null;
}

// ── 判定核心（纯函数：输入条目 + 锚集 + 当前时间 → 新 state 或 null） ──

/**
 * @returns {{state:string, anchor:object}|null} null = 保持 pending（无锚不改判）
 */
function decideState(entry, anchors, now = Date.now(), windowDays = DEFAULT_WINDOW_DAYS) {
  const sig = entry.bid_signal;
  if (!sig || typeof sig !== 'object') return null;
  if (sig.kind !== 'promise') return null;               // R1：只扫 promise
  if (sig.state && sig.state !== TERMINAL.PENDING) return null; // R6：非 pending 不动

  // R4：撤回证据优先于履约（撤回了就不算完成）
  const wd = findWithdrawEvidence(entry);
  if (wd) return { state: TERMINAL.WITHDRAWN, anchor: wd };

  // R2：完成锚
  const anchor = findFulfillAnchor(entry, anchors);
  if (anchor) return { state: TERMINAL.FULFILLED, anchor };

  // R3：过期判定——仅在**显式时限**或**超出默认窗口**时成立
  const entryTime = parseTime(entry.timestamp);
  if (entryTime !== null) {
    const deadline = extractDeadline(entry);
    if (deadline !== null) {
      if (now > deadline) return { state: TERMINAL.OVERDUE, anchor: { type: 'deadline', ref: new Date(deadline).toISOString().slice(0, 10) } };
    } else if (now - entryTime > windowDays * DAY_MS) {
      return { state: TERMINAL.OVERDUE, anchor: { type: 'window', ref: `${windowDays}d` } };
    }
  }

  // R5：无锚 → 不改判
  return null;
}

// ── 落盘：更新单条条目的 front-matter state（不删除、只替换 state 片段） ──

function rewriteEntryState(text, entryId, newState) {
  const parts = text.split('\n---\n');
  let changed = false;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.includes(`id: "${entryId}"`) && !p.includes(`id: ${entryId}`)) continue;
    if (!p.includes('bid_signal:')) continue;
    const next = p.replace(/("state"\s*:\s*)"[^"]*"/, `$1"${newState}"`);
    if (next !== p) { parts[i] = next; changed = true; }
    break;
  }
  return changed ? parts.join('\n---\n') : null;
}

// ── ① 四态回填（R1–R6, R9, R10） ─────────────────────────

/**
 * @param {object} opts { now, windowDays, dryRun, ledgerPath, memoryDir }
 * @returns {{scanned:number, changed:number, byState:object, changes:Array}}
 */
function backfill(opts = {}) {
  const now = opts.now || Date.now();
  const windowDays = opts.windowDays || DEFAULT_WINDOW_DAYS;
  const dryRun = !!opts.dryRun;
  const memoryDir = opts.memoryDir || MEMORY_DIR;
  const anchors = loadLedgerAnchors(opts.ledgerPath || LEDGER);

  const result = { scanned: 0, changed: 0, byState: { fulfilled: 0, overdue: 0, withdrawn: 0, pending: 0 }, changes: [], totalBefore: 0, totalAfter: 0 };
  if (!fs.existsSync(memoryDir)) return result;

  const files = fs.readdirSync(memoryDir).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));

  for (const f of files) {
    const fp = path.join(memoryDir, f);
    let text = fs.readFileSync(fp, 'utf8');
    const parts = text.split('\n---\n');
    result.totalBefore += parts.filter(p => p.includes('id:')).length;

    let dirty = false;
    for (const p of parts) {
      if (!p.includes('id:') || !p.includes('bid_signal:')) continue;
      const idM = p.match(/id:\s*"?([^"\n]+)"?/);
      const sigM = p.match(/bid_signal:\s*(\{.*\})/);
      if (!idM || !sigM) continue;
      let sig;
      try { sig = JSON.parse(sigM[1]); } catch { continue; }
      if (sig.kind !== 'promise') continue;
      result.scanned++;

      const entry = { timestamp: (p.match(/timestamp:\s*"?([^"\n]+)"?/) || [])[1], bid_signal: sig, content: '' };
      // 正文：紧随其后的非 YAML 块
      const idx = parts.indexOf(p);
      for (let j = idx + 1; j < parts.length; j++) {
        const c = (parts[j] || '').trim();
        if (c && !c.includes('id:')) { entry.content = c; break; }
      }

      const dec = decideState(entry, anchors, now, windowDays);
      if (!dec) { result.byState.pending++; continue; }

      const nextText = rewriteEntryState(text, idM[1], dec.state);
      if (nextText) {
        text = nextText; dirty = true;
        result.changed++;
        result.byState[dec.state]++;
        const ch = {
          id: idM[1], agent: f.replace('.md', ''), from: sig.state || 'pending', to: dec.state,
          anchor: dec.anchor, hash: `${f}#${idM[1]}`,
        };
        result.changes.push(ch);
        if (!dryRun) {
          audit.log('memory.bid_state.change', {
            entry_id: idM[1], agent: ch.agent, before: sig.state || 'pending', after: dec.state,
            anchor: dec.anchor, reason: 'SPEC-MEM-0002 四态回填',
          }, '若兰', ch.agent, 'success');
        }
      }
    }
    if (dirty && !dryRun) fs.writeFileSync(fp, text);
  }

  result.totalAfter = result.totalBefore; // R9：不删除，条数恒定
  return result;
}

// ── ② 存量反抽（R7, R8） ─────────────────────────────────

/**
 * 为**无 bid_signal 字段**的历史条目补落信号（origin=backfill）。
 * @returns {{scanned:number, filled:number, entries:Array}}
 */
function resigil(opts = {}) {
  const dryRun = !!opts.dryRun;
  const memoryDir = opts.memoryDir || MEMORY_DIR;
  const result = { scanned: 0, filled: 0, entries: [] };
  if (!fs.existsSync(memoryDir)) return result;

  for (const f of fs.readdirSync(memoryDir).filter(x => x.endsWith('.md') && !x.endsWith('.bak'))) {
    const fp = path.join(memoryDir, f);
    let text = fs.readFileSync(fp, 'utf8');
    const parts = text.split('\n---\n');
    let dirty = false;

    for (const p of parts) {
      if (!p.includes('id:')) continue;
      if (p.includes('bid_signal:')) continue; // 已有字段 → 跳过（一次性语义）
      result.scanned++;

      const idx = parts.indexOf(p);
      let content = '';
      for (let j = idx + 1; j < parts.length; j++) {
        const c = (parts[j] || '').trim();
        if (c && !c.includes('id:')) { content = c; break; }
      }
      if (!content) continue;

      const tagsM = p.match(/tags:\s*\[(.*?)\]/);
      const tags = tagsM ? tagsM[1].split(',').map(s => s.trim()).filter(Boolean) : [];
      const sig = bidSignal.signalOf({ content, tags });
      if (!sig) continue;
      sig.origin = 'backfill'; // R8

      const next = p.replace(/(\n|^)(\s*)(access_count:)/, `$1$2bid_signal: ${JSON.stringify(sig)}$1$2$3`);
      if (next === p) continue;
      parts[parts.indexOf(p)] = next;
      dirty = true;
      result.filled++;
      result.entries.push({ id: (p.match(/id:\s*"?([^"\n]+)"?/) || [])[1], agent: f.replace('.md', ''), kind: sig.kind, peer: sig.peer });
    }
    if (dirty && !dryRun) fs.writeFileSync(fp, parts.join('\n---\n'));
  }
  return result;
}

module.exports = {
  backfill, resigil, decideState, extractDeadline, findFulfillAnchor, findWithdrawEvidence,
  loadLedgerAnchors, rewriteEntryState, tokensOf,
  DEFAULT_WINDOW_DAYS, TERMINAL, MEMORY_DIR, LEDGER,
};
