/**
 * bid-lexicon.test.js — RFC v2.2 P-11 / P-12 判据验收
 * 运行：node test/bid-lexicon.test.js
 *
 * 每一组都在验「门能拦住」，而不只是「门能放行」——
 * 这才是 RFC P-12「空清单 = 未完成」在本仓的可执行形态。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const lex = require('../lib/core/bid-lexicon');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }
}
function rejects(r, needle) {
  return !r.ok && r.reasons.some(x => String(x).includes(needle));
}

console.log('══ RFC v2.2 P-11 / P-12 判据验收 ══');

const goodEntry = {
  word: '承诺', pos: '谓语', require_next: '/^(了|：|:|明天)/',
  evidence: '我承诺明天完成这件事',
};

// ── P-11 ① word ──
console.log('\nP-11.① word 非空');
ok('正常条目通过', lex.checkEntry(goodEntry).ok);
ok('无 word → 拒', rejects(lex.checkEntry({ ...goodEntry, word: '' }), 'word 为空'));
ok('空白 word → 拒', rejects(lex.checkEntry({ ...goodEntry, word: '   ' }), 'word 为空'));

// ── P-11 ② pos ──
console.log('\nP-11.② pos 必填且在枚举内');
ok('中文别名「谓语」归一为 predicate', lex.checkEntry(goodEntry).normalized.pos === 'predicate');
ok('英文 predicate 通过', lex.checkEntry({ ...goodEntry, pos: 'predicate' }).ok);
ok('缺 pos → 拒', rejects(lex.checkEntry({ ...goodEntry, pos: undefined }), 'pos 缺失'));
ok('非法 pos「什么位置都行」→ 拒（不猜）', rejects(lex.checkEntry({ ...goodEntry, pos: '什么位置都行' }), '不在枚举内'));
ok('v2.5 新增 标签/label 位置可用', lex.checkEntry({ ...goodEntry, pos: '标签', polarity: '禁止' }).ok);

// ── P-11 ③ require_next 可执行 ──
console.log('\nP-11.③ require_next 必须是可执行正则');
ok('缺 require_next → 拒（只写 pos 拦不住误判）', rejects(lex.checkEntry({ ...goodEntry, require_next: '' }), 'require_next 缺失'));
ok('裸字符串「后接了」→ 拒（不可执行）', rejects(lex.checkEntry({ ...goodEntry, require_next: '后接了' }), '不是 /pattern/flags'));
ok('编译失败的正则 → 拒', rejects(lex.checkEntry({ ...goodEntry, require_next: '/([a/' }), '编译失败'));
ok('空壳 .* → 拒（匹配一切=没有位置约束）', rejects(lex.checkEntry({ ...goodEntry, require_next: '/.*/' }), '空壳正则'));

// ── P-11 ④ evidence 必须是真命中句 ──
console.log('\nP-11.④ evidence 必须原文真命中');
ok('缺 evidence → 拒', rejects(lex.checkEntry({ ...goodEntry, evidence: '' }), 'evidence 缺失'));
ok('evidence 里没有 word → 拒', rejects(lex.checkEntry({ ...goodEntry, evidence: '我今天完成了这件事' }), '没有 word 本身'));
// 关键负例：这是 v0.1 金标集踩过的坑（转述 vs 原文）
ok('evidence 有 word 但不满足 require_next → 拒（转述句/口径不实）',
  rejects(lex.checkEntry({ ...goodEntry, evidence: '我的承诺是真诚' }), '没满足 require_next'));

// ── P-11+ polarity ──
console.log('\nP-11+ polarity');
ok('断言 → 进档案', lex.applyPolarity('assertion').route === 'archive');
ok('禁止 → 只进 known_fp（不进档案）',
  lex.applyPolarity('禁止').route === 'known_fp' && lex.applyPolarity('prohibition').route === 'known_fp');
ok('疑问 → 只进 known_fp', lex.applyPolarity('question').accept === false);
ok('未标 polarity → 按断言处理（推荐字段不阻断）', lex.applyPolarity(null).accept === true);
ok('非法 polarity → 拒', rejects(lex.checkEntry({ ...goodEntry, polarity: '大概吧' }), '不合法'));
ok('标签位置 + 断言 → 拒（「待办：」不是事件断言）',
  rejects(lex.checkEntry({ ...goodEntry, pos: '标签', polarity: '断言' }), '与 polarity=assertion 冲突'));

// ── P-12 ──
console.log('\nP-12 强制清单');
ok('裸「无」→ 拒（等于短一点的「暂无」）', lex.checkEmptyClaim('无').ok === false);
ok('「暂无」→ 拒', lex.checkEmptyClaim('暂无').ok === false);
ok('「在这批 99 条上没观察到 X」→ 通过', lex.checkEmptyClaim('在这批 99 条上没观察到 X').ok === true);
ok('known_misses 缺失 → 拒', rejects(lex.checkLimits({ known_fp: [{ type: 'x' }] }), 'known_misses 缺失'));
ok('known_misses 空且无理由 → 拒（沉默不可与没做区分）',
  rejects(lex.checkLimits({ known_misses: [], known_fp: [{ type: 'x' }] }), '未写理由'));
ok('known_misses 空但有理由 → 通过（允许空，不允许沉默）',
  lex.checkLimits({ known_misses: [], known_misses_why: '本批 99 条人工逐条核过，无未登记盲点', known_fp: [{ type: 'x' }] }).ok === true);
ok('条目无实测句 → 拒', rejects(lex.checkLimits({ known_misses: [{ why: '空口' }], known_fp: [{ type: 'x' }] }), '没有实测句'));
ok('条数低于下限 → 拒', rejects(lex.checkLimits({ min_items: 3, known_misses: [{ sentence: 'a' }], known_fp: [{ type: 'x' }, { type: 'y' }, { type: 'z' }] }), '低于下限'));

// ── 整套声明 ──
console.log('\n口径声明 §3.1');
const declPath = path.join(__dirname, '..', 'config', 'bid-declaration-ruolan-v2.5.json');
ok('本仓 v2.5 声明通过三道门', lex.validateDeclaration(JSON.parse(fs.readFileSync(declPath, 'utf8'))).ok);
ok('P2 无 instance → 拒（身份不许有默认值）',
  rejects(lex.validateDeclaration({ corpus: { type: 'diary', granularity: 'entry' }, wordlist: { entries: [goodEntry] }, limits: { known_misses: [{ sentence: 'a' }], known_fp: [{ type: 'x' }] }, metadata: { genre: 'g', baseline: 'b', scope: 's' } }), 'instance 缺失'));
ok('metadata 缺一 → 拒（不报则不可被引用）',
  rejects(lex.validateDeclaration({ instance: 'x', corpus: { type: 'diary', granularity: 'entry' }, wordlist: { entries: [goodEntry] }, limits: { known_misses: [{ sentence: 'a' }], known_fp: [{ type: 'x' }] }, metadata: { genre: 'g', baseline: 'b' } }), 'metadata.scope 缺失'));

console.log(`\n通过: ${pass}\n失败: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
