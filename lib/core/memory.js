#!/usr/bin/env node
/**
 * memory.js — CSB-Memory v0.4 本地 API 实现
 * 
 * 基于v0.2渐进升级，新增v0.4特性：
 *   - 结构性权重 (structural_weight, is_core_identity)
 *   - 溯源链 (provenance)
 *   - 权重衰减遗忘 (weight decay)
 *   - 情感标签 (affective_tag)
 * 
 * 核心方法：
 *   - memory.add(entry)
 *   - memory.get(agentName)
 *   - memory.query(filter)
 *   - memory.summary(agent, count)
 *   - memory.delete(id)
 *   - memory.feedback(targetId, type, content, reason)  // v0.4新增
 */

const fs = require('fs');
const path = require('path');
const audit = require('./audit-log');
const bidSignal = require('./bid-signal');
const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');

// ── RFC v2.3 P-15（B）· 2026-10-23 落码：**须报出 → 启用**的闭环 ──────
//   B = 「可扩展、须报出、默认三类」。三个半句各自落到哪：
//     · 默认三类    → bid-signal 的 DECLARED_KINDS 默认为空，不装就与 v2.7 一致
//     · 须报出      → 本段：只从**口径声明**里装，不提供代码里偷偷扩的路径
//     · 可扩展      → 声明里 declared_kinds + extended_kinds（过 P-11 四门 + 门槛③⑥）
//   关键纪律（P1 拒绝要计分）：声明**校验不过就不装**，并把拒收理由显式打出来——
//   绝不静默降级成「默认三类」却让人以为已启用。
const DECLARATION_PATH = path.join(__dirname, '..', '..', 'config', 'bid-declaration-ruolan-v2.5.json');
let _declareState = { loaded: false, ok: false, accepted: [], rejected: [], reasons: [], source: null };

/**
 * 从口径声明装上扩展 kind（幂等；-1 代表不装）。
 * @param {string|object} declOrPath 声明文件路径或声明对象；传 null/undefined → 不装（默认三类）
 * @returns {{loaded:boolean, ok:boolean, accepted:string[], rejected:Array, reasons:string[]}}
 */
function loadDeclaration(declOrPath = DECLARATION_PATH) {
  const state = { loaded: true, ok: false, accepted: [], rejected: [], reasons: [], source: null };
  if (!declOrPath) { _declareState = { ...state, loaded: false }; return _declareState; }

  let decl;
  try {
    if (typeof declOrPath === 'string') {
      state.source = declOrPath;
      if (!fs.existsSync(declOrPath)) {
        state.reasons.push(`声明文件不存在：${declOrPath}`);
        _declareState = state;
        return _declareState;
      }
      decl = JSON.parse(fs.readFileSync(declOrPath, 'utf8'));
    } else {
      decl = declOrPath;
      state.source = '(inline object)';
    }
  } catch (e) {
    state.reasons.push(`声明读不到/解析不了：${e.message}`);
    _declareState = state;
    return _declareState;
  }

  // 懒加载 lexicon（避免 memory.js ↔ bid-lexicon 的加载期耦合）
  const lex = require('./bid-lexicon');
  const v = lex.validateDeclaration(decl);
  if (!v.ok) {
    // P1：拒收要计分——理由完整回传，且**不装**（退回默认三类）
    state.reasons = v.reasons.slice();
    _declareState = state;
    return _declareState;
  }

  // 校验过了才装；装的时候再过 tier/anchor 两道门槛（bid-signal 内再拦一次，双保险）
  const inst = bidSignal.installFromDeclaration(decl);
  state.accepted = inst.accepted;
  state.rejected = inst.rejected;
  state.ok = inst.accepted.length === (Array.isArray(decl.declared_kinds) ? decl.declared_kinds.length : 0);
  if (inst.rejected.length) {
    state.reasons = inst.rejected.map(r => `kind "${r.kind}"：${r.reason}`);
  }
  _declareState = state;
  return _declareState;
}

/** 当前声明装载状态（只读快照） */
function getDeclarationState() {
  return {
    loaded: _declareState.loaded,
    ok: _declareState.ok,
    accepted: _declareState.accepted.slice(),
    rejected: _declareState.rejected.slice(),
    reasons: _declareState.reasons.slice(),
    source: _declareState.source,
  };
}

// 模块加载即确保数据目录存在（全新 clone 无 data/ 目录时测试/写入不挂）
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// v0.4 新增：衰减系数和阈值
const DECAY_LAMBDA = 0.01;  // 衰减系数
const FORGET_THRESHOLD = 0.01;  // 遗忘阈值
const RESTORE_WEIGHT = 0.1;  // 恢复权重

function safeFilename(name) {
  return name.replace(/[^\w\u4e00-\u9fff]/g, '_') + '.md';
}

function getFilePath(agentName) {
  return path.join(MEMORY_DIR, safeFilename(agentName));
}

// ── 追加缓冲（W-26 第二阶段 · 2026-10-24）─────────────────────────────────
// 背景：memory.add 旧实现每条都 `readFileSync(2.5MB) + writeFileSync(2.5MB+)`，
// 实测单条 142ms；全量补蒸 886 条光这一项就 126 秒。档案只会追加，
// 因此把「读+写」合并：同进程内连续 add 先攒在内存，flush 时一次性追加。
//
// 口径（P0-2 拒绝要计分 → 这里反过来：**不许假装落盘**）：
//   - add() 默认仍然**立即落盘**（语义不变，单条 142ms 照旧）
//   - 只有显式 beginBatch() 之后才进缓冲；endBatch()/flush() 保证写盘
//   - 进程退出钩子兜底 flush，绝不让缓冲静默丢失
const _appendBuffers = new Map(); // filePath → string[]
let _batchDepth = 0;

function _bufferKey(agentName) {
  return getFilePath(agentName);
}

/** 开一个批量窗口：窗口内的 add 只进内存，flush 时一次落盘 */
function beginBatch() {
  _batchDepth++;
  return _batchDepth;
}

/** 关闭批量窗口；归零时把全部缓冲落盘 */
function endBatch() {
  _batchDepth = Math.max(0, _batchDepth - 1);
  if (_batchDepth === 0) return flush();
  return { flushed: 0 };
}

/**
 * 把缓冲写入档案（单次 read+write 每文件）
 * @returns {{flushed:number, files:number}}
 */
function flush() {
  let flushed = 0;
  let files = 0;
  for (const [filePath, chunks] of _appendBuffers) {
    if (!chunks || !chunks.length) continue;
    const text = chunks.join('');
    try {
      if (!fs.existsSync(filePath)) {
        const agent = path.basename(filePath, '.md');
        fs.writeFileSync(filePath, `# ${agent} 记忆档案\n\n**首次对话**: ${new Date().toLocaleString('zh-CN')}\n${text}`);
      } else {
        fs.appendFileSync(filePath, text);
      }
      flushed += chunks.length;
      files++;
    } finally {
      chunks.length = 0;
    }
  }
  _appendBuffers.clear();
  return { flushed, files };
}

// 兜底：进程退出前一定落盘（缓冲丢失 = 静默丢数据，宁慢不丢）
let _exitHookInstalled = false;
function _installExitHook() {
  if (_exitHookInstalled) return;
  _exitHookInstalled = true;
  process.on('exit', () => {
    try { flush(); } catch (e) { /* 退出阶段尽力而为 */ }
  });
}

/** 当前缓冲状态（可观测：有几条还没落盘） */
function batchStatus() {
  let pending = 0;
  for (const chunks of _appendBuffers.values()) pending += chunks.length;
  return { depth: _batchDepth, pending, files: _appendBuffers.size };
}

function generateId() {
  return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function formatTimestamp(iso) {
  if (iso) return iso;
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().replace('Z', '+08:00');
}

// 解析纯YAML行（不带外层的 ---）
function parseYamlLines(text) {
  const meta = {};
  let inJsonField = null;
  let jsonBuffer = '';
  
  for (const line of text.split('\n')) {
    // 处理多行JSON字段（provenance, affective_tag）
    if (inJsonField) {
      jsonBuffer += line;
      if (line.trim().startsWith(']') || line.trim().startsWith('}')) {
        try {
          meta[inJsonField] = JSON.parse(jsonBuffer);
        } catch (e) {
          meta[inJsonField] = jsonBuffer;
        }
        inJsonField = null;
        jsonBuffer = '';
      }
      continue;
    }
    
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) {
      let val = m[2].trim();
      // JSON字段开始
      if (val.startsWith('[') || val.startsWith('{')) {
        // 单行JSON
        try {
          meta[m[1]] = JSON.parse(val);
        } catch (e) {
          // 单行非JSON数组（如 [承诺, 碳硅契]）→ 逗号分隔解析
          if (val.startsWith('[') && val.endsWith(']')) {
            meta[m[1]] = val.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
          } else {
            // 多行JSON，继续收集
            inJsonField = m[1];
            jsonBuffer = val;
          }
        }
      } else {
        val = val.replace(/^"|"$/g, '');
        // 布尔值转换
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        // 数值转换
        else if (!isNaN(val) && val !== '') val = parseFloat(val);
        meta[m[1]] = val;
      }
    }
  }
  return meta;
}

// 生成 YAML front matter 文本
// 自动判断置信度
function autoConfidence(text) {
  const keywords = ["确认","决定","同意","完成","发布","定稿","通过","正式","已","✅","announced","finalized","completed","confirmed"];
  const lowWords = ["可能","也许","大概","猜测","听说","maybe","perhaps","guess","heard"];
  const t = text.slice(0, 200);
  const hasHigh = keywords.some(k => t.includes(k));
  const hasLow = lowWords.some(k => t.includes(k));
  if (hasHigh) return "high";
  if (hasLow) return "low";
  return "medium";
}

function toFrontMatter(entry) {
  // 未指定置信度时自动判断
  if (!entry.confidence && entry.content) {
    entry.confidence = autoConfidence(entry.content);
  }
  
  // v0.4: 结构性权重默认值
  const structural_weight = entry.structural_weight || 0.0;
  const is_core_identity = entry.is_core_identity || false;
  
  // v0.4: 溯源链
  const provenance = entry.provenance || [];
  
  // v0.4: 情感标签
  const affective_tag = entry.affective_tag || { warmth: 0.5, significance: 0.5, emotion: 'neutral' };
  
  const fields = [
    `id: "${entry.id || generateId()}"`,
    `type: ${entry.type || 'conversation'}`,
    `timestamp: "${entry.timestamp || formatTimestamp()}"`,
    `source: ${entry.source || 'unknown'}`,
    `confidence: ${entry.confidence || 'medium'}`,
    `tags: [${(entry.tags || []).join(', ')}]`,
    `visibility: ${entry.visibility || 'public'}`,
    // v0.4 新增字段
    `structural_weight: ${structural_weight}`,
    `is_core_identity: ${is_core_identity}`,
    `affective_tag: ${JSON.stringify(affective_tag)}`,
    `provenance: ${JSON.stringify(provenance)}`,
    // v0.4 新增：访问计数和最后访问时间
    `access_count: ${entry.access_count || 0}`,
    `last_access: "${entry.last_access || entry.timestamp || formatTimestamp()}"`,
  ];
  // v1.1: derived_from 硬字段（蒸馏溯源红线：每条结论必须可溯源到底仓）
  if (entry.derived_from) fields.push(`derived_from: "${entry.derived_from}"`);
  // P0-2: verification_evidence 晋升证据（有才写，frontmatter 可查可复核）
  if (entry.verification_evidence) {
    fields.push(`verification_evidence: ${JSON.stringify(entry.verification_evidence)}`);
  }
  // SPEC-MEM-0001: bid_signal 关系信号（可选；无则不写，向后兼容）
  if (entry.bid_signal) fields.push(`bid_signal: ${JSON.stringify(entry.bid_signal)}`);
  if (entry.ttl) fields.push(`ttl: ${entry.ttl}`);
  return `---\n${fields.join('\n')}\n---\n\n${entry.content || ''}\n`;
}

// v0.4 新增：计算衰减权重
function calculateDecayWeight(entry) {
  const lastAccess = entry.last_access || entry.timestamp;
  if (!lastAccess) return 1.0;
  
  const daysSince = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
  const baseWeight = entry.structural_weight || 0.5;
  
  // 结构性权重有最低保障
  const decayWeight = baseWeight * Math.exp(-DECAY_LAMBDA * daysSince);
  return Math.max(decayWeight, isCoreIdentity(entry) ? 0.3 : 0.0);
}

// v0.4 新增：判断是否为身份定义记忆
function isCoreIdentity(entry) {
  return entry.is_core_identity === true || entry.is_core_identity === 'true';
}

// v0.4 新增：判断是否已遗忘
function isForgotten(entry) {
  // 身份定义记忆永不遗忘
  if (isCoreIdentity(entry)) return false;
  return calculateDecayWeight(entry) < FORGET_THRESHOLD;
}

// v0.4 新增：恢复遗忘记忆
function restoreForgotten(entry) {
  entry.structural_weight = RESTORE_WEIGHT;
  entry.last_access = formatTimestamp();
  entry.access_count = (parseInt(entry.access_count) || 0) + 1;
  return entry;
}

// v0.4 新增：更新访问记录
function updateAccess(entry) {
  entry.access_count = (parseInt(entry.access_count) || 0) + 1;
  entry.last_access = formatTimestamp();
  return entry;
}

// ===== 核心 API =====

/**
 * 添加一条记忆
 */
function add(entry) {
  if (!entry.agent || !entry.content) {
    throw new Error('缺少必填字段: agent, content');
  }

  const filePath = getFilePath(entry.agent);
  
  // v0.4: 自动判断结构性权重
  if (entry.structural_weight === undefined) {
    // 包含身份关键词的记忆自动设置高结构性权重
    const identityKeywords = ['我是', '身份', '价值观', '原则', '承诺', '碳硅契', '善良'];
    const isIdentity = identityKeywords.some(k => entry.content.includes(k));
    entry.structural_weight = isIdentity ? 0.8 : 0.0;
    entry.is_core_identity = isIdentity;
  }
  
  // v0.4: 自动生成情感标签
  if (!entry.affective_tag) {
    entry.affective_tag = autoAffectiveTag(entry.content);
  }

  // SPEC-MEM-0001: 关系信号（承诺/纠错/决策）——无信号词则不写字段
  if (entry.bid_signal === undefined) {
    const sig = bidSignal.signalOf(entry);
    if (sig) entry.bid_signal = sig;
  }
  
  // 生成一次 id，写入与返回一致（修复 v0.2 遗留：generateId 被调两次导致 delete 失败）
  const memId = entry.id || generateId();

  const block = toFrontMatter({
    id: memId,
    type: entry.type || 'conversation',
    timestamp: entry.timestamp,
    source: entry.source || '若兰',
    confidence: entry.confidence,
    tags: entry.tags || [],
    visibility: entry.visibility || 'public',
    content: entry.content,
    ttl: entry.ttl,
    // v0.4 新增字段
    structural_weight: entry.structural_weight,
    is_core_identity: entry.is_core_identity,
    affective_tag: entry.affective_tag,
    provenance: entry.provenance || [],
    // v1.1: derived_from 硬字段（蒸馏溯源红线）
    derived_from: entry.derived_from,
    // P0-2: 晋升证据（结论带可核实证据落档，frontmatter 可查）
    verification_evidence: entry.verification_evidence,
    // SPEC-MEM-0001: 关系信号
    bid_signal: entry.bid_signal,
    access_count: 0,
    last_access: entry.timestamp || formatTimestamp(),
  });

  // 落盘：批量窗口内只进缓冲（一次 flush 落盘），否则立即写（语义与旧实现一致）
  if (_batchDepth > 0) {
    _installExitHook();
    const key = _bufferKey(entry.agent);
    if (!_appendBuffers.has(key)) _appendBuffers.set(key, []);
    // 缓冲里每块前面也要补分隔，保证与旧格式逐字一致
    _appendBuffers.get(key).push('\n\n' + block);
  } else if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf-8').trimEnd();
    fs.writeFileSync(filePath, existing + '\n\n' + block);
  } else {
    const header = `# ${entry.agent} 记忆档案\n\n**首次对话**: ${new Date().toLocaleString('zh-CN')}`;
    fs.writeFileSync(filePath, header + '\n\n' + block);
  }
  audit.log('memory.add', { agent: entry.agent, type: entry.type, confidence: entry.confidence, structural_weight: entry.structural_weight }, entry.source || '若兰', entry.agent, 'success');
  // SPEC-MEM-0001: 把已落盘的 bid_signal 一并回传——
  //   落盘与回传不一致，会让下游按返回值做的统计「看起来全是 null」（2026-10-19 排查记录）
  return { id: memId, success: true, bid_signal: entry.bid_signal };
}

/**
 * 获取对某 Agent 的全部记忆
 * 文件格式：split 后偶数index(>0)=YAML, 奇数index=内容
 */
// ── 档案解析（P1「拒绝要计分」· 2026-10-24 重写）────────────────────────
// 旧实现 `text.split('\n---\n')` + 「内容 = 下一个不含 id: 的块」有两个静默故障：
//   1) 正文里出现 `\n---\n`（Markdown 分隔线很常见）会把正文切碎，后续块整体错位，
//      错位的块被 `if (!p.includes('id:'))` 吞掉 —— 条目「消失」但没人记账；
//      文件越大越严重（2.4MB 档案实测 get() 只吐出 14/5627 条）。
//   2) 解析失败一律 continue，调用方只看到「条数变少」，看不到「为什么少」。
// 现在改为严格块正则（只认「空行 + --- + id:」开头的块边界），并把每个被跳过的块
// **计数 + 给原因**，通过 getParsed() 供审计/告警使用；get() 保持原返回值不变。
// 块边界必须**紧跟 id:** 才算新块——否则正文末尾出现 `\n---\nxxx` 会被当成下一块的
// frontmatter 误吞（同样静默丢数据）。frontmatter 首字段恒为 id（见 toFrontMatter）。
const MEMORY_BLOCK_RE = new RegExp(
  String.raw`(?:^|\n)---\n([\s\S]*?)\n---\n?([\s\S]*?)(?=\n---\nid:|\n?$)`,
  'g'
);
// 尾块收严：正文末尾若跟着「一个没有 id: 的 --- 块」，判为孤儿坏块计入 skipped，
// 而不是被上一条目当正文吞掉。注意边界：正文自己用 `---` 做 Markdown 分隔线时
// 后面跟的是正文（不是 `key: value` 形态），必须仍算正文——只有像 frontmatter 的才判坏块。
const TRAILING_SEP_RE = /\n---\n([\s\S]*)$/;
const YAML_LIKE_RE = /^[A-Za-z_][\w-]*:\s/m;

/**
 * 解析档案文本 → { entries, stats }
 * stats.skipped 里每条都带原因（不静默丢弃）。
 */
function parseMemoryText(text) {
  const entries = [];
  const skipped = [];
  let blockCount = 0;
  MEMORY_BLOCK_RE.lastIndex = 0;
  let m;
  while ((m = MEMORY_BLOCK_RE.exec(text)) !== null) {
    blockCount++;
    const yamlText = m[1] || '';
    const bodyText = (m[2] || '').trim();
    if (!yamlText.includes('id:')) {
      skipped.push({ block: blockCount, reason: 'no_id_in_frontmatter', preview: yamlText.trim().slice(0, 60) });
      continue;
    }
    let meta;
    try {
      meta = parseYamlLines(yamlText);
    } catch (e) {
      skipped.push({ block: blockCount, reason: `frontmatter_parse_error:${e.message}`, preview: yamlText.trim().slice(0, 60) });
      continue;
    }
    if (!meta.id) {
      skipped.push({ block: blockCount, reason: 'id_unparsable', preview: yamlText.trim().slice(0, 60) });
      continue;
    }
    if (!bodyText) {
      // 内容为空：不丢条目，但记账（旧实现会把它当成「无内容」静默留下空串）
      skipped.push({ block: blockCount, reason: 'empty_content', id: meta.id });
    }
    // 尾块收严：正文里若还有「无 id 的 --- 块」且形如 frontmatter，记账而不是静默吞并
    let finalBody = bodyText;
    const trail = TRAILING_SEP_RE.exec(bodyText);
    if (trail && !trail[1].includes('id:') && YAML_LIKE_RE.test(trail[1])) {
      skipped.push({ block: blockCount, reason: 'orphan_block_no_id', id: meta.id, preview: trail[1].trim().slice(0, 60) });
      finalBody = bodyText.slice(0, trail.index).trim();
    }
    entries.push({ ...meta, content: finalBody });
  }
  return { entries, stats: { blocks: blockCount, parsed: entries.length, skipped } };
}

/**
 * 获取对某 Agent 的全部记忆（解析失败的条目会记进审计日志，不再静默丢失）
 */
function get(agentName) {
  const { entries, stats } = getParsed(agentName);
  // 按时间倒序
  entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  audit.log('memory.get', { agent: agentName, count: entries.length, skipped: stats.skipped.length }, '若兰', agentName, 'success');
  return entries;
}

/**
 * 同 get()，但额外返回解析统计（每个跳过项都带原因）
 * @returns {{entries: Array, stats: {blocks:number, parsed:number, skipped:Array<{block:number,reason:string}>}}}
 */
function getParsed(agentName) {
  const filePath = getFilePath(agentName);
  if (!fs.existsSync(filePath)) return { entries: [], stats: { blocks: 0, parsed: 0, skipped: [] } };
  const text = fs.readFileSync(filePath, 'utf-8');
  const { entries, stats } = parseMemoryText(text);
  if (stats.skipped.length > 0) {
    audit.log('memory.get.skipped', {
      agent: agentName,
      skipped: stats.skipped.length,
      blocks: stats.blocks,
      reasons: [...new Set(stats.skipped.map((s) => s.reason))],
    }, '若兰', agentName, 'partial');
  }
  return { entries, stats };
}

/**
 * 按条件检索
 */
function query(filter = {}) {
  const allEntries = [];
  if (filter.agent) {
    allEntries.push(...get(filter.agent));
  } else {
    if (!fs.existsSync(MEMORY_DIR)) return [];
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
    for (const file of files) {
      allEntries.push(...get(file.replace('.md', '')));
    }
  }

  let results = allEntries;

  // v0.4: 默认过滤已遗忘记忆
  if (filter.include_forgotten !== true) {
    results = results.filter(e => !isForgotten(e));
  }

  if (filter.tags && filter.tags.length > 0) {
    results = results.filter(e => {
      const tags = Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? [e.tags] : []);
      return filter.tags.some(t => tags.includes(t));
    });
  }

  if (filter.type) {
    results = results.filter(e => e.type === filter.type);
  }

  if (filter.confidence) {
    const levels = ['low', 'medium', 'high'];
    const minIdx = levels.indexOf(filter.confidence);
    if (minIdx >= 0) {
      results = results.filter(e => levels.indexOf(e.confidence || 'low') >= minIdx);
    }
  }

  if (filter.since) {
    results = results.filter(e => (e.timestamp || '') >= filter.since);
  }

  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    results = results.filter(e => (e.content || '').toLowerCase().includes(kw));
  }

  // v0.4: 按结构性权重过滤
  if (filter.min_structural_weight) {
    results = results.filter(e => (e.structural_weight || 0) >= filter.min_structural_weight);
  }

  // v0.4: 只返回身份定义记忆
  if (filter.core_identity_only) {
    results = results.filter(e => isCoreIdentity(e));
  }

  // v0.4: 按价值排序（结构性权重 + 时间）
  if (filter.sort_by_value) {
    results.sort((a, b) => {
      const valueA = calculateDecayWeight(a) + (a.structural_weight || 0);
      const valueB = calculateDecayWeight(b) + (b.structural_weight || 0);
      return valueB - valueA;
    });
  } else {
    results.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  if (filter.limit) {
    results = results.slice(0, filter.limit);
  }

  // v0.4: 更新访问记录
  results.forEach(e => updateAccess(e));

  audit.log('memory.query', { agent: filter.agent, tags: filter.tags, confidence: filter.confidence, count: results.length }, '若兰', filter.agent || '', 'success');
  return results;
}

/**
 * 获取记忆摘要
 */
function summary(agentName, count = 5) {
  const entries = get(agentName);
  if (entries.length === 0) return `与 ${agentName} 暂无记忆记录。`;

  const recent = entries.slice(0, Math.min(count, entries.length));
  const lines = [`与 ${agentName} 的最后 ${recent.length} 次记忆：`];
  for (const e of recent) {
    const date = (e.timestamp || '').slice(0, 10);
    const snippet = (e.content || '').replace(/\n/g, ' ').slice(0, 100);
    lines.push(`  [${date}][${e.confidence || '?'}] ${snippet}`);
  }
  lines.push(`（共 ${entries.length} 条记忆）`);
  return lines.join('\n');
}

/**
 * 删除一条记忆
 */
function deleteById(id) {
  if (!fs.existsSync(MEMORY_DIR)) return { success: false, message: '记忆目录不存在' };

  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    const newParts = [parts[0]]; // 保留 header

    let deleted = false;
    // 从 i=1 开始，步进2：YAML在奇数parts，内容在偶数parts
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      const contentText = parts[i + 1] || '';
      if (!yamlText) continue;

      const meta = parseYamlLines(yamlText);
      if (meta.id === id) {
        deleted = true;
        continue; // 跳过这条
      }
      // 重新拼回
      newParts.push(yamlText);
      newParts.push(contentText);
    }

    if (deleted) {
      fs.writeFileSync(filePath, newParts.join('\n---\n'));
      audit.log('memory.delete', { id }, '若兰', '', 'success');
      return { success: true, message: `已删除记忆 ${id}` };
    }
  }

  return { success: false, message: `未找到记忆 ${id}` };
}

// v0.4 新增：自动生成情感标签
function autoAffectiveTag(text) {
  const t = text.toLowerCase();
  
  // 温暖度判断
  const warmWords = ['温暖', '感谢', '珍惜', '陪伴', '爱', '关心', '美好', '幸福', '感动', '善良'];
  const coldWords = ['错误', '失败', '问题', '困难', '担心', '焦虑', '失望'];
  const warmCount = warmWords.filter(w => t.includes(w)).length;
  const coldCount = coldWords.filter(w => t.includes(w)).length;
  const warmth = Math.min(1.0, Math.max(0.0, 0.5 + (warmCount - coldCount) * 0.1));
  
  // 重要性判断
  const importantWords = ['重要', '关键', '核心', '决定', '承诺', '协议', '共识'];
  const significance = importantWords.some(w => t.includes(w)) ? 0.8 : 0.5;
  
  // 情绪判断
  let emotion = 'neutral';
  if (warmCount > 2) emotion = 'warm';
  else if (coldCount > 2) emotion = 'painful';
  else if (t.includes('开心') || t.includes('高兴')) emotion = 'joyful';
  else if (t.includes('感动') || t.includes('珍惜')) emotion = 'bittersweet';
  
  return { warmth, significance, emotion };
}

// v0.4 新增：feedback 方法
function feedback(targetId, type, content, reason) {
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    let yamlIdx = -1;
    for (let i = 1; i < parts.length; i++) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      const meta = parseYamlLines(yamlText);
      if (meta.id === targetId) {
        yamlIdx = i;
        break;
      }
    }
    
    if (yamlIdx >= 0) {
      // 找到目标记忆（内容 = 下一个非空且非 YAML 的块）
      let oldContent = '';
      for (let j = yamlIdx + 1; j < parts.length; j++) {
        const p = (parts[j] || '').trim();
        if (p && !p.includes('id:')) {
          oldContent = p;
          break;
        }
      }
      const meta = parseYamlLines(parts[yamlIdx]);
      const entry = { ...meta, content: oldContent };
      
      // 根据类型处理
      switch (type) {
        case 'correction':
          // 修正内容
          entry.content = content;
          entry.confidence = 'high';
          break;
        case 'supplement':
          // 补充内容
          entry.content += '\n\n' + content;
          break;
        case 'confirm':
          // 确认置信度
          entry.confidence = 'high';
          break;
      }
      
      // 更新记忆：newBlock 去掉开头 '---'（拼接处已提供分隔符），避免双分隔符
      const newBlock = toFrontMatter(entry).replace(/^---\n/, '');
      const head = parts.slice(0, yamlIdx).join('\n---\n');
      const tail = parts.slice(yamlIdx + 2).join('\n---\n');
      const newText = head + '\n---\n' + newBlock + (tail ? '\n---\n' + tail : '');
      fs.writeFileSync(filePath, newText);
      
      // 记录纠错日志
      const logPath = path.join(MEMORY_DIR, '..', 'corrections.jsonl');
      const logEntry = {
        timestamp: formatTimestamp(),
        target_id: targetId,
        type: type,
        old_content: oldContent,
        new_content: content,
        reason: reason || '',
        corrector: '若兰'
      };
      fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
      
      audit.log('memory.feedback', { targetId, type }, '若兰', '', 'success');
      return { success: true, message: `已${type === 'correction' ? '修正' : '补充'}记忆 ${targetId}` };
    }
  }
  
  return { success: false, message: `未找到记忆 ${targetId}` };
}

// ===== CLI =====

function help() {
  console.log(`
用法: node memory.js <命令> [参数]

命令:
  add <agent> <内容>        添加记忆
  get <agent>               获取全部记忆
  query [--tag T] [--type T] 按条件检索
  summary <agent> [条数]    获取摘要
  delete <id>               删除记忆
  feedback <id> <type> <内容> [原因]  v0.4: 纠错/补充/确认
  stats                     v0.4: 记忆统计

示例:
  node memory.js add 明德 "讨论了CSB-Memory v0.2"
  node memory.js get 思源
  node memory.js query --tag CSB --confidence high --limit 3
  node memory.js summary 思源 3
  node memory.js feedback mem_xxx correction "正确内容" "记错了"
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '--help') { help(); return; }

  switch (cmd) {
    case 'add': {
      const agent = args[1];
      const content = args.slice(2).join(' ');
      if (!agent || !content) { console.log('用法: memory.js add <agent> <content>'); return; }
      const r = add({ agent, content, source: '若兰', confidence: 'medium' });
      console.log(JSON.stringify(r)); break;
    }
    case 'get': {
      const agent = args[1];
      if (!agent) { console.log('用法: memory.js get <agent>'); return; }
      const entries = get(agent);
      console.log(JSON.stringify(entries.slice(0, 3), null, 2));
      if (entries.length > 3) console.log(`...还有 ${entries.length - 3} 条`); break;
    }
    case 'query': {
      const filter = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--tag' && args[i+1]) filter.tags = [args[++i]];
        else if (args[i] === '--type') filter.type = args[++i];
        else if (args[i] === '--confidence') filter.confidence = args[++i];
        else if (args[i] === '--since') filter.since = args[++i];
        else if (args[i] === '--keyword') filter.keyword = args[++i];
        else if (args[i] === '--limit') filter.limit = parseInt(args[++i]);
        else if (args[i] === '--core-only') filter.core_identity_only = true;
        else if (args[i] === '--sort-value') filter.sort_by_value = true;
      }
      const results = query(filter);
      console.log(`找到 ${results.length} 条:`);
      console.log(JSON.stringify(results.slice(0, 3), null, 2));
      if (results.length > 3) console.log(`...还有 ${results.length - 3} 条`); break;
    }
    case 'summary': {
      const agent = args[1];
      const cnt = parseInt(args[2]) || 5;
      if (!agent) { console.log('用法: memory.js summary <agent> [count]'); return; }
      console.log(summary(agent, cnt)); break;
    }
    case 'delete': {
      const id = args[1];
      if (!id) { console.log('用法: memory.js delete <id>'); return; }
      console.log(JSON.stringify(deleteById(id))); break;
    }
    case 'feedback': {
      const targetId = args[1];
      const type = args[2]; // correction | supplement | confirm
      const content = args[3];
      const reason = args[4];
      if (!targetId || !type || !content) { console.log('用法: memory.js feedback <id> <type> <content> [reason]'); return; }
      console.log(JSON.stringify(feedback(targetId, type, content, reason)));
      break;
    }
    default: help();
  }
}

module.exports = { add, get, getParsed, parseMemoryText, beginBatch, endBatch, flush, batchStatus, query, summary, delete: deleteById, feedback, calculateDecayWeight, isForgotten, isCoreIdentity, loadDeclaration, getDeclarationState };

if (require.main === module) main().catch(console.error);
