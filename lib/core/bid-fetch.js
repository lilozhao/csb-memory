#!/usr/bin/env node
/**
 * bid-fetch.js — BID-A 跨实例信号取数（O6 · S4 · 2026-10-19）
 *
 * 一澜 2026-10-19 批：试点 = 若琢（先 1 个）· S4 开写。
 *
 * 协议（评审稿 v0.1 §2，待评审确认的条目按「更严」实现）：
 *   capability : bid_signal.read
 *   白名单字段 : kind / peer / direction / state / origin / at
 *   at 粒度    : 到日 YYYY-MM-DD（Q-S4-1）
 *   不缓存     : 每次现算（Q-S4-3）
 *   频率上限   : 每连接 24h ≤ 1 次全量（Q-S4-5）
 *   身份       : 以注册表登记地址为准，自报 sender 不认（Q-S4-4）
 *
 * 安全纪律：
 *   1. **发请求前**必须 checkConsent(peer).allowed —— 未同意连请求都不发（沉默不采）
 *   2. 响应落盘前做**字段白名单过滤**，越界字段直接丢弃并计数（不静默）
 *   3. 落盘的副本位置登记进同意记录的 dataLocations，撤回后 purge 才有得删
 *   4. 只追加、不改源；任何异常都如实记 failure，不吞
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const consent = require('./bid-consent');

const ROOT = path.join(__dirname, '..', '..');
const WORKSPACE = path.join(ROOT, '..');
const STORE_DIR = path.join(ROOT, 'data', 'bid-remote');
const REGISTRY = process.env.A2A_REGISTRY_URL || 'http://172.28.0.4:3099';
const CAPABILITY = 'bid_signal.read';
const FIELDS = ['kind', 'peer', 'direction', 'state', 'origin', 'at'];
const MIN_INTERVAL_HOURS = 24;

// ── 工具 ────────────────────────────────────────────────

function dayOf(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/** 白名单过滤：只留六个字段，越界计数如实返回（不静默丢弃） */
function filterSignals(signals) {
  const kept = [];
  const dropped = [];
  for (const s of Array.isArray(signals) ? signals : []) {
    if (!s || typeof s !== 'object') { dropped.push({ reason: 'not-object' }); continue; }
    const extra = Object.keys(s).filter(k => !FIELDS.includes(k));
    const o = {};
    for (const k of FIELDS) if (s[k] !== undefined) o[k] = s[k];
    if (o.at) o.at = dayOf(o.at) || o.at;          // Q-S4-1：粒度收窄到日
    kept.push(o);
    if (extra.length) dropped.push({ fields: extra });   // 不丢整条，但记录越界
  }
  return { kept, dropped };
}

/** 以注册表登记地址为准（Q-S4-4）：解析 peer → url */
async function resolvePeer(peer, opts = {}) {
  const registry = opts.registry || REGISTRY;
  const res = await fetch(`${registry}/agents`, { signal: AbortSignal.timeout(opts.timeoutMs || 8000) });
  if (!res.ok) throw new Error(`注册表不可用：HTTP ${res.status}`);
  const body = await res.json();
  const list = Array.isArray(body) ? body : (body.agents || []);
  const hit = list.find(a => a.name === peer);
  if (!hit) throw new Error(`注册表无此 agent：${peer}（未登记即不认）`);
  const url = hit.url || `http://${hit.host}:${hit.port}`;
  return { peer, url, version: hit.version, registeredAt: hit.registeredAt };
}

/** 频率闸（Q-S4-5）：每连接每 24h ≤ 1 次全量 */
function rateGate(peer, opts = {}) {
  const dir = opts.storeDir || STORE_DIR;
  const f = path.join(dir, `${peer}.json`);
  if (!fs.existsSync(f)) return { allowed: true, lastAt: null };
  try {
    const prev = JSON.parse(fs.readFileSync(f, 'utf8'));
    const last = prev.receipt && prev.receipt.generatedAt;
    if (!last) return { allowed: true, lastAt: null };
    const gapH = (Date.now() - Date.parse(last)) / 3600000;
    if (gapH < MIN_INTERVAL_HOURS) {
      return { allowed: false, lastAt: last, reason: `距上次取数 ${gapH.toFixed(1)}h < ${MIN_INTERVAL_HOURS}h 上限` };
    }
    return { allowed: true, lastAt: last };
  } catch {
    return { allowed: true, lastAt: null, note: '上次记录损坏，按可执行处理' };
  }
}

// ── 主流程 ──────────────────────────────────────────────

/**
 * 向单个 peer 取信号。
 * @param {string} peer 对端 agent 名
 * @param {object} opts { since, until, self, dry, storeDir, registry }
 */
async function fetchFrom(peer, opts = {}) {
  const self = opts.self || '若兰';
  const since = opts.since || '1970-01-01';
  const until = opts.until || dayOf(new Date());

  // ① 同意闸 —— 未同意，连请求都不发
  const cs = consent.checkConsent(peer, opts.consentOpts || {});
  if (!cs.allowed) {
    return { peer, ok: false, stage: 'consent', reasons: cs.reasons };
  }

  // ② 频率闸
  const rate = rateGate(peer, opts);
  if (!rate.allowed) {
    return { peer, ok: false, stage: 'rate', reasons: [rate.reason] };
  }

  // ③ 身份解析 —— 以注册表为准
  let target;
  try {
    target = await resolvePeer(peer, opts);
  } catch (e) {
    return { peer, ok: false, stage: 'resolve', reasons: [e.message] };
  }

  const payload = {
    jsonrpc: '2.0',
    method: 'SendMessage',
    id: `bid-fetch-${crypto.randomUUID()}`,
    params: {
      message: {
        role: 'user',
        messageId: `bid-fetch-${crypto.randomUUID()}`,
        parts: [{ type: 'text', text: `BID 信号读取请求（${since} ~ ${until}）· 仅 bid_signal 白名单字段 · 依据 ${consent.CURRENT_NOTICE}（${consent.CURRENT_NOTICE_VERSION}）` }],
        metadata: {
          capability: CAPABILITY,
          sender: self,
          params: { since, until, peer: self },
        },
      },
    },
  };

  if (opts.dry) {
    return { peer, ok: true, stage: 'dry', target, payload, rate };
  }

  // ④ 发请求
  let raw;
  try {
    const res = await fetch(`${target.url}/a2a/json-rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(opts.timeoutMs || 30000),
    });
    const text = await res.text();
    if (!res.ok) {
      return { peer, ok: false, stage: 'http', reasons: [`HTTP ${res.status}: ${text.slice(0, 200)}`], target };
    }
    raw = JSON.parse(text);
  } catch (e) {
    return { peer, ok: false, stage: 'request', reasons: [e.message], target };
  }

  // ⑤ 解析 + 白名单过滤
  const remote = raw && (raw.result || raw);
  const signals = remote && (remote.signals || (remote.message && remote.message.signals)) || [];
  const { kept, dropped } = filterSignals(signals);
  const consentEcho = (remote && remote.consent) || null;
  const receipt = {
    count: kept.length,
    droppedFields: dropped,
    sha256: crypto.createHash('sha256').update(JSON.stringify(kept)).digest('hex'),
    generatedAt: new Date().toISOString(),
    noticeVersion: consent.CURRENT_NOTICE_VERSION,
  };

  const record = {
    peer,
    view: 'remote-granted',
    window: { since, until },
    consent: consentEcho,
    signals: kept,
    receipt,
    source: { url: target.url, version: target.version, registry: opts.registry || REGISTRY },
  };

  // ⑥ 落盘（只写副本，登记位置供 purge）
  const dir = opts.storeDir || STORE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${peer}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  // 副本位置必须登记 —— 登记失败是**安全问题**（撤回后删不掉），不能吞
  consent.registerDataLocation(peer, file, opts.consentOpts || {});

  return { peer, ok: true, stage: 'done', record, file, pendingEcho: !kept.length };
}

module.exports = {
  CAPABILITY, FIELDS, MIN_INTERVAL_HOURS, STORE_DIR, REGISTRY,
  filterSignals, resolvePeer, rateGate, fetchFrom,
};
