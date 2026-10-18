#!/usr/bin/env node
/**
 * bid-connection.js — 连接级聚合视图（O6 · S1 · 2026-10-18）
 *
 * 目的：BID 的三维是**连接级**指标，但现有数据是**条目级**的 bid_signal。
 *       本模块把「条目 → 连接」聚合起来，作为 BID 计算层的输入。
 *
 * ⚠️ 视角纪律（一澜 2026-10-18 19:24 定 B+C 并行）：
 *   本模块只做 **C 视角（本地）**——只读本实例自己的记忆。
 *   - view 恒为 'local'
 *   - **D3 双向性不计算**（需双边数据，单边算出来的双向率是假的）
 *   - D1/D2 降级为「我方行为侧」
 *
 * 跨实例（B 视角）需 opt-in 同意机制，本模块**不涉及**。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { checkThreshold } = require('./bid-state');

const ROOT = path.join(__dirname, '..', '..');
const MEMORY_DIR = path.join(ROOT, 'data', 'a2a-memories');

const VIEW = { LOCAL: 'local', BILATERAL: 'bilateral' };

/**
 * 解析单个 agent 的记忆文件 → 条目数组（含 content）。
 * 与 core.get 同源逻辑，但保留 agent 归属，供聚合使用。
 */
function readAgentEntries(agentName, opts = {}) {
  const dir = opts.memoryDir || MEMORY_DIR;
  const fp = path.join(dir, `${agentName}.md`);
  if (!fs.existsSync(fp)) return [];
  const parts = fs.readFileSync(fp, 'utf8').split('\n---\n');
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p.includes('id:')) continue;
    const idM = p.match(/id:\s*"?([^"\n]+)"?/);
    if (!idM) continue;
    const sigM = p.match(/bid_signal:\s*(\{.*\})/);
    let sig = null;
    if (sigM) { try { sig = JSON.parse(sigM[1]); } catch { /* 坏字段跳过 */ } }
    let content = '';
    for (let j = i + 1; j < parts.length; j++) {
      const c = (parts[j] || '').trim();
      if (c && !c.includes('id:')) { content = c; break; }
    }
    out.push({
      id: idM[1],
      agent: agentName,
      timestamp: (p.match(/timestamp:\s*"?([^"\n]+)"?/) || [])[1] || '',
      type: (p.match(/type:\s*(\w+)/) || [])[1] || '',
      tags: ((p.match(/tags:\s*\[(.*?)\]/) || [])[1] || '').split(',').map(s => s.trim()).filter(Boolean),
      bid_signal: sig,
      content,
    });
  }
  return out;
}

/**
 * 把一个 agent 的全部条目按 peer 聚合成连接。
 *
 * @param {Array} entries readAgentEntries 的输出
 * @param {object} opts { self }
 * @returns {Array} 连接数组
 */
function aggregateConnections(entries, opts = {}) {
  const self = opts.self || 'self';
  const byPeer = new Map();

  for (const e of entries) {
    const sig = e.bid_signal;
    if (!sig || !sig.peer) continue;         // 无 peer 不入连接（无关系可归）
    if (sig.peer === self) continue;          // 自指不算连接

    if (!byPeer.has(sig.peer)) {
      byPeer.set(sig.peer, {
        peer: sig.peer,
        view: VIEW.LOCAL,
        self,
        entries: [],
        signals: { promise: 0, correction: 0, decision: 0 },
        states: { pending: 0, fulfilled: 0, overdue: 0, withdrawn: 0 },
        direction: { in: 0, out: 0, null: 0 },
        firstAt: null,
        lastAt: null,
        diffs: 0,
      });
    }
    const c = byPeer.get(sig.peer);
    c.entries.push(e);

    const kind = sig.kind || 'unknown';
    if (c.signals[kind] !== undefined) c.signals[kind]++;

    const st = sig.state || 'pending';
    if (c.states[st] !== undefined) c.states[st]++;

    if (kind === 'correction') {
      const d = sig.direction || 'null';
      if (c.direction[d] !== undefined) c.direction[d]++;
    }

    // 时间窗
    const t = e.timestamp;
    if (t) {
      if (!c.firstAt || t < c.firstAt) c.firstAt = t;
      if (!c.lastAt || t > c.lastAt) c.lastAt = t;
    }
    // 可 diff 痕迹：correction 类视为一次痕迹（改了东西才会有更正）
    if (kind === 'correction') c.diffs++;
  }

  // 补 interactions（本地可见的互动次数 = 该 peer 的信号条目数）
  for (const c of byPeer.values()) {
    c.interactions = c.entries.length;
    c.entryCount = c.entries.length;
  }

  return [...byPeer.values()].sort((a, b) => b.entryCount - a.entryCount);
}

/**
 * 计算单条连接的 BID 视图（**C 视角**）。
 *
 * 关键纪律：
 *   - D3 双向性**恒为 N/A**（单边数据算不出）
 *   - D1/D2 只报「我方行为侧」，标 local-only
 *   - 门槛不达标 → 全部 N/A + 「数据不足 · 不评」
 *
 * @returns {object} 视图对象
 */
function connectionView(conn, opts = {}) {
  const now = opts.now || Date.now();
  const gate = checkThreshold({
    firstAt: conn.firstAt,
    lastAt: conn.lastAt,
    interactions: conn.interactions,
    diffs: conn.diffs,
  }, { now, ...opts });

  const base = {
    peer: conn.peer,
    view: conn.view,
    window: { first: conn.firstAt, last: conn.lastAt, days: gate.metrics.days },
    raw: {
      signals: conn.signals,
      states: conn.states,
      direction: conn.direction,
      interactions: conn.interactions,
      diffs: conn.diffs,
    },
    gate: { assessable: gate.assessable, label: gate.label, reasons: gate.reasons },
  };

  if (!gate.assessable) {
    return { ...base, D1: 'N/A', D2: 'N/A', D3: 'N/A', note: '数据不足 · 不评' };
  }

  // D1 方向性 —— 本地视角只能看我方行为侧
  //   可观测：我方发出的更正（out） vs 对方更正我方（in）
  //   ⚠️ 这不是完整的 D1，只是「我方行为侧」
  const outN = conn.direction.out;
  const inN = conn.direction.in;
  const D1 = {
    scope: 'local-only',
    note: '仅我方行为侧，非完整方向性',
    correctionOut: outN,
    correctionIn: inN,
    // 去刻度：只给质性标签（v3.2 §8）
    label: outN > 0 || inN > 0
      ? (outN >= inN ? '有主动更正痕迹' : '接受对方更正痕迹')
      : '未见更正痕迹',
  };

  // D2 影响程度 —— 本地只能看我方留下的痕迹
  const D2 = {
    scope: 'local-only',
    note: '仅我方留下的痕迹',
    diffs: conn.diffs,
    label: conn.diffs >= 5 ? '痕迹较多' : conn.diffs >= 1 ? '有少量痕迹' : '未见痕迹',
  };

  // D3 双向性 —— 单边数据算不出，恒 N/A
  const D3 = 'N/A（需双边数据 · view=local）';

  return { ...base, D1, D2, D3 };
}

/**
 * 全量聚合：遍历所有 agent 文件，产出连接视图列表。
 */
function buildLocalViews(opts = {}) {
  const dir = opts.memoryDir || MEMORY_DIR;
  if (!fs.existsSync(dir)) return { connections: [], self: opts.self || null };

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  // 自指 = 条目最多的那个 agent（通常就是本实例）
  let self = opts.self;
  if (!self) {
    let max = 0;
    for (const f of files) {
      const e = readAgentEntries(f.replace('.md', ''), opts);
      if (e.length > max) { max = e.length; self = f.replace('.md', ''); }
    }
  }

  const all = [];
  for (const f of files) {
    const agent = f.replace('.md', '');
    if (agent !== self) continue;  // C 视角：只读本实例自己的记忆
    all.push(...readAgentEntries(agent, opts));
  }

  const conns = aggregateConnections(all, { self });
  return {
    self,
    view: VIEW.LOCAL,
    totalEntries: all.length,
    connections: conns.map(c => connectionView(c, { ...opts, self })),
    connectionsRaw: conns,
  };
}

module.exports = {
  VIEW, readAgentEntries, aggregateConnections, connectionView, buildLocalViews,
  MEMORY_DIR,
};
