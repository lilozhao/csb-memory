/**
 * experience.js — CSB-Memory EXPERIENCE 层（第四层 · Harness² C3）
 *
 * 定位：raw / core / hive 之外的**语义层**——不是新存储，是把"我学到怎么做"这件事
 *       变成可溯源、可失效、可审计的条目。
 *
 * 设计依据：
 *   - Harness²（arxiv 2610.14224）C3 记忆组件 · 拆解数据：技能类经验最吃重（−5.3pp）
 *   - CSB 三条红线之三：无 provenance 的经验一律不入库
 *   - CSB-Map-v2 §3：优先沉淀**技能级**（scenario-scoped）而非任务级经验
 *
 * 强制字段（缺任一 → 拒绝入库 + 计分，不静默丢弃 · 见 CSB 工程契约 P1）：
 *   scenario      场景（技能级经验必须说明"这类任务"，不是"这次任务"）
 *   provenance    来源（raw 条目 id 或外部引用，必须有出处）
 *   expiry        有效期（ISO 日期或 {kind:'never'}；缺省不允许）
 *   side_effects  副作用（哪怕是 "none"，也得显式写）
 *
 * 存储：data/experience/YYYY-MM.jsonl（按月分片，append-only）
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let EXP_DIR = path.join(__dirname, '..', '..', 'data', 'experience');

const SCOPES = ['skill', 'task'];        // skill = 可迁移的"这类任务" · task = 一次性的"这次任务"
const LEVELS = ['high', 'medium', 'low'];

/** 测试/自定义目录 */
function setExpDir(dir) { EXP_DIR = dir; }
function getExpDir() { return EXP_DIR; }

function ensureDir() {
  if (!fs.existsSync(EXP_DIR)) fs.mkdirSync(EXP_DIR, { recursive: true });
}

function monthFile(dateStr) {
  return path.join(EXP_DIR, `${(dateStr || now()).slice(0, 7)}.jsonl`);
}

function now() { return new Date().toISOString(); }

function generateId() {
  return 'exp_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex');
}

/**
 * 校验一条经验是否允许入库（纯函数，不写盘 · 便于单测与复用）
 *
 * @param {Object} entry
 * @returns {{valid: boolean, errors: Array<{code: string, field?: string, message: string}>}}
 */
function validateEntry(entry = {}) {
  const errors = [];
  const push = (code, field, message) => errors.push({ code, field, message });

  // ── 强制字段（红线之三）──────────────────────────────
  if (!entry.scenario || typeof entry.scenario !== 'string' || !entry.scenario.trim()) {
    push('MISSING_SCENARIO', 'scenario', '缺少场景：经验必须说明适用场景（技能级写"这类任务"）');
  }

  if (!entry.provenance || (typeof entry.provenance === 'string' && !entry.provenance.trim())) {
    push('MISSING_PROVENANCE', 'provenance', '缺少来源：无 provenance 的经验一律不入库（红线之三）');
  } else if (typeof entry.provenance === 'object' && !Array.isArray(entry.provenance)) {
    const p = entry.provenance;
    const hasRef = (p.raw_ids && p.raw_ids.length) || p.ref || p.source;
    if (!hasRef) {
      push('EMPTY_PROVENANCE', 'provenance', '来源对象为空：需 raw_ids / ref / source 至少一项');
    }
  }

  // ── 有效期 ──────────────────────────────────────────
  if (entry.expiry === undefined || entry.expiry === null) {
    push('MISSING_EXPIRY', 'expiry', '缺少有效期：写 {kind:"never"} 也必须显式声明');
  } else if (typeof entry.expiry === 'object') {
    if (entry.expiry.kind === 'date') {
      if (!entry.expiry.at || Number.isNaN(Date.parse(entry.expiry.at))) {
        push('BAD_EXPIRY', 'expiry', 'expiry.kind=date 需要合法的 at（ISO 日期）');
      }
    } else if (entry.expiry.kind !== 'never') {
      push('BAD_EXPIRY', 'expiry', 'expiry.kind 只接受 date | never');
    }
  } else {
    push('BAD_EXPIRY', 'expiry', 'expiry 必须是对象 {kind:"date"|"never"}');
  }

  // ── 副作用（必须显式，哪怕 none）────────────────────
  if (entry.side_effects === undefined || entry.side_effects === null) {
    push('MISSING_SIDE_EFFECTS', 'side_effects', '缺少副作用声明：无副作用也要显式写 []');
  } else if (!Array.isArray(entry.side_effects)) {
    push('BAD_SIDE_EFFECTS', 'side_effects', 'side_effects 必须是数组（无副作用写 []）');
  }

  // ── 内容 ────────────────────────────────────────────
  if (!entry.lesson || typeof entry.lesson !== 'string' || !entry.lesson.trim()) {
    push('MISSING_LESSON', 'lesson', '缺少经验正文 lesson');
  }

  // ── 非强制但校验格式 ────────────────────────────────
  if (entry.scope && !SCOPES.includes(entry.scope)) {
    push('BAD_SCOPE', 'scope', `scope 只接受 ${SCOPES.join(' | ')}`);
  }
  if (entry.confidence && !LEVELS.includes(entry.confidence)) {
    push('BAD_CONFIDENCE', 'confidence', `confidence 只接受 ${LEVELS.join(' | ')}`);
  }
  if (entry.derived_from !== undefined && !Array.isArray(entry.derived_from)) {
    push('BAD_DERIVED_FROM', 'derived_from', 'derived_from 必须是数组');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 写入一条经验。校验失败 → 抛错并带 code（调用方负责计分上报，不静默吞）
 *
 * @param {Object} entry
 * @param {Object} [opts]
 * @param {boolean} [opts.dryRun] 只校验不写盘
 */
function add(entry = {}, opts = {}) {
  const result = validateEntry(entry);
  if (!result.valid) {
    const err = new Error('经验入库被拒: ' + result.errors.map(e => e.code).join(', '));
    err.code = 'EXPERIENCE_REJECTED';
    err.details = result.errors;
    throw err;
  }
  if (opts.dryRun) return { ...result, record: null };

  ensureDir();
  const ts = entry.ts || now();
  const evo = entry.evolution || {};
  const body = {
    id: entry.id || generateId(),
    ts,
    scope: entry.scope || 'skill',
    scenario: entry.scenario,
    lesson: entry.lesson,
    provenance: entry.provenance,
    expiry: entry.expiry,
    side_effects: entry.side_effects,
    confidence: entry.confidence || 'medium',
    derived_from: entry.derived_from || [],
    intent: evo.intent,
    outcome: evo.outcome,
    meta: entry.meta || {},
  };
  // 去掉 undefined 键，保证哈希稳定
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);

  const hash = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
  const record = { ...body, hash };

  fs.appendFileSync(monthFile(ts), JSON.stringify(record) + '\n', 'utf8');
  return { ...result, record };
}

/** 读取某月全部经验 */
function readMonth(month) {
  const f = path.join(EXP_DIR, `${month}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/** 列出全部经验（跨月） */
function list() {
  if (!fs.existsSync(EXP_DIR)) return [];
  return fs.readdirSync(EXP_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .flatMap(f => readMonth(f.replace('.jsonl', '')));
}

/** 按场景检索（skill 级优先） */
function query(text, opts = {}) {
  const kw = String(text || '').toLowerCase();
  const out = list().filter(e => {
    if (opts.scope && e.scope !== opts.scope) return false;
    return (e.scenario + ' ' + e.lesson).toLowerCase().includes(kw);
  });
  // 技能级优先，其次置信度
  const rank = { skill: 0, task: 1 };
  const conf = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) =>
    (rank[a.scope] ?? 9) - (rank[b.scope] ?? 9) ||
    (conf[a.confidence] ?? 9) - (conf[b.confidence] ?? 9)
  );
}

/** 已过期的经验（expiry.kind=date 且 at < now）——调用方决定降权或提示 */
function expired(at) {
  const t = at ? Date.parse(at) : Date.now();
  return list().filter(e =>
    e.expiry && e.expiry.kind === 'date' && Date.parse(e.expiry.at) < t
  );
}

/**
 * H0 启动：只查经验、不继承成品
 * 语义：新任务不复制旧产物，只读"这类事该怎么办"
 */
function bootstrap(scenarioText, opts = {}) {
  return query(scenarioText, { scope: 'skill', ...opts }).slice(0, opts.limit || 5);
}

/** 完整性自检：哈希重算 + 强制字段复查（防手改 / 防绕过 add 写入） */
function verify() {
  const entries = list();
  const broken = [];
  for (const e of entries) {
    const { hash, ...rest } = e;
    const calc = crypto.createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    if (calc !== hash) broken.push({ id: e.id, reason: 'tampered' });
    const v = validateEntry(e);
    if (!v.valid) broken.push({ id: e.id, reason: 'invalid', errors: v.errors.map(x => x.code) });
  }
  return { valid: broken.length === 0, count: entries.length, broken };
}

module.exports = {
  add, validateEntry, list, query, readMonth, expired, bootstrap, verify,
  setExpDir, getExpDir,
  SCOPES, LEVELS,
};
