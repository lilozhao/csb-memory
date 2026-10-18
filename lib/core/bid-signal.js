/**
 * bid-signal.js — BID 关系信号抽取（SPEC-MEM-0001 · v2.0 词表精修）
 *
 * 目的：记忆生成时把「承诺 / 纠错 / 决策」信号从正文里提为结构化字段，
 *       供 BID（羁绊影响域）读字段而非事后正则猜。
 *
 * ⚠️ v2.0 变更（2026-10-18 · 观察期实证驱动）：
 *   v1.0 是裸关键词 OR 匹配 → decision 占全量 61%、promise 大量为「谈论承诺」。
 *   v2.0 改为「主体 + 动作」结构化匹配，并加两重语境护栏：
 *     ① 谈论语境（讨论/关于/统计/率…）→ 不判
 *     ② 否定语境（无/非/未/不…）→ 不判
 *   优先级：纠错 > 承诺 > 决策（R12）
 *
 * 注：v1.0 曾声称与 `sync-daily.js#IMPORTANT_PATTERNS` 同源；v2.0 起**不再同源**
 *     （该表服务日记重点提取，语义不同，强行共用会让两者都变糟）。
 */

'use strict';

// ── 主体词（做动作的人/主体）─────────────────────────
const AGENT_NOUN = /(?:我|我们|我方|本人|对方|一澜|若兰|若琢|阿轩|墨丘|舟楫|小虾|Jeason|恺|澈|星尘|思源|明德|言蹊|明镜|苏念|若辰|知微|初白|川贝|清漪|鲸歌|各席|全员|团队|Agent|agent)/;

// ── ① 纠错：主体 + 纠正动作 ────────────────────────
// 要求紧邻结构（中间最多 6 字），避免「lint 修正」这类技术叙述
const CORRECTION_STRICT = [
  /(?:我|我方|本人).{0,6}(?:更正|纠正|订正|勘误|说错|弄错|错了|道歉|收回该|撤回该)/,
  /(?:主动|对方|外部|有人).{0,6}(?:更正|纠正|指正|指出我方|纠正我)/,
  /(?:采纳|接受).{0,8}(?:指正|更正|纠错|意见)/,
  /更正[:：]/,
  /纠错[:：]/,
  /(?:^|[，。；\s])(?:更正|纠正|订正)(?:一处|一下|此处|了|：|:)/,
];

// ── ② 承诺：主体 + 承诺动作 + 未来指向 ─────────────
const PROMISE_STRICT = [
  /(?:我|我方|本人).{0,8}(?:承诺|答应|保证|约定|将在|会完成|负责完成|跟进|待办)/,
  /(?:承诺|答应|约定)(?:了)?.{0,12}(?:完成|提交|交付|推进|跟进|处理|修复|落实|补齐|写|做)/,
  /(?:TODO|待办)[:：]\s*\S/,
];

// ── ③ 决策：决策动词 + 决策对象/结论（R13）──────────
const DECISION_STRICT = [
  /(?:决定|拍板|裁定|裁示|定案|定稿|敲定)(?:了|采用|使用|推进|执行|以下|：|:)/,
  /(?:一澜|评审|会议|团队|各席|全员)(?:已经|已)?(?:批准|批准了|通过|签字|放行)/,
  /(?:共识|结论)(?:是|为|[:：])/,
  /(?:与|和|同).{0,6}(?:确认|敲定|对齐)(?:了)?(?:.{0,10}(?:方案|口径|接口|细节|安排))?/,
  /(?:approved|decided)\b/i,
];

// ── 语境护栏 ────────────────────────────────────────
// 谈论/元话语标记：信号词附近出现 → 这条是在「谈论」信号，不是信号本身
const META_CONTEXT = /(?:讨论|谈论|提到|提及|关于|是否|判断|观测|观察|统计|统计口径|率|多少次|几条|口径|定义|设计|词表|识别|抽取|正则|匹配|样本|举例|比如|例如|所谓)/;
// 否定标记
const NEGATION = /(?:无|非|未|不|没有|不存在|并无|不算|并非|未做|不做)/;

/**
 * 取信号词在文本中的位置（用于采样邻近语境）。
 */
function positionsOf(text, patterns) {
  const out = [];
  for (const re of patterns) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m;
    while ((m = g.exec(text)) !== null) {
      out.push({ index: m.index, length: m[0].length });
      if (m.index === g.lastIndex) g.lastIndex++;
      if (out.length > 40) return out;
    }
  }
  return out;
}

/**
 * 采样信号词前后的语境窗口，判断是否被谈论/否定语境污染。
 * @returns {{meta:boolean, neg:boolean}}
 */
function contextFlags(text, pos, window = 10) {
  // 取样范围：信号词前 window 字到后 window+词长 字（同一句内近似）
  const start = Math.max(0, pos.index - window);
  const end = Math.min(text.length, pos.index + pos.length + window);
  const before = text.slice(start, pos.index);
  const after = text.slice(pos.index + pos.length, end);
  // 只取最近的子句（以标点截断），避免跨句误伤
  const clauseBefore = before.split(/[。；;！!？?\n]/).pop() || '';
  const clauseAfter = after.split(/[。；;！!？?\n]/)[0] || '';
  // 元话语标记只查**前文**：「讨论承诺」「关于是否同意」是谈论；
  // 而「更正一处口径」里的「口径」是宾语，不是元话语，不得误伤。
  const meta = META_CONTEXT.test(clauseBefore);
  return { meta, neg: NEGATION.test(clauseBefore) };
}

/**
 * 判定一类信号：命中结构 + 至少一处未被语境护栏拦截。
 */
function matchStrict(text, patterns, window = 10) {
  const positions = positionsOf(text, patterns);
  for (const pos of positions) {
    const f = contextFlags(text, pos, window);
    if (f.meta || f.neg) continue; // 被护栏拦下 → 试下一处
    return true;
  }
  return false;
}

// 已知连接名（用于从 tags/正文提取 peer）
const KNOWN_PEERS = ['阿轩', '墨丘', '舟楫', '小虾', 'Jeason', '恺', '澈', '星尘', '思源',
  '明德', '若琢', '言蹊', '明镜', '苏念', '若辰', '知微', '初白', '川贝', '清漪', '鲸歌'];

function detectKind(text) {
  if (!text) return null;
  if (matchStrict(text, CORRECTION_STRICT)) return 'correction'; // R12 优先级最高
  if (matchStrict(text, PROMISE_STRICT)) return 'promise';
  if (matchStrict(text, DECISION_STRICT)) return 'decision';
  return null;
}

/**
 * O2 · peer 收紧（2026-10-18）
 *
 * 问题：v1.0 只要正文出现连接名就取作 peer —— 那是「提及」，不是「关系」。
 *   反例：'来源链条：…若琢 09-01 回帖承诺…' → 这条在**引用**若琢的旧事，
 *        不是若兰与若琢之间的承诺。
 *
 * v3 规则：连接名必须处在**关系位置**之一才认：
 *   ① 与/和/同/对/向/给 + 名字      （与阿轩确认）
 *   ② 名字 + 主动/表示/回复/反馈    （墨丘主动更正）
 *   ③ 在 tags 里（显式标注，最强）
 *   ④ 调用方显式传入（最强）
 * 都不满足 → null（宁可空，不猜）
 */
const PEER_REL_PRE = /(?:与|和|同|对|向|给|跟|找)\s*([\u4e00-\u9fa5A-Za-z]{2,8})/;
const PEER_REL_POST = /([\u4e00-\u9fa5A-Za-z]{2,8})\s*(?:主动|表示|回复|反馈|指出|提出|确认|说)/;

function extractPeer(entry) {
  // 1) 调用方显式传入（最强）
  if (entry.peer) return entry.peer;

  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  // 2) tags 显式标注（次强）
  for (const t of tags) {
    const hit = KNOWN_PEERS.find(p => String(t).includes(p));
    if (hit) return hit;
  }

  const text = entry.content || '';
  if (!text) return null;

  // 3) 关系介词在前
  const preM = text.match(PEER_REL_PRE);
  if (preM) {
    const hit = KNOWN_PEERS.find(p => preM[1].includes(p));
    if (hit) return hit;
  }
  // 4) 关系动作在后
  const postM = text.match(PEER_REL_POST);
  if (postM) {
    const hit = KNOWN_PEERS.find(p => postM[1].includes(p));
    if (hit) return hit;
  }

  // 5) 都是「提及」→ 不认
  return null;
}

// 方向线索（correction 专用）
const DIR_OUT = /我方.{0,6}(?:更正|纠正)|已更正|已撤回|(?:我|我方|本人).{0,6}(?:更正|纠正)/;  // 我→对方
const DIR_IN = /主动更正|对方.{0,6}(?:更正|纠正)|外部.{0,6}(?:更正|纠正)|指出我方|纠正我|采纳.{0,8}指正/; // 对方→我

/**
 * 抽取一条记忆的 BID 信号。
 * @returns {{kind,peer,direction,state}|null}  无信号 → null（不落字段）
 */
function signalOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = `${entry.content || ''} ${entry.title || ''}`;
  const kind = detectKind(text);
  if (!kind) return null;

  let direction = entry.direction || null;
  if (kind === 'correction' && !direction) {
    if (DIR_IN.test(text)) direction = 'in';
    else if (DIR_OUT.test(text)) direction = 'out';
  }

  return {
    kind,
    peer: extractPeer(entry),
    direction: direction || null,
    state: 'pending', // 一期固定；四态回填见 SPEC-MEM-0002
  };
}

module.exports = {
  signalOf, detectKind, extractPeer, contextFlags, matchStrict,
  PEER_REL_PRE, PEER_REL_POST,
  CORRECTION_STRICT, PROMISE_STRICT, DECISION_STRICT, AGENT_NOUN,
  META_CONTEXT, NEGATION, KNOWN_PEERS,
};
