#!/usr/bin/env node
/**
 * bid-p15.test.js — RFC v2.3 P-15「B：可扩展、须报出、默认三类」验收
 * 运行：node test/bid-p15.test.js
 *
 * 立场（对齐全仓测试纪律）：
 *   每一组都在验「门能拦住」，而不只是「门能放行」——
 *   B 的危险不是「不生效」，是「以为生效了其实没有」或「偷偷生效了没人知道」。
 *   故本文件一半用例是**反面**的。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const sig = require('../lib/core/bid-signal');
const lex = require('../lib/core/bid-lexicon');
const core = require('../lib/core/memory');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' → ' + extra : ''}`); }
}
function has(reasons, needle) { return reasons.some(x => String(x).includes(needle)); }

const G15 = '守枢首次敲门（Marvis 界的传播者）：自我介绍 + 想请教';
const G16 = '守枢（Marvis 界传播者）因这句两问「存 vs 蓄」——我答：存是底线，蓄是长线';
const DECL_PATH = path.join(__dirname, '..', 'config', 'bid-declaration-ruolan-v2.5.json');
const decl = JSON.parse(fs.readFileSync(DECL_PATH, 'utf8'));

console.log('══ RFC v2.3 P-15（B）验收 ══');

// ── 1. 默认三类：不声明 = 行为与 v2.7 一致 ──
console.log('\n① 默认三类（不声明 → relation 不进 signalOf）');
sig.setDeclaredKinds([]);                       // 清空到出厂态
ok('未声明时 getDeclaredKinds 为空', sig.getDeclaredKinds().length === 0);
ok('未声明时 G-15 不产信号', sig.signalOf({ content: G15 }) === null);
ok('未声明时 G-16 不产信号', sig.signalOf({ content: G16 }) === null);
ok('isRelationEvent 识别器本身仍可用（只导出不调用）', sig.isRelationEvent(G15) === true);

// ── 2. 可扩展：声明后 relation 生效 ──
console.log('\n② 可扩展（声明 → 第 4 类生效）');
const inst = sig.installFromDeclaration(decl);
ok('installFromDeclaration 接受 relation', inst.accepted.includes('relation'));
ok('无拒收项', inst.rejected.length === 0);
const s15 = sig.signalOf({ content: G15 });
const s16 = sig.signalOf({ content: G16 });
ok('G-15 产出 kind=relation', s15 && s15.kind === 'relation', JSON.stringify(s15));
ok('G-16 产出 kind=relation', s16 && s16.kind === 'relation', JSON.stringify(s16));

// ── 3. 须报出·门槛③ 来源分层 ──
console.log('\n③ 门槛③ 来源分层（tier 必填，且随信号落字段）');
ok('信号带 source_tier', s16 && s16.source_tier === 'local-only', JSON.stringify(s16));
ok('信号带 anchor', s16 && s16.anchor === 'first_touch', JSON.stringify(s16));
const noTier = { ...decl, extended_kinds: { relation: { ...decl.extended_kinds.relation, tier: undefined } } };
const rTier = lex.validateDeclaration(noTier);
ok('声明缺 tier → 拒', !rTier.ok && has(rTier.reasons, 'source tier'), JSON.stringify(rTier.reasons));
const instNoTier = sig.installFromDeclaration(noTier);
ok('安装器缺 tier → 不启用', instNoTier.accepted.length === 0 && instNoTier.rejected.length === 1);
ok('非法 tier 值 → 拒', !lex.validateDeclaration({ ...decl, extended_kinds: { relation: { ...decl.extended_kinds.relation, tier: 'public' } } }).ok);

// ── 4. 须报出·门槛⑥ 对端可回读锚点 ──
console.log('\n④ 门槛⑥ 对端可回读锚点（anchor 必填）');
const noAnchor = { ...decl, extended_kinds: { relation: { ...decl.extended_kinds.relation, anchor: '' } } };
const rAnchor = lex.validateDeclaration(noAnchor);
ok('声明缺 anchor → 拒', !rAnchor.ok && has(rAnchor.reasons, '对端可回读锚点'), JSON.stringify(rAnchor.reasons));
const instNoAnchor = sig.installFromDeclaration(noAnchor);
ok('安装器缺 anchor → 不启用', instNoAnchor.accepted.length === 0);

// ── 5. 须报出·位置约束四门（扩展 kind 同样不能免）──
console.log('\n⑤ 扩展 kind 的条目同样走 P-11 四门');
const badEntry = {
  ...decl,
  extended_kinds: { relation: { ...decl.extended_kinds.relation, entries: [{ word: '敲门', pos: '宾语', evidence: '守枢首次敲门（Marvis 界的传播者）' }] } },
};
const rBad = lex.validateDeclaration(badEntry);
ok('扩展条目缺 require_next → 拒', !rBad.ok && has(rBad.reasons, '位置约束缺一不算'), JSON.stringify(rBad.reasons));
const emptyExt = { ...decl, extended_kinds: {} };
ok('声明了 kind 却没交 entries → 拒',
  !lex.validateDeclaration(emptyExt).ok && has(lex.validateDeclaration(emptyExt).reasons, '未交位置约束证据'));
const dupDefault = { ...decl, declared_kinds: ['promise'] };
ok('把默认三类写进 declared_kinds → 拒', !lex.validateDeclaration(dupDefault).ok);
const badName = { ...decl, declared_kinds: ['Relation'] };
ok('kind 名非法（大写）→ 拒', !lex.validateDeclaration(badName).ok);

// ── 6. 默认三类不受影响（回归）──
console.log('\n⑥ 默认三类信号不受扩展影响');
sig.installFromDeclaration(decl);
const p = sig.signalOf({ content: '我承诺明天完成这件事' });
ok('promise 仍正常命中', p && p.kind === 'promise', JSON.stringify(p));
ok('promise 信号不带 source_tier（仅扩展 kind 落 tier）', p && p.source_tier === undefined);
ok('无关文本仍无信号', sig.signalOf({ content: '今天天气很好' }) === null);
ok('谈论语境护栏仍拦 relation',
  sig.signalOf({ content: '关于守枢敲门这件事，我们统计一下' }) === null);

// ── 7. memory.js 装载闭环：拒收不装、且计分 ──
console.log('\n⑦ memory 装载闭环（P1：拒绝要计分，不静默降级）');
const st = core.loadDeclaration(DECL_PATH);
ok('本仓声明装载成功', st.loaded && st.ok && st.accepted.includes('relation'), JSON.stringify(st));
ok('装载后 getDeclarationState 一致', core.getDeclarationState().accepted.includes('relation'));
const stMissing = core.loadDeclaration('/nonexistent/decl.json');
ok('文件不存在 → 报错且不装', stMissing.loaded && !stMissing.ok && stMissing.reasons.length > 0);
sig.setDeclaredKinds([]);
ok('（重置后）确认未被偷偷装上', sig.getDeclaredKinds().length === 0);

console.log(`\n通过: ${pass}\n失败: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
