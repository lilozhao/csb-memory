/**
 * raw-retype.js — 🔧 底仓类型修复：把被压平的 conversation 还原成真实类型
 *
 * 背景（2026-10-24）：sync-daily.js 曾把 inferType() 判出的 lesson/discovery/
 * fix/promise/todo 全部压成 type=conversation 才写入底仓；而 dream.js 的
 * DISTILLABLE 只认 decision/proposal/response/milestone/lesson ⇒ 这批流水
 * 「天生不可蒸馏」，做梦连续多日 0 新增（10-23 全 45 条被跳过）。
 *
 * 本脚本只做一件事：用与 sync-daily 完全相同的 inferType() 重新推断
 * type=conversation 的**未封口**流水，把非 event 的类型写回。
 * - 不改 content / ts / verification_evidence（证据链原样保留）
 * - 已封口（distilled_to 非空）的流水不动（幂等，无需重蒸）
 * - 原始类型留痕在 meta.retyped（from → to, at），可回溯、可撤销
 *
 * 用法：
 *   node scripts/raw-retype.js --dry        # 只预览分布，不写
 *   node scripts/raw-retype.js --apply      # 实际写回
 */

const fs = require('fs');
const path = require('path');
const raw = require('../lib/raw/raw');

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;

// 与 sync-daily.js 保持逐字一致（改一处必须改两处）
function inferType(text) {
  if (/^承诺|^约定|^誓言|答应你|我承诺|约定是/.test(text)) return 'promise';
  if (/决定|确定|确认|拍板|采用/.test(text)) return 'decision';
  if (/教训|踩坑|学到了|经验/.test(text)) return 'lesson';
  if (/发布|完成|上线|里程碑|达成/.test(text)) return 'milestone';
  if (/新增|加入|认识|报到|发现|建立/.test(text)) return 'discovery';
  if (/待办|TODO|要记得|需要/.test(text)) return 'todo';
  if (/修复|bug|问题|报错/.test(text)) return 'fix';
  return 'event';
}

// 与 raw.markState 同规格的变更留痕：每次写回追加一条哈希链审计事件
// （action=type_change；本脚本仅动 type/meta.retyped，content 与证据原样保留）
function logTypeChange(item, at) {
  try {
    raw.appendEvolution({
      id: 'evo_retype_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      action: 'type_change',
      raw_id: item.id,
      from: item.from,
      to: item.to,
      intent: 'raw-retype-2026-10-24',
      outcome: 'success',
      at,
    });
  } catch (e) {
    console.log(`  ⚠️  留痕失败 ${item.id}：${e.message}`);
  }
}

function rawFiles() {
  const dir = raw.getRawDir();
  return fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function main() {
  console.log(`🔧 底仓类型修复（${DRY ? 'DRY-RUN 预览' : 'APPLY 写回'}）\n`);
  const dist = {};
  const byDay = {};
  const plan = []; // {file, id, from, to}
  let scanned = 0;
  let sealedSkipped = 0;

  for (const file of rawFiles()) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    let dirty = false;
    const out = lines.map((line) => {
      let s;
      try { s = JSON.parse(line); } catch { return line; }
      scanned++;
      if (s.type !== 'conversation') return line;
      if (s.distilled_to && s.distilled_to.length) { sealedSkipped++; return line; }
      const body = String(s.content || '').replace(/^\[[^\]]*\]\s*/, '');
      const t = inferType(body);
      if (t === 'event') return line;
      dist[t] = (dist[t] || 0) + 1;
      const day = path.basename(file, '.jsonl');
      byDay[day] = (byDay[day] || 0) + 1;
      plan.push({ file, id: s.id, from: s.type, to: t });
      if (DRY) return line;
      s.meta = { ...(s.meta || {}), retyped: { from: s.type, to: t, at: new Date().toISOString() } };
      s.type = t;
      dirty = true;
      return JSON.stringify(s);
    });
    if (dirty && APPLY) raw.atomicWrite(file, out.join('\n') + '\n');
  }

  if (APPLY) {
    const at = new Date().toISOString();
    for (const p of plan) logTypeChange(p, at);
  }

  console.log(`扫描流水 ${scanned} 条 · 已封口跳过 ${sealedSkipped} 条`);
  console.log(`可还原类型：${plan.length} 条`, dist);
  const days = Object.keys(byDay).sort();
  console.log(`涉及 ${days.length} 天（近 10 天）：`);
  for (const d of days.slice(-10)) console.log(`  ${d}  ${byDay[d]} 条`);
  if (DRY) console.log('\n⏸ DRY-RUN：未写入。确认后执行 node scripts/raw-retype.js --apply');
  else console.log('\n✅ 已写回。下一步：node scripts/dream.js --agent 若兰 --all');
}

main();
