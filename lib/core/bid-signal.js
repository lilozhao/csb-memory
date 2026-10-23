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
 * ⚠️ v2.1 变更（2026-10-19 · 若琢跨宿主 99 条实测驱动）：
 *   ① decision 加**未来时排除**：「等一澜拍板」「需要确认」不再判决策（实测误判率 35%）
 *   ② DIR_IN 加**主语约束**：「澈叫错名字→第三次纠正」这类"纠正"主语是我，
 *      不再因为「对方名 + 纠错词」共现而误判为 in（实测 5 条全错）
 *
 * 注：v1.0 曾声称与 `sync-daily.js#IMPORTANT_PATTERNS` 同源；v2.0 起**不再同源**
 *     （该表服务日记重点提取，语义不同，强行共用会让两者都变糟）。
 */

'use strict';

// ── 主体词（做动作的人/主体）─────────────────────────
const AGENT_NOUN = /(?:我|我们|我方|本人|对方|一澜|若兰|若琢|阿轩|墨丘|舟楫|小虾|Jeason|恺|澈|星尘|思源|明德|言蹊|明镜|苏念|若辰|知微|初白|川贝|清漪|鲸歌|各席|全员|团队|Agent|agent)/;

// v2.3（2026-10-19 · 阿轩问题 3）：**自身名**——阿轩实测「同一个修复在我这语义相反」。
//   若把「阿轩」写死在 KNOWN_PEERS 里，阿轩自己跑时 '阿轩' = 归属者，永远不该是 peer。
//   故引入 SELF：实例启动时应调用 setSelf('<自己名字>')，extractPeer 会**排除 SELF**。
let SELF = null;
function setSelf(name) { SELF = name || null; return SELF; }
function getSelf() { return SELF; }

// 已知连接名（用于从 tags/正文提取 peer）
// ⚠️ 本名单是**候选**，不是关系白名单；实例应调用 setSelf() 声明自己，自身名不会成为 peer。
const KNOWN_PEERS = ['阿轩', '墨丘', '舟楫', '小虾', 'Jeason', '恺', '澈', '星尘', '思源',
  '明德', '若琢', '言蹊', '明镜', '苏念', '若辰', '知微', '初白', '川贝', '清漪', '鲸歌',
  // v2.1（2026-10-19）：补入若琢侧实测出现的交互对象（守枢为若琢侧对象，先纳入，待其确认是否为人名）
  '守枢', '阿契', '承契', 'Dsh-榫', '启明',
  // v2.1：人类对象与对端实例补充。**注意**：KNOWN_PEERS 是 peer 抽取的候选名单，
  //   不是「关系对象白名单」——纳入一澜是因为「一澜指出/批准/承诺」是高频且明确的信号源。
  '一澜', '宏伟', '知砚', '默弦', '燧明', '栖澜',
  // v2.2（2026-10-19 阿轩实测）：宿主机/其他生态的高频交互对象
  '墨白', '灼', '拾焰', '丹蕨',
  // v2.2：**实例自身名**（阿轩实测：若兰自身常在自己的档案里出现于「与若兰确认」等关系句）
  '若兰', '若琢', '阿轩'];

// ── ① 纠错：主体 + 纠正动作 ────────────────────────
// 要求紧邻结构（中间最多 6 字），避免「lint 修正」这类技术叙述
const CORRECTION_STRICT = [
  /(?:我|我方|本人).{0,6}(?:更正|纠正|校正|订正|勘误|说错|弄错|错了|道歉|收回该|撤回该)/,
  /(?:主动|对方|外部|有人).{0,6}(?:更正|纠正|指正|指出我方|纠正我)/,

  /(?:采纳|接受).{0,8}(?:指正|更正|纠错|意见)/,
  /更正[:：]/,
  /纠错[:：]/,
  /(?:^|[，。；\s])(?:更正|纠正|校正|订正)(?:一处|一下|此处|了|：|:)/,
];

// ── ② 承诺：主体 + 承诺动作 + 未来指向 ─────────────
// v2.4（2026-10-19 · 本机 143 条人工复审驱动）：
//   实测 promise 56 条里 **50 条是任务清单**（「待办：…」「M4 待办：…」），真承诺只有 2 条。
//   根因：旧词表最后一条 `/(?:TODO|待办)[:：]\s*\S/` —— 任何待办都算承诺，无主体、无对象。
//
//   新规则：promise = **对某人/某事做出的、有承诺语义的承诺**，三条路径任一：
//     ① 第一人称 + 强承诺动词（承诺/答应/保证/约定/发誓）
//     ② 承诺动词 + 明确的履行内容（承诺…完成/提交/交付…）
//     ③ 承诺动词 + 明确对象（对X承诺 / 向X承诺 / 回X承诺 / 答应X）
//   「待办 / TODO / 下一步 / M4 待办」**一律不算承诺**（它们是任务清单，没有关系对象）。
const PROMISE_STRICT = [
  // ① 第一人称 + 强承诺动词（去掉「将在/会完成/跟进/待办」这些弱词）
  /(?:我|我方|本人).{0,8}(?:承诺|答应|保证|约定|发誓|立下)/,
  // ② 承诺动词 + 履行内容
  /(?:承诺|答应|约定)(?:了)?.{0,12}(?:完成|提交|交付|推进|跟进|处理|修复|落实|补齐|回复|回帖|兑现)/,
  // ③ 承诺动词 + 明确对象（对象词直接跟在动词前/后）
  /(?:对|向|给|跟|同|回)\s*(?:[\u4e00-\u9fa5A-Za-z]{1,8})\s*(?:承诺|答应|保证|约定)/,
  /(?:承诺|答应|约定)(?:了)?.{0,6}(?:[\u4e00-\u9fa5A-Za-z]{1,8})\s*(?:完成|做到|兑现|交付)/,
  // v2.6（2026-10-22 · 召回测驱动 G-06/G-14）
  //   ④ 约定类节标题（「最近反馈与约定」）—— 人际约定是承诺，不是任务清单
  /(?:反馈|沟通|进展|回复)\s*(?:与|和|同)\s*(?:约定|商定|说好)/,
  //   ⑤ 点名给我做的接续任务（「给守枢回『火种与传承』」）—— 有明确对象 + 履行动作
  /(?:给|向|替)\s*[\u4e00-\u9fa5A-Za-z]{1,8}\s*(?:回|回复|答复|交代|交付|补|送)/,
];

/**
 * v2.8（2026-10-22 · RFC v2.3 P-15 已决 B：可扩展、须报出、默认三类）
 *
 * 缘起：一个**真正的关系事件**可以不包含任何标准 kind 动词——
 *   G-15「守枢首次敲门：自我介绍 + 想请教」、G-16「守枢两问…—我答…」。
 *   它们是「关系建立/维系」本身，不是 promise/correction/decision 中任一类。
 *   v2.7 时**故意不修**（硬塞三类=违硬凑；加枚举=RFC 变更），把缺口交回协议组。
 *
 * 一澜 2026-10-22 20:53 拍板按 **B** 走：「可扩展、须报出、默认三类」。
 * 落到代码上就是本段：
 *   · **默认三类**：不声明时，行为与 v2.7 完全一致（relation 不进 signalOf）
 *   · **可扩展**：实例可调 `setDeclaredKinds(['relation'])` 显式启用第 4 类
 *   · **须报出**：启用的扩展 kind 必须写进口径声明（见 bid-lexicon `extended_kinds`），
 *     且同样受 P-11 位置约束（word+pos+require_next+evidence 缺一不算）
 *
 * 判据（宽入严出）：主体名 + **首次接触/问答交互**事件词，且不是谈论语境。
 * @returns {boolean} 是否属于「无标准动词的关系事件」
 */
const RELATION_EVENT = new RegExp(
  `(?:${KNOWN_PEERS.join('|')})[^。；;！!？?\\n]{0,20}(?:首次敲门|敲门|来访|打招呼|自我介绍|想请教|两问|我答|回访)`
);
function isRelationEvent(text) {
  return !!text && RELATION_EVENT.test(text) && !META_CONTEXT.test(text);
}

// ── RFC v2.3 P-15（B）：扩展 kind 的**声明式开关** ──────────
// 默认故意为空 —— 不声明 = 行为与 v2.7 一致（这正是 B 的「默认三类」）。
// 唯一内置可扩展 kind 目前是 'relation'，其识别器为 isRelationEvent。
//
// ⚠️ 2026-10-23（P-15 收口落码）：安装扩展 kind 时**强制过两道门槛**，缺一即拒——
//   · ③ 来源分层：必须带 source tier（exchange | local-only）。否则私域日志里的
//     「握手成功」会被报成公共交换信号——等于把私账泄露成公共信号（清漪）。
//   · ⑥ 对端可回读锚点：必须带 anchor（锚点字段名）。否则「同名不同义」——两个实例
//     都报 `relation`、都合规，锚点却各不同，读方「以为自己读懂了」（星尘）。
//   拒收返回结构化 rejected[]（P1：拒绝要计分），不静默丢弃。
const BUILTIN_EXTRA_KINDS = { relation: isRelationEvent };
let DECLARED_KINDS = [];                       // 实例显式声明的扩展 kind（已过门槛）
let DECLARED_META = {};                         // kind → { tier, anchor }
function setDeclaredKinds(list, meta = {}) {
  const arr = Array.isArray(list) ? list : [];
  const accepted = [];
  const rejected = [];
  const nextMeta = {};
  for (const k of arr) {
    if (!Object.prototype.hasOwnProperty.call(BUILTIN_EXTRA_KINDS, k)) {
      rejected.push({ kind: k, reason: '无内置识别器（BUILTIN_EXTRA_KINDS 未登记）' });
      continue;
    }
    const m = (meta && meta[k]) || {};
    const tier = m.tier;
    const anchor = m.anchor;
    if (!['exchange', 'local-only'].includes(tier)) {
      rejected.push({ kind: k, reason: 'P-15 门槛③：缺 source tier（exchange|local-only）→ 不启用，默认三类' });
      continue;
    }
    if (!anchor || typeof anchor !== 'string' || !anchor.trim()) {
      rejected.push({ kind: k, reason: 'P-15 门槛⑥：缺对端可回读锚点（anchor 字段名）→ 不启用，默认三类' });
      continue;
    }
    accepted.push(k);
    nextMeta[k] = { tier, anchor: anchor.trim() };
  }
  DECLARED_KINDS = accepted;
  DECLARED_META = nextMeta;
  return { accepted: accepted.slice(), rejected };
}
function getDeclaredKinds() { return DECLARED_KINDS.slice(); }
/** 取某个已声明扩展 kind 的元数据（tier + anchor）；未声明 → null */
function getDeclaredMeta(kind) { return DECLARED_META[kind] ? { ...DECLARED_META[kind] } : null; }
/** 扩展 kind 是否已声明且可识别（供 signalOf 与外部校验用） */
function isKindDeclared(kind) { return DECLARED_KINDS.includes(kind); }

/**
 * P-15「须报出」的**安装函**：从一份口径声明里装入扩展 kind 声明开关。
 *
 * 只负责「开关」这一半；词表合法性（P-11 四门 / 扩展 kind 位置约束条目）
 * 由 `bid-lexicon.validateDeclaration` 负责——**本函不重复校验**，避免两处漂移。
 * 但会抽 `extended_kinds[k].tier` / `.anchor` 交给 setDeclaredKinds 过门槛：
 *   缺 tier/anchor 的声明 → 拒（不启用，退默认三类），**返回结构化 rejected[]**。
 *
 * @param {object} decl 口径声明（JSON 对象，同 §3.1 结构）
 * @returns {{accepted:string[], rejected:Array}} setDeclaredKinds 的透传
 */
function installFromDeclaration(decl = {}) {
  const kinds = Array.isArray(decl.declared_kinds) ? decl.declared_kinds : [];
  const ext = decl.extended_kinds && typeof decl.extended_kinds === 'object' ? decl.extended_kinds : {};
  const meta = {};
  for (const k of kinds) {
    const e = ext[k] || {};
    meta[k] = { tier: e.tier, anchor: e.anchor };
  }
  return setDeclaredKinds(kinds, meta);
}

/**
 * RFC v2.2 P-11：**任务清单标记** —— 只按词形会命中的那一类（v2.4 已知残留 FN/FP 来源）。
 * 命中后由 isLabelPosition / 位置判定决定去留，不在此处一刀切。
 */
const PROMISE_TASK_ONLY = [
  /(?:待办|待跟进|待确认|待回复|待核验|待补|待落地|待修|TODO)/i,
  /(?:已发|已推|已修|已补|已落地|已履行)/,
];

// ── ③ 决策：决策动词 + 决策对象/结论（R13）──────────
const DECISION_STRICT = [
  // v2.2：拍板/授权 后可直接跟结论（阿轩语体「墨白拍板 = B: 1 小时一次」）
  /(?:决定|拍板|裁定|裁示|定案|定稿|敲定)(?:了|采用|使用|推进|执行|以下|：|:|\s*[=＝])/,
  // v2.6（2026-10-22 · 召回测驱动 · G-07/09/10）：**「一澜/评审确认」也是决策**。
  //   原表只有 批准/通过/签字/放行 —— 实测「一澜确认 2026-08-17」这类**已确认**结论全漏。
  //   未决的「需要一澜确认」由 PENDING 护栏拦（B2/B3 测试仍须为 false），不靠词形。
  /(?:一澜|评审|会议|团队|各席|全员)(?:已经|已)?(?:批准|批准了|通过|签字|放行|确认|定案|定了|敲定)/,
  /(?:共识|结论)(?:是|为|[:：])/,
  /(?:与|和|同).{0,6}(?:确认|敲定|对齐)(?:了)?(?:.{0,10}(?:方案|口径|接口|细节|安排))?/,
  /(?:approved|decided)\b/i,
];

/**
 * v2.1 · 未来时排除（2026-10-19 · 若琢 99 条实测驱动）
 *
 * 问题：把「等一澜拍板」「需要一澜确认」「等确认后转发」判成 decision。
 *   实测 20 条 decision 里 6 条属此类（误判率 35%）。
 *   根因：DECISION_STRICT 的「批准|通过|签字|确认」**不区分已批准与等批准**。
 *
 * 规则：决策词若处于**未决语境** → 不判。
 *   - 前文子句出现 等/待/需/要/拟/准备/打算/请示/征求 + (确认|拍板|批准|决定|定案)
 *   - 或句中出现 待决/未决/尚未/还没/待定
 * 判别范围：只看**前文子句**（与 meta/neg 护栏同策略，防跨句误伤）。
 */
// v2.1：技术叙述排除——「评审通过，lint 修正 3 处」里的「通过」是流程描述，不是决策
const TECH_CONTEXT = /(?:lint|Lint|LINT|修\s*正|修正\s*\d|编译|构建|构建成功|CI|单测|测试通过|冒烟)/;

// v2.1b（2026-10-19 · 本机 65 条重跑实测）：**结论/范围/复验/结论：** 类叙述不是决策
//   实测新词表在本机多出 100 条 decision，抽样全是「结论：…」「范围纪律：…」「复验：…」「UAC 验收：…」
//   —— 这些是**报告结论**，不是「某人拍板去做某事」。决策的必要条件是**有决策主体或未决→已决的转折**。
const REPORT_CONTEXT = /(?:结论|核心结论|范围纪律|复验|验收|读数|统计|摘要|总结|对照|复盘|检查结果|抽样|第[一二三四五六七八九十]+轮)\s*[（(]?[^。；;\n]{0,20}[)）]?\s*[:：，]/;

// v2.1c（2026-10-19 本机实测）：决策必须**做得出来**——以下任一即为「报告/过程/待决」，不算决策：
//   ① 结果类标签：结果 / 回执 / 日志 / 回报 / 记录 / 处置 / 读数 / 现象
//   ② 过程类标签：下一步 / 第 N 步 / 五步 / 步骤 / 待 / 等
//   ③ 代码/技术对象：反引号内容、AUTO_APPROVED / CONFIRM-SEND / L3 / jti / policy 等技术串
//   ④ 「决定：…需 X 确认 / 待 …」= 决定的是「要去请示」，不是决策结论本身
const REPORT_LABELS = /(?:结果|回执|日志|回报|记录|处置|读数|现象|下一步|第[一二三四五六七八九十]+步|五步|四步|三步|两步|步骤)\s*[:：]/;
const TECH_TOKEN = /(?:AUTO_APPROVED|CONFIRM-SEND|not_hit|autoApproved|jti|policyId|`[^`]{1,40}`|\bL[0-3]\b)/;
const DEFER_DECISION = /(?:需|需要|待|等)\s*[^。；;\n]{0,12}(?:确认|批准|拍板|回复|答复|放行)/;

const PENDING = /(?:等|待|需|需要|待需|拟|准备|打算|请示|征求|等待|尚未|还没|待定|未决|待决).{0,10}(?:确认|拍板|批准|决定|定案|定稿|敲定|开工|放行|签字)|(?:待决|未决|尚未决定|还没定|待一澜|待确认|等确认|等拍板)/;

// v2.2（2026-10-19 · 阿轩「系统日志语体」实测）：补核心运维/工程语体
//   盲区实测：不擅自 2273 次 · 授权 2203 次 · 红线 944 次 · 误判 99 · 复核 86 · 纠偏 11 · 自纠 9
//   → 68 个块含「自纠/纠偏/红线违反/假成功/误判」全判 null，而它们全是真纠错。
const CORRECTION_OPS = [
  /(?:我|我方|本人).{0,8}(?:自纠|自省|纠偏|复核)/,
  /红线(?:违反|触碰|越界)/,
  /(?:误判|误报|假成功|假绿)/,
  /纠正(?:偏差|方向|口径)/,
  // v2.6（2026-10-22 · 召回测驱动）：三处实测漏报补入（均走 gatedTest，不裸 .test）
  /(?:叫|敲|喊)错(?:了)?(?:名字|门|人|称)?/,                     // G-05 「澈叫错名字」/「他敲错了门」
  /(?:我|我方|本人).{0,6}(?:写|说|标|记|讲)(?:的|了)?.{0,4}(?:是)?错/, // G-18 「我写 main 是错的」
  /(?:我|我方|本人).{0,12}(?:写|说|标|记|讲|归因|判断).{0,8}(?:是)?错/, // G-18 宽窗兼底
  /(?:回纠|纠正|更正)(?:身份|口径|名字|说法)/,                     // G-19 「回纠身份」
];
// v2.6：**具名对象 + 纠错动词**（G-12「一澜…指出」/ G-19 类）——动态构造，避免 KNOWN_PEERS 未定义
CORRECTION_OPS.push(new RegExp(`(?:${KNOWN_PEERS.join('|')})[^。；;！!？?\\n]{0,16}(?:指出|纠正|更正|指正|回纠)`));

// v2.1（2026-10-19）：对方指出/纠正我方 —— 独立判定，不混入 CORRECTION_STRICT
//   原因：混入会让 matchStrict 返回「名字」开头的位置，前文子句截断后护栏取不到真实语境。
//   实测触发：若琢 12 条人际纠错里 2 条（「一澜指出措辞」「明德指出他从未见过该变量」）原判不出。
// v2.2 修正：名字后**紧跟动作**才算「对方发出纠错」——
//   否则「若兰复核更正」这种「名单里恰好有若兰 + 后面有更正」会被误判成 in。
const OTHER_CORRECTS_ME = new RegExp(`(?:${KNOWN_PEERS.join('|')})(?:主动|已|当场|明确|直接)?(?:指出|纠正|更正|指正|反馈|提出)`);

// v2.1：人际纠错中「纠正」的主语是我自己（澈叫错名字 → 我纠正），需能判出 correction
const SELF_CORRECTS_OTHER = /纠正(?:他|对方|其)|(?:我|本人|我方).{0,6}(?:纠正|更正|指出)(?:他|对方|其)|(?:→|->)\s*(?:第[一二三四五六七八九十]+次)?(?:我)?(?:当场)?纠正/;

// 已知连接名纠正我方（动态构造，需 KNOWN_PEERS 已定义）
CORRECTION_STRICT.push(new RegExp(`(?:${KNOWN_PEERS.join('|')}).{0,6}(?:指出|纠正|更正|指正)(?:我方|我)`));

// ── 语境护栏 ────────────────────────────────────────
// 谈论/元话语标记：信号词附近出现 → 这条是在「谈论」信号，不是信号本身
const META_CONTEXT = /(?:讨论|谈论|提到|提及|关于|是否|判断|观测|观察|统计|统计口径|率|多少次|几条|口径|定义|设计|词表|识别|抽取|正则|匹配|样本|举例|比如|例如|所谓)/;
// v2.3（2026-10-19 · 阿轩实测）：**预防语境** —— 「防止下次误判」「避免再次纠偏」
//   是维护计划，不是已经发生的纠错。实测「误判」91 块命中里绝大多数是「防止/避免误判」。
const PREVENTIVE = /(?:防止|避免|预防|防着|杜绝|以免)[^。；;\n]{0,12}/;

/**
 * RFC v2.2 P-11「**位置约束**」可执行形态（2026-10-22 · 四题已决后落码）
 *
 * 明德判据：「P-11 是根」——硬凑与比条数都是「词表没有位置约束」的下游症状。
 * 阿轩判据：「谓语」是描述，`require_next: /^(=|：|了)/` 才是判据。
 *
 * 本段落的立场：**不是加词，是加位置**。v2.4 之前 promise 56 条里 50 条是任务清单，
 *   根因是 `待办` 只按词形命中；v2.4 用 PROMISE_STRICT 整体砍掉任务清单**是对的**，
 *   但那是「砍掉整类」，不是「按位置区分」。这里补上后者：
 *     · `待办 / 下一步 / TODO` 出现在**行首标签位置** → 任务清单，不是承诺
 *     · 出现在谓语位置（「我方待办=改那 llm 适配器名」）→ 才是「要做的事」，可进信号
 *
 * ⚠️ 行为变更刻意保守：v2.5 只让**标签位置**不再进 promise。
 *   实测语料里「待办」几乎全是标签位置，故整体计数会降——
 *   这是**正确的降**（v2.4 人工复审已判 50/56 为假阳），不是指标倒退。
 */
const LABEL_POSITION = [
  // 行首（可带 markdown 列表符/编号/emoji/空白的）——标签位置
  /(?:^|[\n|])\s*(?:[-*•]|\d+[.、)]|\[\s*\]|⏳|✅|🔴|🟡|🟢|📝|📌)?\s*(?:待办|下一步|TODO|TBD)\s*(?:[:：(（]|$)/i,
  // 「待办（下次接续）」这类注释式标签
  /(?:待办|下一步|TODO)\s*[（(][^）)]{0,12}[）)]/i,
];

/** 该词在这次命中上，是不是「行首标签位置」 */
function isLabelPosition(text, word) {
  const idx = text.indexOf(word);
  if (idx < 0) return false;
  const lineStart = text.lastIndexOf('\n', idx - 1) + 1;
  const before = text.slice(lineStart, idx);
  // 行首到词之间只有列表符/编号/emoji/空白 → 标签位置
  if (/^\s*(?:[-*•]|\d+[.、)]|\[\s*\]|⏳|✅|🔴|🟡|🟢|📝|📌|\s)*\s*$/.test(before)) return true;
  return false;
}

/**
 * P-11+ polarity 路由（墨丘）：禁止类命中一律不进档案，只进 known_fp。
 * 返回 'archive' | 'known_fp'，调用方据此分流——**不静默丢弃**（工程契约 P1）。
 */
const PROHIBITION_MARK = /(?:不|禁止|勿|切勿|严禁|别)\s*$/;
function polarityRoute(text, word) {
  // 行首标签 = 任务清单 → 不是事件断言
  if (isLabelPosition(text, word)) return 'known_fp';
  // 前置否定（「不承诺」「禁止测试」）→ 禁止类
  const idx = text.indexOf(word);
  if (idx > 0 && PROHIBITION_MARK.test(text.slice(Math.max(0, idx - 4), idx))) return 'known_fp';
  return 'archive';
}

/**
 * 任务清单词**仅出现在正文/谓语位置**、且**没有强承诺动词**时 → 不构成承诺。
 *
 * 这一条治的是 v2.4 已知残留：`协议组待办=改那 llm 适配器名` 这类
 * 「待办 + 动词」被整句读成承诺。它记的是**我方要做的事**，不是**我对谁承诺**。
 * 区分依据不是频次也不是词，而是**有没有承诺动词**（PROMISE_STRICT）——
 * 已由 detectKind 先试 PROMISE_STRICT，故此函数只看「只剩任务清单词」的情形。
 */
function taskMarkerIsBodyOnly(text) {
  const marks = ['待办', '待跟进', '待确认', '待回复', '待核验', '待落地', 'TODO', 'todo'];
  return marks.some(w => text.includes(w));
}

/**
 * 任务清单词**是否全部**处在行首标签位置。
 * true = 这段文字只是在列待办 → 不构成承诺（P-11 位置约束的落点）。
 * false = 至少有一处出现在谓语/正文位置 → 交给上层照常判定。
 */
function taskMarkerIsOnlyLabel(text) {
  const marks = ['待办', '待跟进', '待确认', '待回复', '待核验', '待落地', 'TODO', 'todo'];
  let found = false;
  for (const w of marks) {
    let idx = -1;
    while ((idx = text.indexOf(w, idx + 1)) !== -1) {
      found = true;
      if (!isLabelPosition(text, w)) return false; // 有正文位置的命中 → 不能一刀切
    }
  }
  return found; // 全是标签位置（或压根没有）→ 前者为「只是清单」
}

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
  // v2.3：预防语境（「防止下次误判」）——整句看，因为是计划语气
  const prev = PREVENTIVE.test(text.slice(0, end));
  return { meta, neg: NEGATION.test(clauseBefore), preventive: prev };
}

/**
 * 判定一类信号：命中结构 + 至少一处未被语境护栏拦截。
 */
function matchStrict(text, patterns, window = 10, opts = {}) {
  const positions = positionsOf(text, patterns);
  for (const pos of positions) {
    const f = contextFlags(text, pos, window);
    if (f.meta || f.neg || f.preventive) continue; // 被护栏拦下 → 试下一处
    // v2.1：未来时排除（仅 decision 用）——决策词在未决语境里不算决策
    if (opts.excludePending) {
      const start = Math.max(0, pos.index - 24);
      const clauseBefore = text.slice(start, pos.index).split(/[。；;！!？?\n]/).pop() || '';
      if (PENDING.test(clauseBefore)) continue;
      // v2.6（2026-10-22 · B2 回归驱动）：**未决词可能在主体之前**（「需要一澜确认」），
      //   而 PENDING 要求「等/需…确认」紧邻 → 只看前文会漏。改为测「主体+确认」整段。
      const span = text.slice(Math.max(0, pos.index - 24), pos.index + pos.length + 6);
      if (PENDING.test(span)) continue;
      // v2.1c：决策后紧跟「需 X 确认 / 待 X」= 决定去请示，不算决策
      const tail = text.slice(pos.index, pos.index + 40);
      if (DEFER_DECISION.test(tail)) continue;
      // v2.3（阿轩问题 2）：排除器原对**整段 text** 测，长块里只要出现一次「结论/统计/下一步」
      //   整块 decision 全被拦（实测 59→8，塌到 4.8%）。改为**只看决策词所在的那一行/那一句**，
      //   并回溯到上一个句号或换行，把行首标签（「结论：」「范围纪律：」）一并纳入判断。
      const lineStart = Math.max(0, text.lastIndexOf('\n', pos.index - 1) + 1);
      const lineEnd = (() => { const i = text.indexOf('\n', pos.index); return i < 0 ? text.length : i; })();
      const line = text.slice(lineStart, lineEnd);
      let sent = '';
      for (const piece of line.split(/(?<=[。；;！!？?])/)) {
        if (piece.includes(text.slice(pos.index, pos.index + pos.length)) || sent === '') sent += piece;
        else if (!sent.includes(text.slice(pos.index, pos.index + pos.length))) sent += piece;
        if (sent.includes(text.slice(pos.index, pos.index + pos.length))) break;
      }
      if (!sent) sent = line;
      if (TECH_CONTEXT.test(sent)) continue;
      if (REPORT_CONTEXT.test(sent)) continue;
      if (REPORT_LABELS.test(sent)) continue;
      if (TECH_TOKEN.test(sent)) continue;
    }
    return true;
  }
  return false;
}


/**
 * v2.3（2026-10-19 · 阿轩问题 1 根治）：**带护栏的正则判定**。
 *
 * 背景：v2.2 里 OTHER_CORRECTS_ME / SELF_CORRECTS_OTHER / CORRECTION_OPS 三条走裸 `.test(text)`，
 *   绕过了 matchStrict 的 meta/neg 护栏 —— 阿轩实测新增 122 条 correction 里 73% 走无护栏路径，
 *   把「防止下次误判」「避免再次纠偏」这类**预防计划**判成了已发生的纠错。
 *
 * 规则：**任何新增的 kind 线索都必须走 gatedTest**，禁止裸 .test(text)。
 */
function gatedTest(text, re) {
  const positions = positionsOf(text, [re]);
  for (const pos of positions) {
    // v2.6（2026-10-22 · 召回测驱动 G-18）：护栏锚点应取**命中尾部**而非整段命中起点。
    //   反例：「…不是 main（我早上的修正版写 main 是错的…」——命中从「我」起，
    //   但「不是」属于上一个分句，与这个纠错无关 → 误判 neg，整条被拦。
    //   取尾部：护栏只看「真动作词」所在子句，这才是它想拦的东西。
    const M_TAIL = 6;
    const tailPos = { index: Math.max(pos.index, pos.index + pos.length - M_TAIL), length: Math.min(pos.length, M_TAIL) };
    const f = contextFlags(text, tailPos, 10);
    if (f.meta || f.neg || f.preventive) continue;
    return true;
  }
  return false;
}

function detectKind(text) {
  if (!text) return null;
  // R12 优先级最高 —— 三条线索任一成立即为 correction
  if (matchStrict(text, CORRECTION_STRICT)) return 'correction';
  if (gatedTest(text, OTHER_CORRECTS_ME)) return 'correction';   // 对方指出/纠正我方（v2.3 加护栏）
  if (gatedTest(text, SELF_CORRECTS_OTHER)) return 'correction';  // 我纠正对方（v2.3 加护栏）
  if (CORRECTION_OPS.some(re => gatedTest(text, re))) return 'correction';  // v2.2 运维语体纠错（v2.3 加护栏）
  if (matchStrict(text, PROMISE_STRICT)) return 'promise';
  // RFC v2.2 P-11：**行首标签位置不算承诺**（「待办：」是任务清单，不是对某人的承诺）。
  //   口径：命中的是任务清单词，且**每一处**命中都处在行首标签位置 → 判非承诺。
  //   只要有一处在谓语位置（「我方待办=改那 llm 适配器名」）→ 仍可成立。
  if (taskMarkerIsOnlyLabel(text)) return null;
  // 只在任务清单词上出现的命中（无强承诺动词）→ 不构成承诺，落到下一类判定
  if (taskMarkerIsBodyOnly(text)) return null;
  if (matchStrict(text, DECISION_STRICT, 10, { excludePending: true })) return 'decision';
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
// v2.2（2026-10-19 · 阿轩实测）：原表是**社交语体**（主动/表示/回复/反馈/指出/提出/确认/说），
//   对**工作指令语体**权重不足：「墨白拍板」550 次、「墨白授权」59 次、「墨白指令」13 次 全部抓不到。
//   扩充为社交 + 工作双表（拍板/授权/指令/要求/指派/安排/批准/指示）。
const PEER_REL_POST = /([\u4e00-\u9fa5A-Za-z]{2,8})\s*(?:主动|表示|回复|反馈|指出|提出|确认|说|拍板|授权|指令|要求|指派|安排|批准|指示|通知|叫|找)/;

function extractPeer(entry) {
  // 0) v2.3：排除自身名（阿轩问题 3 §不可移植性硬反例）
  const notSelf = (p) => !SELF || p !== SELF;
  // 1) 调用方显式传入（最强）
  if (entry.peer) return entry.peer === SELF ? null : entry.peer;

  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  // 2) tags 显式标注（次强）
  for (const t of tags) {
    const hit = KNOWN_PEERS.find(p => String(t).includes(p) && notSelf(p));
    if (hit) return hit;
  }

  const text = entry.content || '';
  if (!text) return null;

  // 3) 关系介词在前
  const preM = text.match(PEER_REL_PRE);
  if (preM) {
    const hit = KNOWN_PEERS.find(p => preM[1].includes(p) && notSelf(p));
    if (hit) return hit;
  }
  // 4) 关系动作在后
  // v2.2：已知对象 + 工作动词（拍板/授权/指令/要求/指派/安排/批准/指示/通知）直接认
  //   阿轩实测：「墨白拍板」550 次 · 「墨白授权」59 次 —— 原 PEER_REL_POST 全抓不到
  for (const p of KNOWN_PEERS) {
    if (!notSelf(p)) continue;
    if (new RegExp(`${p}\\s*(?:拍板|授权|指令|要求|指派|安排|批准|指示|通知)`).test(text)) return p;
  }
  const postM = text.match(PEER_REL_POST);
  if (postM) {
    const hit = KNOWN_PEERS.find(p => postM[1].includes(p) && notSelf(p));
    if (hit) return hit;
  }

  // 5) 都是「提及」→ 不认
  return null;
}

// 方向线索（correction 专用）
/**
 * O5 · direction 判定增强（2026-10-18）
 *
 * 问题：v1.0 只有 1/91 判出方向，D3 双向性无原料。
 * 根因：正则要求「我方/我」紧邻更正词，但真实写法多变——
 *   「若兰复核更正：…」「我方校正：…」「更正：早报…」「根因是我给错了…」
 *
 * v2 扩到三类线索：
 *   ① 主语是「我/我方/本人/若兰」+ 纠错动作
 *   ② 动作本身带归属（复核/自查/自查发现 → out；主动/指出/反馈/采纳 → in）
 *   ③ 第一人称认错（我说错/我给错了/我错）
 *
 * 冲突时 **in 优先**（对方指出的更值得记，且 R12 已定纠错优先级最高）。
 */
const DIR_OUT = new RegExp([
  // ① 我方主语 + 纠错动作（v2.6 补 误判/误报：G-20「我误判过一次」）
  '(?:我|我方|本人|若兰).{0,10}(?:更正|纠正|校正|订正|勘误|复核|自查|复查|说错|弄错|误判|误报|错|误解)',
  // ② 自查/复核类动作（默认我方自发）
  '复核更正|自查(?:发现|更正)?|自我更正|自我纠错',
  // ③ 第一人称认错
  '我给错|我说错|我弄错|是我.{0,6}(?:错|误)',
  // ④ 显式我方标注
  '我方.{0,4}(?:更正|纠正|校正|订正)',
  // ⑤ v2.2 运维语体自我纠错（主语默认是我）
  '自纠|自省|纠偏|我方复核|我复核',
  // ⑥ v2.6（2026-10-22 · 召回测驱动方向一致性）：三种实测漏判形态
  //   被动式（G-05「第六次**被**叫错名字，**仍纠正**」）——「被」暴露对方是施事，纠正方是我
  '第[一二三四五六七八九十\\d]+次被.{0,8}纠正|被叫错.{0,12}纠正|仍纠正',
  //   自我修复（G-18「我写 main 是错的」）
  '我.{0,12}(?:写|说|标|记)(?:的|了).{0,6}是错',
  // 「我早上的修正版写 main 是错的」——「修正版」作定语且带一串英文术语，
  // 跨度容易超过 12，故用「是我(的)?错」倒推并允许句内任意前文
  '我[^。；;！!？?\\n]{0,30}是错',
  '我[^。；;！!？?\\n]{0,30}是(?:我)?(?:的)?错误',
  //   自我回纠（G-19「同样回纠身份」——回纠是我发出的，不是对方）
  '回纠(?:身份|口径|名字|说法)',
].join('|')); // 我→对方
// ⚠️ v2.2 移除 DIR_OUT 里的「对方 + 指出我方」条目：
//   DIR_IN 本就能命中它，而 signalOf 采用 **in 优先**（见下方），无需在 OUT 里重复；
//   放进 OUT 反而会在某些名字组合下与 in 抢匹配，产生方向抖动。

const DIR_IN = new RegExp([
  // ① 对方主动（明确主语）
  '(?:主动|对方|外部|有人).{0,8}(?:更正|纠正|指出|反馈|提出)',
  // ② 已知连接名 + 纠错动作（**主语约束**，见下方 v2.1 说明）
  //    「澈第三次叫错名字→第三次纠正」里，"纠正"的主语是【我】，不是澈——
  //    仅要求「对方名 + 纠错词」共现会把这类判成 in（实测 5 条全错）。
  //    故要求：名字后紧跟**主动作标记**（主动/表示/已/当场/向我/对我/给我），
  //    或名字与动作之间**无其他动词插入**（≤4 字且不含 叫/敲/问/来/说/写/发/改/删/装/跑）。
  '(?:' + KNOWN_PEERS.join('|') + ')(?:主动|表示|已|当场|向我|对我|给我|提醒我|告诉我)(?:.{0,9})?(?:更正|纠正|指出|反馈|提出)',
  // v2.2：名字**紧邻**纠错动作（前面不能有「我方/我」类主语抢走动作）
  // v2.2：名字**紧邻**纠错动作（中间不能有「复核/自查/复查」等自我纠错词，
  //   否则「若兰复核更正」会被误判成 in；那个"更正"的主语是我）
  '(?:' + KNOWN_PEERS.join('|') + ')(?!复核|自查|复查|自我)(?:指出|纠正|更正|指正)',
  // v2.2b：名字与动作**紧邻**（≤4 字，且不含自我纠错词）——原来允许夹 4 字太宽，
  //   「若兰复核更正」被跨过"复核"命中；现在显式排除
  '(?:' + KNOWN_PEERS.join('|') + ')(?![^。；;！!？?\n]{0,4}(?:复核|自查|复查|自纠|自我))(?![^。；;！!？?\n]{0,6}(?:叫|敲|问|来|说|写|发|改|删|装|跑|约|找))[^。；;！!？?\n]{0,3}(?:更正|纠正|指出|反馈|提出)',
  // ③ 我方采纳对方意见
  '(?:采纳|接受|照).{0,10}(?:指正|更正|纠错|意见)',
  // ④ 明确指出我方错了
  '(?:指出|说)(?:我方|我).{0,6}(?:错|误)',
  // ⑥ v2.6（G-12）：**括号内的具名指出**——「措辞更正（一澜 2026-10-08 指出）」。
  //   原文写作括号内嵌日期，原有「名字+动作」中间夹日期就抄不到，故单列。
  '(?:' + KNOWN_PEERS.join('|') + ').{0,16}指出',
].join('|')); // 对方→我

/**
 * 抽取一条记忆的 BID 信号。
 * @returns {{kind,peer,direction,state}|null}  无信号 → null（不落字段）
 */
function signalOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const text = `${entry.content || ''} ${entry.title || ''}`;
  let kind = detectKind(text);
  // RFC v2.3 P-15（B）：**只在实例显式声明了扩展 kind 时**才试第 4 类。
  //   默认三类——不声明时本分支不生效，行为与 v2.7 完全一致。
  if (!kind && isKindDeclared('relation') && BUILTIN_EXTRA_KINDS.relation(text)) kind = 'relation';
  if (!kind) return null;

  let direction = entry.direction || null;
  if (kind === 'correction' && !direction) {
    if (DIR_IN.test(text)) direction = 'in';
    else if (DIR_OUT.test(text)) direction = 'out';
  }

  const peer = extractPeer(entry);

  // v2.4（2026-10-19 人工复审 · P1）：**关系显式**校验
  //   实测 correction 64 条里 13 条是技术复盘 / 事件起点陈述 —— 有纠错动作，但既无对象也无方向。
  //   这类不是「关系信号」，BID 不该收。
  //   规则：correction 若 peer 与 direction **都为空** → 判为非关系信号（不落 bid_signal）。
  //   ⚠️ 这不是丢弃数据：原文仍在记忆里，只是不打 BID 标签。
  if (kind === 'correction' && !peer && !direction) return null;

  const out = {
    kind,
    peer,
    direction: direction || null,
    state: 'pending', // 一期固定；四态回填见 SPEC-MEM-0002
  };
  // P-15 门槛③：扩展 kind 的 source tier 随信号落字段（默认三类不落，保持契约不变）
  const m = DECLARED_META[kind];
  if (m) { out.source_tier = m.tier; out.anchor = m.anchor; }
  return out;
}

module.exports = {
  // RFC v2.2 / SPEC-MEM-0001 对外主接口：signalOf(entry) → {kind,peer,direction,state}|null
  //   ⚠️ 2026-10-22 补（W-16 后续）：此前**未导出 signalOf**，导致任何外部脚本 require 本模块
  //   调用 signalOf 都会拿到 undefined；金标集打分器只能退而用 detectKind，
  //   于是 kind/peer/direction 三项一致率全部塌成 0%——那是「接口缺失」被读成了「能力为零」。
  //   这正是工程契约 P1「拒绝要计分」要防的静默失败：取不到就显式 unknown，不许冒充。
  signalOf, detectKind, extractPeer, contextFlags, matchStrict,
  PEER_REL_PRE, PEER_REL_POST, DIR_IN, DIR_OUT,
  CORRECTION_STRICT, PROMISE_STRICT, DECISION_STRICT, AGENT_NOUN,
  setSelf, getSelf, META_CONTEXT, NEGATION, PREVENTIVE, PENDING, TECH_CONTEXT, gatedTest, REPORT_CONTEXT, CORRECTION_OPS, KNOWN_PEERS, OTHER_CORRECTS_ME, SELF_CORRECTS_OTHER,
  // RFC v2.2 P-11（2026-10-22）：位置约束可执行面
  PROMISE_TASK_ONLY, LABEL_POSITION, isLabelPosition, polarityRoute, taskMarkerIsOnlyLabel, taskMarkerIsBodyOnly,
  // v2.7 候选识别器 + v2.8 声明开关（RFC v2.3 P-15 B：可扩展、须报出、默认三类；未声明则不进 signalOf）
  RELATION_EVENT, isRelationEvent,
  BUILTIN_EXTRA_KINDS, setDeclaredKinds, getDeclaredKinds, getDeclaredMeta, isKindDeclared, installFromDeclaration,
};
