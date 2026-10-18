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

  // ⛔ 标记必须**直接修饰本条目对象**（首字符 / 紧跟 promise 动作），
  // 且不得位于「某项目被否决」这类列表语境里。
  // 反例（实测误判）：'TODO：N-2 行改 ⛔ 否决' —— ⛔ 说的是 N-2，不是这条承诺。
  const leadingMarker = /^\s*⛔/.test(text) || /(?:承诺|约定|答应).{0,6}⛔/.test(text);
  const listContext = /(?:TODO|待办|行改|清单|列表|条目 \d|N-\d)/.test(text);
  if (leadingMarker && !listContext) return { type: 'marker', ref: '⛔ 终止标记', matched: '⛔' };

  // 正文撤回必须与承诺同一主语/同一对象
  if (/(?:我|我方|本人).{0,10}(?:主动撤回|撤回(?:该|这份|上述)?承诺|放弃该约定)/.test(text))
    return { type: 'text', ref: '正文撤回表述', matched: '撤回' };
  if (/撤回(?:该|这份|上述)承诺/.test(text))
    return { type: 'text', ref: '正文撤回表述', matched: '撤回' };

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
  // kinds：限定补落哪类信号（默认全部）。空数组 = 不补
  const kinds = Array.isArray(opts.kinds) && opts.kinds.length ? new Set(opts.kinds) : null;
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
      if (kinds && !kinds.has(sig.kind)) continue; // 按需限定类别
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


// ── ③ 存量重判（O1 · 2026-10-18） ────────────────────────

/**
 * 用**当前词表**重判存量已带 bid_signal 的条目。
 * v2.0 词表只在新增时生效，存量仍是 v1.0 判的 → 本命令负责对齐。
 *
 * 行为：
 *   - 重判后无信号 → **移除** bid_signal 字段（误报清理）
 *   - 重判后 kind 变了 → 更新 kind（并重置 direction，因其依赖 kind）
 *   - 重判同类且 peer/direction 未变 → 不动（幂等）
 *
 * @returns {{scanned:number, removed:number, rekinded:number, kept:number, changes:Array}}
 */
function rescore(opts = {}) {
  const dryRun = !!opts.dryRun;
  const memoryDir = opts.memoryDir || MEMORY_DIR;
  const result = { scanned: 0, removed: 0, rekinded: 0, kept: 0, changes: [] };
  if (!fs.existsSync(memoryDir)) return result;

  for (const f of fs.readdirSync(memoryDir).filter(x => x.endsWith('.md') && !x.endsWith('.bak'))) {
    const fp = path.join(memoryDir, f);
    let text = fs.readFileSync(fp, 'utf8');
    const parts = text.split('\n---\n');
    let dirty = false;

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.includes('id:') || !p.includes('bid_signal:')) continue;
      const idM = p.match(/id:\s*"?([^"\n]+)"?/);
      const sigM = p.match(/bid_signal:\s*(\{.*\})/);
      if (!idM || !sigM) continue;
      let old;
      try { old = JSON.parse(sigM[1]); } catch { continue; }
      result.scanned++;

      // 正文与 tags
      let content = '';
      for (let j = i + 1; j < parts.length; j++) {
        const c = (parts[j] || '').trim();
        if (c && !c.includes('id:')) { content = c; break; }
      }
      const tagsM = p.match(/tags:\s*\[(.*?)\]/);
      const tags = tagsM ? tagsM[1].split(',').map(t => t.trim()).filter(Boolean) : [];

      // 保留原有 origin（重判不改来源）
      const re = bidSignal.signalOf({ content, tags });
      const agent = f.replace('.md', '');

      if (!re) {
        // 误报 → 摘字段
        const next = p.replace(/\n?bid_signal:\s*\{.*\}/, '');
        if (next !== p) {
          parts[i] = next; dirty = true;
          result.removed++;
          result.changes.push({ id: idM[1], agent, action: 'removed', from: old.kind });
          if (!dryRun) {
            audit.log('memory.bid_rescore.remove', {
              entry_id: idM[1], agent, before_kind: old.kind,
              reason: 'SPEC-MEM-0001 v2.0 重判：当前词表不再认定为信号（存量误报清理）',
            }, '若兰', agent, 'success');
          }
        }
        continue;
      }

      if (old.origin) re.origin = old.origin;
      // state 已有终态则保留（重判只管 kind，不倒退状态）
      if (old.state && old.state !== 'pending') re.state = old.state;

      if (re.kind !== old.kind) {
        parts[i] = p.replace(/bid_signal:\s*\{.*\}/, `bid_signal: ${JSON.stringify(re)}`);
        dirty = true;
        result.rekinded++;
        result.changes.push({ id: idM[1], agent, action: 'rekind', from: old.kind, to: re.kind });
        if (!dryRun) {
          audit.log('memory.bid_rescore.rekind', {
            entry_id: idM[1], agent, before: old.kind, after: re.kind,
            reason: 'SPEC-MEM-0001 v2.0 重判：类别变更',
          }, '若兰', agent, 'success');
        }
      } else {
        result.kept++;
      }
    }
    if (dirty && !dryRun) fs.writeFileSync(fp, parts.join('\n---\n'));
  }
  return result;
}

// ── ④ 去重护栏（O3 · 2026-10-18） ────────────────────────

/**
 * 扫描重复正文（同一 agent 内，前 N 字相同者视为重复）。
 * 只读统计，不删不改 —— 供人工确认后再定处理策略。
 *
 * 设计理由：同一条「溢出告警：无」被记 6 次，若带信号会重复计入分母。
 * 但**不能自动删**（R9 不删除），所以先出报告。
 *
 * @returns {{total:number, dupGroups:number, dupEntries:number, groups:Array}}
 */
function findDuplicateTexts(opts = {}) {
  const memoryDir = opts.memoryDir || MEMORY_DIR;
  const prefixLen = opts.prefixLen || 60;
  const minCount = opts.minCount || 2;
  const result = { total: 0, dupGroups: 0, dupEntries: 0, groups: [] };
  if (!fs.existsSync(memoryDir)) return result;

  for (const f of fs.readdirSync(memoryDir).filter(x => x.endsWith('.md') && !x.endsWith('.bak'))) {
    const text = fs.readFileSync(path.join(memoryDir, f), 'utf8');
    const parts = text.split('\n---\n');
    const map = new Map();

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.includes('id:')) continue;
      result.total++;
      let content = '';
      for (let j = i + 1; j < parts.length; j++) {
        const c = (parts[j] || '').trim();
        if (c && !c.includes('id:')) { content = c; break; }
      }
      const key = (content || '').replace(/\s+/g, '').slice(0, prefixLen);
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({
        id: (p.match(/id:\s*"?([^"\n]+)"?/) || [])[1],
        hasSignal: p.includes('bid_signal:'),
        timestamp: (p.match(/timestamp:\s*"?([^"\n]+)"?/) || [])[1],
      });
    }

    for (const [key, entries] of map) {
      if (entries.length < minCount) continue;
      result.dupGroups++;
      result.dupEntries += entries.length;
      result.groups.push({ agent: f.replace('.md', ''), count: entries.length, sample: key.slice(0, 40), withSignal: entries.filter(e => e.hasSignal).length, entries });
    }
  }
  result.groups.sort((a, b) => b.count - a.count);
  return result;
}


// ── ⑤ 前置门槛（O4 · BID v3.2 §7 · 2026-10-18） ──────────

/**
 * BID §7 前置门槛：观测窗口 ≥30 天 · 双向互动 ≥10 次 · ≥1 条可 diff 痕迹。
 * 不达标 → **"数据不足 · 不评"**，绝不硬算。
 *
 * 规格原文：「硬评出来的分，会立刻变成表演目标。」
 * 本函数是那道门——它只回答"够不够"，不回答"好不好"。
 *
 * @param {object} conn 连接聚合数据
 *   { firstAt, lastAt, interactions, diffs }
 *   - firstAt/lastAt: 观测窗口起止（ISO 字符串或时间戳）
 *   - interactions: 双向互动次数（number）
 *   - diffs: 可 diff 痕迹条数（number）
 * @param {object} opts { now, minDays=30, minInteractions=10, minDiffs=1 }
 * @returns {{assessable:boolean, label:string, reasons:string[], metrics:object}}
 */
function checkThreshold(conn = {}, opts = {}) {
  const now = opts.now || Date.now();
  const minDays = opts.minDays ?? 30;
  const minInteractions = opts.minInteractions ?? 10;
  const minDiffs = opts.minDiffs ?? 1;

  const first = parseTime(conn.firstAt);
  const last = conn.lastAt ? parseTime(conn.lastAt) : now;
  const days = first === null ? 0 : Math.max(0, Math.floor(((last || now) - first) / DAY_MS));
  const interactions = Number(conn.interactions) || 0;
  const diffs = Number(conn.diffs) || 0;

  const reasons = [];
  if (days < minDays) reasons.push(`观测窗口 ${days} 天 < ${minDays} 天`);
  if (interactions < minInteractions) reasons.push(`双向互动 ${interactions} 次 < ${minInteractions} 次`);
  if (diffs < minDiffs) reasons.push(`可 diff 痕迹 ${diffs} 条 < ${minDiffs} 条`);

  const assessable = reasons.length === 0;
  return {
    assessable,
    label: assessable ? '可评估' : '数据不足 · 不评',
    reasons,
    metrics: { days, interactions, diffs, minDays, minInteractions, minDiffs },
  };
}

/**
 * 对一批连接跑门槛，产出**漏斗留痕**（v3.2 §7：须记录被挡掉的数量与占比）。
 * 被挡占比 > 50% → 触发门槛复审（规格要求「先查不改」）。
 *
 * @returns {{total:number, passed:number, blocked:number, blockedRatio:number, reviewTriggered:boolean, details:Array}}
 */
function thresholdFunnel(connections = [], opts = {}) {
  const details = connections.map(c => ({
    name: c.name || c.peer || '(unnamed)',
    ...checkThreshold(c, opts),
  }));
  const total = details.length;
  const passed = details.filter(d => d.assessable).length;
  const blocked = total - passed;
  const blockedRatio = total ? blocked / total : 0;
  const reviewTriggered = blockedRatio > (opts.reviewThreshold ?? 0.5);
  return { total, passed, blocked, blockedRatio, reviewTriggered, details };
}

module.exports = {
  backfill, resigil, rescore, findDuplicateTexts, checkThreshold, thresholdFunnel, decideState, extractDeadline, findFulfillAnchor, findWithdrawEvidence,
  loadLedgerAnchors, rewriteEntryState, tokensOf,
  DEFAULT_WINDOW_DAYS, TERMINAL, MEMORY_DIR, LEDGER,
};
