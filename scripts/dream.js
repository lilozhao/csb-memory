/**
 * dream.js — 🌙 做梦：底仓流水 → 蒸馏结论
 *
 * 对应 Cteno 视频的 dream 概念：夜里把白天的流水账整理成知识。
 * 协议依据：MEM-012 13.6 derived_from 硬字段（蒸馏结论必须可溯源到底仓）。
 *
 * 规则蒸馏（无需 LLM）：
 * - 读取指定日期 data/raw/ 流水
 * - 对未蒸馏（distilled_to 为空）的 decision/proposal/response/milestone 类流水
 * - 生成结构化结论记忆（core.add，带 derived_from）
 * - raw.link 自动封口（sealed）
 *
 * 用法：
 *   node scripts/dream.js                 # 蒸馏今天（默认 agent：若兰）
 *   node scripts/dream.js 2026-08-19      # 蒸馏指定日期
 *   node scripts/dream.js --agent 阿轩     # 指定 agent（每人跑自己的梦）
 *   node scripts/dream.js --all           # 蒸馏全部未蒸馏流水
 *
 * 幂等：已封口（distilled_to 非空）的流水自动跳过。
 */

const fs = require('fs');
const path = require('path');
const core = require('../lib/core/memory');
const raw = require('../lib/raw/raw');
const gate = require('../lib/promotion/promotion-gate');

// agent 可配置（--agent 参数或环境变量），默认若兰
function resolveAgent(args) {
  const idx = args.indexOf('--agent');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  const v = process.env.CSB_MEMORY_AGENT;
  if (!v) { console.error('❌ 未指定目标 Agent：请用 --agent <名字> 或环境变量 CSB_MEMORY_AGENT（禁止静默默认）'); process.exit(2); }
  return v;
}

const AGENT = resolveAgent(process.argv.slice(2));

// 值得蒸馏的流水类型
const DISTILLABLE = ['decision', 'proposal', 'response', 'milestone', 'lesson'];

// 流水类型 → 结论记忆类型
function mapType(rawType) {
  switch (rawType) {
    case 'decision': return 'decision';
    case 'proposal': return 'discovery';
    case 'response': return 'lesson';
    case 'milestone': return 'milestone';
    case 'lesson': return 'lesson';
    default: return 'event';
  }
}

// 蒸馏一条流水 → 返回结论记忆（或 null 跳过）
function distill(stream) {
  // 已蒸馏过的跳过（幂等）
  if (stream.distilled_to && stream.distilled_to.length > 0) return null;
  if (!DISTILLABLE.includes(stream.type)) return null;
  // 太短的不值得蒸馏
  if (stream.content.length < 12) return null;

  // P0-2 晋升门槛：无有效可核实证据 → 拒绝晋升（留在 raw，降权不删除）
  const gateCheck = gate.canPromote(stream, { producer: AGENT });
  if (!gateCheck.can) {
    return { skipped: true, reason: `no_verification_evidence:${gateCheck.reason}` };
  }

  const type = mapType(stream.type);
  const entry = {
    agent: AGENT,
    type,
    content: stream.content, // 结论内容 = 流水原文（规则蒸馏不加工）
    tags: ['dream', `day:${stream.ts.slice(0, 10)}`, stream.session, type].filter(Boolean).slice(0, 5),
    source: 'dream',
    structural_weight: type === 'decision' ? 0.6 : (type === 'milestone' ? 0.6 : 0.0),
    derived_from: stream.id, // 硬字段：结论指回底仓
    verification_evidence: stream.verification_evidence, // P0-2：晋升记录带证据（落档 frontmatter）
  };
  const result = core.add(entry);
  // 底仓自动封口 + 双向索引
  raw.link(stream.id, result.id, { intent: 'dream-distill' });
  return { streamId: stream.id, memId: result.id, type };
}

function dreamDate(dateStr) {
  const streams = raw.query(dateStr);
  let distilled = 0;
  let skipped = 0;
  let gated = 0;
  const gatedIds = [];
  for (const s of streams) {
    const r = distill(s);
    if (r) {
      if (r.skipped) {
        skipped++;
        if (r.reason && r.reason.startsWith('no_verification_evidence')) {
          gated++;
          gatedIds.push(s.id);
        }
      } else {
        distilled++;
        console.log(`  🌙 [${r.type}] ${s.id} → ${r.memId}（已封口）`);
      }
    } else {
      skipped++;
    }
  }
  // P0-2：晋升率告警（可验证资产 <80% 带证据 = 流水质量信号）
  if (gated > 0) {
    const rate = distilled / (distilled + gated);
    if (rate < 0.8) {
      console.log(`  ⚠️ P0-2 晋升率 ${(rate * 100).toFixed(0)}%（<80%）：${gated} 条流水无有效可核实证据被拒（留在 raw 不删除）`);
    }
  }
  return { total: streams.length, distilled, skipped, gated, gatedIds };
}

function main() {
  const args = process.argv.slice(2);
  console.log(`🌙 做梦：底仓流水 → 蒸馏结论（agent: ${AGENT}）\n`);

  // 日期参数 = 第一个符合 YYYY-MM-DD 格式的参数（避免 --agent 的值被误判）+ 过滤 --agent 后续值
  const dateStr = args.find((a, i) => /^\d{4}-\d{2}-\d{2}$/.test(a) && args[i - 1] !== '--agent') || new Date().toISOString().slice(0, 10);

  if (args.includes('--all')) {
    // 全部日期
    const dir = raw.getRawDir();
    if (!fs.existsSync(dir)) {
      console.log('❌ 底仓目录不存在：' + dir);
      process.exit(1);
    }
    const dates = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => f.replace('.jsonl', ''))
      .sort();
    let total = 0, distilled = 0;
    for (const d of dates) {
      const r = dreamDate(d);
      total += r.total;
      distilled += r.distilled;
    }
    console.log(`\n📊 全量做梦完成：${dates.length} 天流水，蒸馏 ${distilled} 条结论`);
  } else {
    const r = dreamDate(dateStr);
    console.log(`\n📊 ${dateStr}：流水 ${r.total} 条，蒸馏 ${r.distilled} 条结论，跳过 ${r.skipped} 条`);
  }

  const stats = raw.stats();
  console.log(`📚 底仓现状：共 ${stats.total} 条 · 封口 ${stats.byState.sealed} 条`);
  console.log(`   ${AGENT} 结构化记忆：${core.get(AGENT).length} 条`);
}

main();
