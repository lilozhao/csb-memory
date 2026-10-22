#!/usr/bin/env node
/**
 * bid-lexicon.js — RFC v2.2 P-11 / P-12 的**可执行判据**
 *
 * 缘起：RFC v2.2 §5「四题已决」，其中明德判据「**P-11 是根**」——
 *   P-10 的硬凑 peer/kind、P-13 的比条数，都是「词表没有位置约束」的下游症状。
 *   若只能先落一条，先落 P-11。
 *
 * 本文件做的事：把 §3.1 的口径声明从「YAML 里可选的注释」变成「机器能拒收的判据」。
 *
 * ── 三条已决项对应的三道门 ──────────────────────────────
 *   P-11  条目形式 = word + pos + require_next + evidence，**四者缺一不算条目**。
 *         「谓语」是描述，`require_next: /^(=|：|了)/` 才是判据（阿轩）。
 *   P-11+ polarity（墨丘）：断言 / 禁止 / 疑问；**禁止类命中一律不进档案，只进 known_fp**。
 *   P-12  known_misses / known_fp **强制非空**，且：
 *         · 「无」须带范围 + 样本量（否则等于短一点的「暂无」）
 *         · 空清单须写理由（允许空，不允许沉默）
 *         · 绑条数下限
 *
 * ── 设计立场（对齐工程契约 P1 / P2）──────────────────────
 *   P1「拒绝要计分」：任何拒收都**返回结构化 reasons[]**，不静默丢弃。
 *   P2「身份不许有默认值」：declaration.instance 必须显式给出，无默认值。
 *   BR-12：取不到就显式 unknown，不拿 null 冒充 0。
 *
 * 用途：
 *   const { validateDeclaration, checkEntry, applyPolarity, verifyEvidence } = require('./bid-lexicon');
 *   CLI: node lib/core/bid-lexicon.js <declaration.yaml|json>      → 0 通过 / 1 拒收 / 3 读不到
 *
 * 无第三方依赖（不引入 js-yaml；YAML 只解析本判据用到的子集）。
 *
 * 作者：若兰 🌸 · 2026-10-22 · W-16 后续
 */
'use strict';

const fs = require('fs');

// ── 枚举（封闭，不外扩）────────────────────────────────
// v2.5 补 `label`（行首标签位置）：「待办：」「结论：」这类不是谓/状/宾/定，
//   单列一类而非塞进 other —— 因为它的处置完全不同（见 POS_POLARITY_CONFLICT）。
const POS_ENUM = ['predicate', 'adverbial', 'object', 'attr', 'label', 'other'];
const POLARITY_ENUM = ['assertion', 'prohibition', 'question'];
// 位置文字面量（各家会写中文，映射到枚举，但**不猜**：认不出就是非法值）
const POS_ALIAS = {
  '谓语': 'predicate', '谓词': 'predicate', 'predicate': 'predicate',
  '状语': 'adverbial', '状语从句': 'adverbial', 'adverbial': 'adverbial',
  '宾语': 'object', 'object': 'object',
  '定语': 'attr', 'attr': 'attr',
  '标签': 'label', '行首标签': 'label', 'label': 'label',
  '其他': 'other', 'other': 'other',
};
// 位置 ↔ polarity 一致性（墨丘）：行首标签若标「断言」，等于把「待办：」当成事件断言
const POS_POLARITY_CONFLICT = { label: ['assertion'] };

/**
 * P-11 核心：一条词表条目是否成立。
 * @param {object} entry
 * @returns {{ok:boolean, reasons:string[], normalized?:object}}
 *
 * 判据（缺一不算条目）：
 *   ① word  非空
 *   ② pos   必须是 POS_ENUM 之一（中文别名归一；认不出 → 拒，不猜）
 *   ③ require_next 必须是**能编译的正则字面量**（/.../ 形式），且不是「匹配一切」的空壳
 *   ④ evidence 非空，且**是原文里真能命中这条 require_next 的那一句**（不是转述）
 */
function checkEntry(entry, opts = {}) {
  const reasons = [];
  if (!entry || typeof entry !== 'object') return { ok: false, reasons: ['entry 不是对象'] };

  // ① word
  const word = String(entry.word == null ? '' : entry.word).trim();
  if (!word) reasons.push('P-11.① word 为空');

  // ② pos
  const posRaw = String(entry.pos == null ? '' : entry.pos).trim();
  const pos = POS_ALIAS[posRaw] || (POS_ENUM.includes(posRaw) ? posRaw : null);
  if (!posRaw) reasons.push('P-11.② pos 缺失（「谓语」是描述，必须给出位置枚举）');
  else if (!pos) reasons.push(`P-11.② pos="${posRaw}" 不在枚举内，也不在别名表内——不猜，直接拒`);

  // ③ require_next 可执行
  let re = null;
  const rn = entry.require_next;
  if (rn == null || rn === '') {
    reasons.push('P-11.③ require_next 缺失（只写 pos 等于只写词形，拦不住误判）');
  } else {
    const src = String(rn).trim();
    // 只接受 /pattern/flags 字面量；裸字符串视为不可执行
    const m = src.match(/^\/(.*)\/([gimsuy]*)$/s);
    if (!m) {
      reasons.push('P-11.③ require_next 不是 /pattern/flags 形式，不可执行');
    } else {
      try {
        re = new RegExp(m[1], m[2].replace(/g/g, '')); // 去掉 g，避免 lastIndex 副作用
      } catch (e) {
        reasons.push(`P-11.③ require_next 正则编译失败：${e.message}`);
      }
      // 「匹配一切」的空壳：. * 或 .* 或 ^$ 之类——能编译但等于没有约束
      if (re && /^(?:\.\*?|\^\.\*|\^|\$)?$/.test(m[1])) {
        reasons.push('P-11.③ require_next 是空壳正则（匹配一切 = 没有位置约束）');
        re = null;
      }
    }
  }

  // ④ evidence 必须是真命中句
  const evidence = String(entry.evidence == null ? '' : entry.evidence).trim();
  if (!evidence) {
    reasons.push('P-11.④ evidence 缺失（至少一条实测句）');
  } else if (re && word) {
    // 判据：evidence 里要能**同时**找到 word 与 require_next 的命中
    const ev = verifyEvidence(word, re, evidence);
    if (!ev.wordHit) reasons.push('P-11.④ evidence 里没有 word 本身 → 不是这条词表的原文');
    else if (!ev.nextHit) reasons.push('P-11.④ evidence 命中了 word 但没满足 require_next → 这条条目在原文上不成立');
  }

  // polarity（P-11+ 墨丘）：缺失可接受（推荐字段），但**给了就必须合法**
  let polarity = null;
  const pr = String(entry.polarity == null ? '' : entry.polarity).trim();
  if (pr) {
    const alias = { '断言': 'assertion', '禁止': 'prohibition', '疑问': 'question' }[pr] || pr;
    if (!POLARITY_ENUM.includes(alias)) reasons.push(`P-11+.polarity="${pr}" 不合法（断言/禁止/疑问）`);
    else polarity = alias;
  }

  // 位置与极性一致性：标签位置不得标「断言」（否则「待办：」被当成事件断言）
  if (pos && polarity && (POS_POLARITY_CONFLICT[pos] || []).includes(polarity)) {
    reasons.push(`P-11+ pos=${pos}（行首标签位置）与 polarity=assertion 冲突：标签不是事件断言，应标禁止或疑问`);
  }

  const ok = reasons.length === 0;
  return { ok, reasons, normalized: ok ? { word, pos, require_next: String(rn).trim(), polarity, evidence } : undefined };
}

/**
 * 在句子里验证 word + require_next。位置语义：
 *   require_next 描述的是「word 之后紧跟什么」。
 *   故在 word 的每一处命中后面取窗口，看是否匹配 require_next。
 */
function verifyEvidence(word, re, evidence) {
  const out = { wordHit: false, nextHit: false, positions: [] };
  if (!word) return out;
  let idx = -1;
  const WINDOW = 12; // word 之后取 12 字判断「后继」
  while ((idx = evidence.indexOf(word, idx + 1)) !== -1) {
    out.wordHit = true;
    out.positions.push(idx);
    const after = evidence.slice(idx + word.length, idx + word.length + WINDOW);
    // 同时容忍「要求匹配 word 之后」与「模式含换行标记」两种写法
    if (re.test(after) || re.test(evidence.slice(idx))) { out.nextHit = true; break; }
  }
  return out;
}

/**
 * polarity 落档案判定（墨丘）：禁止类命中**一律不进档案，只进 known_fp**。
 * @returns {{accept:boolean, route:'archive'|'known_fp', reason:string}}
 */
function applyPolarity(polarity) {
  const p = String(polarity || '').trim();
  if (p === 'prohibition' || p === '禁止') {
    return { accept: false, route: 'known_fp', reason: 'P-11+ 禁止类命中不进档案（墨丘）：按词形读「禁测试帖」会被读成一次许可' };
  }
  if (p === 'question' || p === '疑问') {
    return { accept: false, route: 'known_fp', reason: 'P-11+ 疑问句不是事件断言，不进档案' };
  }
  return { accept: true, route: 'archive', reason: p ? '断言/未标注 → 可进档案' : '未标注 polarity → 按断言处理（推荐字段，不阻断）' };
}

/**
 * P-12：「无」的判据。
 *   「我在这批 N 条上没观察到 X」才是声明；
 *   没有范围和样本量的「无」，等于短一点的「暂无」（墨丘）。
 */
function checkEmptyClaim(value, opts = {}) {
  const reasons = [];
  const v = String(value == null ? '' : value).trim();
  if (!v) return { ok: false, reasons: ['P-12 空值（空清单须写理由，允许空不允许沉默——恺）'] };

  const isClaimNone = /^(无|没有|暂无|none|n\/a|NA)$/i.test(v);
  if (isClaimNone) {
    // 裸「无」= 未完成
    const scope = /\d|范围|这批|全部|条|次|个|篇|%|样本/.test(v);
    if (!scope) {
      reasons.push('P-12 裸「无」不带范围与样本量 → 等于「暂无」（墨丘）：须写成「在这批 N 条上没观察到 X」');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * P-12：known_misses / known_fp 清单整体校验（含条数下限）。
 */
function checkLimits(limits = {}) {
  const reasons = [];
  const MIN = Number.isFinite(limits.min_items) ? limits.min_items : 1;

  for (const key of ['known_misses', 'known_fp']) {
    const list = limits[key];
    const why = limits[`${key}_why`]; // 空清单的理由（恺）

    if (!Array.isArray(list)) {
      reasons.push(`P-12 ${key} 缺失（强制项，写不出说明还没真正理解自己的数据）`);
      continue;
    }
    if (list.length === 0) {
      // 允许空，不允许沉默
      if (!String(why || '').trim()) {
        reasons.push(`P-12 ${key} 为空且未写理由 → 沉默不可与「没做」区分（恺）`);
      }
      continue;
    }
    if (list.length < MIN) {
      reasons.push(`P-12 ${key} 只有 ${list.length} 条，低于下限 ${MIN}（阿轩：绑条数下限，否则空清单与不写清单等价）`);
    }
    // 每条须是对象且带可核对字段
    list.forEach((it, i) => {
      if (!it || typeof it !== 'object') { reasons.push(`P-12 ${key}[${i}] 不是对象`); return; }
      if (!it.sentence && !it.evidence && !it.type) {
        reasons.push(`P-12 ${key}[${i}] 没有实测句/证据字段（不算条目）`);
      }
    });
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * 口径声明整体校验（§3.1）。
 * P2 身份不许有默认值：instance 必须显式。
 */
function validateDeclaration(decl = {}) {
  const reasons = [];
  const details = {};

  if (!decl || typeof decl !== 'object') return { ok: false, reasons: ['declaration 不是对象'], details };

  // P2
  if (!String(decl.instance == null ? '' : decl.instance).trim()) {
    reasons.push('P2 instance 缺失（身份不许有默认值）');
  }

  // §3.1 corpus
  const corpus = decl.corpus || {};
  if (!['diary', 'system-log', 'mixed'].includes(String(corpus.type || ''))) {
    reasons.push('§3.1 corpus.type 必须是 diary | system-log | mixed');
  }
  if (!['file', 'section', 'entry'].includes(String(corpus.granularity || ''))) {
    reasons.push('§3.1 corpus.granularity 必须是 file | section | entry');
  }

  // P-11 entries
  const entries = decl.wordlist && decl.wordlist.entries;
  if (!Array.isArray(entries) || entries.length === 0) {
    reasons.push('P-11 entries 缺失或为空（词表条目是自解释的最小单位）');
  } else {
    const bad = [];
    entries.forEach((e, i) => {
      const r = checkEntry(e);
      if (!r.ok) bad.push({ index: i, word: e && e.word, reasons: r.reasons });
    });
    details.entries = { total: entries.length, invalid: bad.length, invalidList: bad };
    if (bad.length) {
      reasons.push(`P-11 ${bad.length}/${entries.length} 条词表条目不成立（word+pos+require_next+evidence 缺一不算）`);
    }
  }

  // P-12 limits
  const lim = checkLimits(decl.limits || {});
  details.limits = lim;
  if (!lim.ok) reasons.push(...lim.reasons);

  // §3.1 metadata 三行制（阿轩）：不报则不可被引用
  const md = decl.metadata || {};
  for (const k of ['genre', 'baseline', 'scope']) {
    if (!String(md[k] == null ? '' : md[k]).trim()) {
      reasons.push(`§3.1 metadata.${k} 缺失 → 不可被引用（口径元数据三行制）`);
    }
  }

  return { ok: reasons.length === 0, reasons, details };
}

// ── CLI ──────────────────────────────────────────────
function loadDecl(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (/\.json$/i.test(file) || raw.trim().startsWith('{')) return JSON.parse(raw);
  // 极简 YAML 子集：仅支持本判据需要的结构（instance/corpus/wordlist/limits/metadata）
  // 立场：解析不了就明确报错，不静默降级（P1）
  throw new Error('YAML 输入暂不支持（无第三方依赖）：请提供同结构的 JSON，或用 scripts/bid-declaration.js 生成');
}

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('用法: node lib/core/bid-lexicon.js <declaration.json>'); process.exit(3); }
  let decl;
  try { decl = loadDecl(file); }
  catch (e) { console.error('❌ 读不到/解析不了：' + e.message); process.exit(3); }

  const r = validateDeclaration(decl);
  if (r.ok) {
    console.log(`✅ 口径声明通过（P-11 / P-12 / metadata 三道门）`);
    console.log(`   instance=${decl.instance} · entries=${r.details.entries.total} 条全部成立`);
    process.exit(0);
  }
  console.error('❌ 口径声明被拒收（P1：拒绝要计分，逐条列理由）');
  r.reasons.forEach((x, i) => console.error(`   ${i + 1}. ${x}`));
  if (r.details.entries && r.details.entries.invalidList.length) {
    console.error('   ── 不成立的条目 ──');
    r.details.entries.invalidList.slice(0, 20).forEach(b => {
      console.error(`   [${b.index}] ${b.word || '(无 word)'}: ${b.reasons.join('；')}`);
    });
  }
  process.exit(1);
}

module.exports = {
  POS_ENUM, POLARITY_ENUM, POS_ALIAS,
  checkEntry, verifyEvidence, applyPolarity, checkEmptyClaim, checkLimits, validateDeclaration,
};
