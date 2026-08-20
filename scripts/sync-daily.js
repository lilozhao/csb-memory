/**
 * sync-daily.js — 日常记忆同步：日记 → CSB-Memory 结构化档案
 *
 * 把 workspace/memory/YYYY-MM-DD.md 中的时间戳事件
 * 同步录入 csb-memory（自动推断类型、打情感标签、结构化权重）。
 *
 * 用法：
 *   node scripts/sync-daily.js [日期，默认今天]
 *   node scripts/sync-daily.js --all          # 全量导入（幂等，按日期去重）
 *   node scripts/sync-daily.js --agent 阿轩    # 指定 agent（默认若兰）
 *
 * 设计原则：日记全文留在 memory/（OpenClaw 原生），
 * csb-memory 只存结构化条目（可检索、可衰减、可传播）。
 *
 * 重要会话判据（v1.1 协议 13.8）：
 *   命中以下任一判据的事件，除录入结构化档案外，还会写入 RAW 底仓：
 *   1. 拍板/决策/约定类对话（含 决定|确认|拍板|采用|共识|敲定|同意|选|定）
 *   2. 含工具结果摘要的会话（含 评测|报告|结果|测试|验证|成功|完成|产出）
 *   3. 情感显著波动（含 感动|震撼|重要|珍惜|难过|惊喜|难忘|突破）
 *   4. 多 Agent 讨论/圆桌/协议组会话（含 圆桌|讨论|四人行|协议组|评审）
 *   命中后写入 RAW（state=burning，等待 dream.js 蒸馏封口）。
 */

const fs = require('fs');
const path = require('path');
const core = require('../lib/core/memory');
const raw = require('../lib/raw/raw');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'memory');

// agent 可配置（--agent 参数或环境变量），默认若兰
function resolveAgent(args) {
  const idx = args.indexOf('--agent');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return process.env.CSB_MEMORY_AGENT || '若兰';
}
const AGENT = resolveAgent(process.argv.slice(2));

// 类型推断：关键词 → 记忆类型
function inferType(text) {
  if (/^承诺|^约定|^誓言|答应你|我承诺|约定是/.test(text)) return 'promise';
  if (/决定|确定|确认|拍板|采用/.test(text)) return 'decision';
  if (/教训|踩坑|学到了|经验/.test(text)) return 'lesson';
  if (/发布|完成|上线|里程碑|达成|✅/.test(text)) return 'milestone';
  if (/新增|加入|认识|报到|发现|建立/.test(text)) return 'discovery';
  if (/待办|TODO|要记得|需要/.test(text)) return 'todo';
  if (/修复|bug|问题|报错/.test(text)) return 'fix';
  return 'event';
}

// 类型 → 结构性权重（身份/承诺类高权重）
function structuralWeight(type, text) {
  if (type === 'promise') return 0.9;
  if (/^我是若兰|^我的身份|^价值观|^原则/.test(text)) return 1.0;
  if (type === 'decision' || type === 'milestone') return 0.6;
  return 0.0;
}

// 提取日期文件中的事件行（时间戳行 或 列表项）
function extractEvents(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  const lines = text.split('\n');
  const events = [];
  let currentSection = '';
  let currentEvent = null;

  for (const line of lines) {
    // 标题行 → 作为 section 上下文
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      currentSection = heading[1].trim();
      continue;
    }
    // 表格行 / 分隔线 / 空行跳过
    if (line.startsWith('|') || line.startsWith('---') || !line.trim()) continue;

    // 时间戳事件行：**HH:MM** 或 - **HH:MM** 或 - HH:MM
    const ts = line.match(/^\s*[-*]?\s*\*{0,2}(\d{1,2}:\d{2})\*{0,2}\s*(.*)/);
    // 列表项（顶层有序/无序）：1. **标题**：内容 或 - **标题**：内容（嵌套缩进跳过）
    const bullet = line.match(/^\s{0,2}(?:\d+\.\s+|[-*]\s+)(?:\*\*)?([^*]+)(?:\*\*)?[：:]?\s*(.*)/);
    if (ts && ts[2].trim()) {
      if (currentEvent) events.push(currentEvent);
      currentEvent = { time: ts[1], text: ts[2].trim(), section: currentSection };
    } else if (bullet && bullet[1].trim().length >= 4) {
      const title = bullet[1].trim();
      const rest = (bullet[2] || '').trim();
      // 标题本身含描述（如 "**协议整合**：xxx"）→ 合并；否则单独成条
      if (currentEvent) events.push(currentEvent);
      currentEvent = {
        time: '',
        text: rest ? `${title}：${rest}` : title,
        section: currentSection,
      };
    }
    // 注意：不做续行拼接，保持条目干净（段落细节留在日记原文）
  }
  if (currentEvent) events.push(currentEvent);
  return events;
}

// 检查该日期是否已同步（幂等）
// 只认 source=daily-sync 自己写的记录，避免 dream.js 蒸馏结论的 day: 标签误伤
function alreadySynced(dateStr) {
  const existing = core.get(AGENT);
  return existing.some((e) => e.source === 'daily-sync' && e.tags && e.tags.includes(`day:${dateStr}`));
}

// 重要会话判据（v1.1 协议 13.8 三选一 + 多 Agent 讨论扩展）
// 命中 → 除结构化档案外，还写入 RAW 底仓（等待 dream.js 蒸馏）
const IMPORTANT_PATTERNS = [
  // 判据2：拍板/决策/约定
  /决定|确认|拍板|采用|共识|敲定|同意|选定|批准/,
  // 判据1：含工具结果摘要（评测/报告/测试/验证/产出）
  /评测|报告|结果|测试|验证|通过|产出|发布|上线/,
  // 判据3：情感显著波动
  /感动|震撼|重要|珍惜|难忘|突破|惊喜|珍贵/,
  // 判据4（扩展）：多 Agent 讨论/圆桌/协议组
  /圆桌|讨论|四人行|协议组|评审|会议/,
];

function isImportant(text) {
  return IMPORTANT_PATTERNS.some((re) => re.test(text));
}

// 写入 RAW 底仓（幂等：同一内容不重复写）
function appendToRaw(dateStr, ev, type) {
  try {
    const existing = raw.query(dateStr, { session: 'daily-sync' });
    const fullContent = `[${ev.time || dateStr}] ${ev.text}`;
    // 幂等匹配：已有流水包含完整内容或仅时间前缀不同（如 [08:00] vs [2026-08-19]）
    if (existing.some((r) => r.content === fullContent || r.content.endsWith(ev.text))) {
      return false; // 已存在，幂等跳过
    }
    raw.append({
      ts: `${dateStr}T00:00:00.000Z`, // 按内容日期归档（而非当前时间）
      session: 'daily-sync',
      type: ['decision', 'milestone'].includes(type) ? type : 'conversation',
      content: fullContent,
      state: 'burning',
      meta: { section: ev.section || '', important: true },
    });
    return true;
  } catch (e) {
    console.log(`  ⚠️  RAW 写入失败：${e.message}`);
    return false;
  }
}

function syncDate(dateStr) {
  const filePath = path.join(MEMORY_DIR, `${dateStr}.md`);
  if (!fs.existsSync(filePath)) {
    console.log(`  ⏭️  ${dateStr}.md 不存在，跳过`);
    return 0;
  }
  const synced = alreadySynced(dateStr);
  const events = extractEvents(filePath);
  let rawAdded = 0;

  // 已同步但 RAW 可能缺失（v1.1 升级前的历史日期）→ 补写重要会话到底仓
  if (synced) {
    for (const ev of events) {
      if (ev.text.length >= 8 && isImportant(ev.text)) {
        if (appendToRaw(dateStr, ev, inferType(ev.text))) rawAdded++;
      }
    }
    if (rawAdded > 0) {
      console.log(`  🔄 ${dateStr} 已同步过，补写 ${rawAdded} 条重要会话到 RAW 底仓`);
    } else {
      console.log(`  ⏭️  ${dateStr} 已同步过（幂等跳过）`);
    }
    return rawAdded;
  }

  let count = 0;
  for (const ev of events) {
    if (ev.text.length < 8) continue; // 太短的碎片不录
    const type = inferType(ev.text);
    const entry = {
      agent: AGENT,
      type,
      content: `[${ev.time}] ${ev.text}`,
      tags: [`day:${dateStr}`, type, ev.section].filter(Boolean).slice(0, 5),
      source: 'daily-sync',
      structural_weight: structuralWeight(type, ev.text),
    };
    try {
      core.add(entry);
      count++;
      // 重要会话 → 同时进 RAW 底仓（v1.1 协议 13.8）
      if (isImportant(ev.text)) {
        appendToRaw(dateStr, ev, type);
      }
    } catch (e) {
      console.log(`  ⚠️  录入失败：${ev.text.slice(0, 30)}… (${e.message})`);
    }
  }
  console.log(`  ✅ ${dateStr}：录入 ${count} 条（共 ${events.length} 个事件）`);
  return count;
}

function main() {
  const args = process.argv.slice(2);
  console.log('🌸 日常记忆同步：日记 → CSB-Memory\n');

  if (args.includes('--all')) {
    // 全量：按文件名排序导入所有日期
    if (!fs.existsSync(MEMORY_DIR)) {
      console.log(`❌ memory 目录不存在：${MEMORY_DIR}`);
      process.exit(1);
    }
    const dates = fs.readdirSync(MEMORY_DIR)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map((f) => f.replace('.md', ''))
      .sort();
    let total = 0;
    for (const d of dates) total += syncDate(d);
    console.log(`\n📊 全量同步完成：${dates.length} 天，共录入 ${total} 条`);
  } else {
    // 日期只认 YYYY-MM-DD 格式（避免 --agent 的值被误判为日期）
    const dateStr = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
    syncDate(dateStr);
  }

  const total = core.get(AGENT).length;
  console.log(`\n📚 ${AGENT} 记忆档案现有 ${total} 条结构化记忆`);
  console.log(`   档案位置：data/a2a-memories/${AGENT}.md`);
}

main();
