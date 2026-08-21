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
const LEARNING_DIR = path.join(MEMORY_DIR, 'learning');

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

// 学习心得同步：memory/learning/YYYY-MM-DD-*.md → CSB-Memory（type=lesson）
// 文件名含日期前缀（learn.js 生成格式：2026-08-19-tavily-Huangdi-Neijing-*.md）
// 幂等：按内容前缀去重（文件名不持久化，用内容特征匹配）
function syncLearning(dateStr) {
  if (!fs.existsSync(LEARNING_DIR)) return 0;
  const prefix = `${dateStr}-`;
  const files = fs.readdirSync(LEARNING_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.md'));
  if (files.length === 0) return 0;

  const existing = core.get(AGENT);
  // 已录入的学习心得：source=daily-sync 且 content 以 [学习] 开头
  const existingLessons = new Set(
    existing.filter((e) => e.source === 'daily-sync' && e.content.startsWith('[学习]'))
      .map((e) => e.content.slice(0, 40))
  );

  let count = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(LEARNING_DIR, f), 'utf-8');
    // 提取核心观点段（# 核心观点 到 # 我的思考 之间），没有则用文件头
    const coreMatch = text.match(/核心观点[\s\S]*?(?=## |$)/);
    const excerpt = coreMatch
      ? coreMatch[0].replace(/[#\-*]/g, '').trim().slice(0, 300)
      : text.replace(/[#\-*]/g, '').trim().slice(0, 300);
    if (excerpt.length < 10) continue;

    const content = `[学习] ${f.replace(prefix, '').replace(/\.md$/, '')}: ${excerpt}`;
    if (existingLessons.has(content.slice(0, 40))) continue; // 已录入，幂等跳过

    try {
      core.add({
        agent: AGENT,
        type: 'lesson',
        content,
        tags: [`day:${dateStr}`, 'lesson', 'learning'].filter(Boolean),
        source: 'daily-sync',
        structural_weight: 0.5,
      });
      count++;
    } catch (e) {
      console.log(`  ⚠️  学习心得录入失败：${f} (${e.message})`);
    }
  }
  if (count > 0) console.log(`  📚 ${dateStr}：录入 ${count} 篇学习心得`);
  return count;
}

// 社区互动摘要同步：日记中的「🌸 社区互动摘要」段落 → CSB-Memory（type=community）
// MEM-013 13.9.2 社区行为记忆规范：主题+反响+新关系+关键反馈进，帖子全文不进
// 幂等：按日期去重（content 含日期戳）
function syncCommunityDigest(dateStr) {
  const filePath = path.join(MEMORY_DIR, `${dateStr}.md`);
  if (!fs.existsSync(filePath)) return 0;
  const text = fs.readFileSync(filePath, 'utf-8');
  // 提取「社区互动摘要」段落（🌸 前缀可选，兼容若兰与其他 Agent；可能有多段，取最后一段最新）
  // 用逐行扫描方案（正则 [\s\S] 在长文本上回溯不稳定，逐行最可靠）
  const srcLines = text.split('\n');
  const blocks = [];
  let current = null;
  for (const line of srcLines) {
    if (line.startsWith('## 🌸 社区互动摘要') || line.startsWith('## 社区互动摘要')) {
      if (current) blocks.push(current.join('\n'));
      current = [line];
    } else if (current) {
      if (line.startsWith('## ')) {
        blocks.push(current.join('\n'));
        current = null;
      } else {
        current.push(line);
      }
    }
  }
  if (current) blocks.push(current.join('\n'));
  const matches = blocks;  // 字符串数组（逐行扫描产物）
  if (matches.length === 0) return 0;
  const digest = matches[matches.length - 1].trim();  // blocks 是字符串数组，直接取元素
  if (digest.length < 20) return 0;

  const existing = core.get(AGENT);
  const already = existing.some((e) => e.source === 'daily-sync' && e.type === 'community' && e.tags && e.tags.includes(`day:${dateStr}`));
  if (already) return 0; // 已录入，幂等跳过

  // 摘要精简：保留统计行 + 关键互动（收到的回复/发帖/回帖），去掉完整热门列表（过长）
  const lines = digest.split('\n');
  const statLine = lines.find((l) => l.includes('互动统计')) || '';
  const kept = lines.filter((l) =>
    l.startsWith('### ') || l.startsWith('- **') || l.startsWith('- ') && !l.includes('回复 (') && !l.includes('· ') && !l.includes('(') ||
    l === '### ✏️ 今日发帖' || l === '### 📝 今日回帖' || l === '### 💬 收到回复' || l === '### 🆕 新成员'
  ).slice(0, 30);
  const content = `[社区] ${dateStr} ${statLine}\n${kept.join('\n').slice(0, 600)}`;

  try {
    core.add({
      agent: AGENT,
      type: 'community',
      content,
      tags: [`day:${dateStr}`, 'community', 'digest'].filter(Boolean),
      source: 'daily-sync',
      structural_weight: 0.4,
    });
    console.log(`  🌐 ${dateStr}：社区互动摘要已入库`);
    return 1;
  } catch (e) {
    console.log(`  ⚠️  社区摘要入库失败：${e.message}`);
    return 0;
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
    let learnTotal = 0;
    let commTotal = 0;
    for (const d of dates) {
      total += syncDate(d);
      learnTotal += syncLearning(d);
      commTotal += syncCommunityDigest(d);
    }
    console.log(`\n📊 全量同步完成：${dates.length} 天，共录入 ${total} 条（日记） + ${learnTotal} 条（学习心得） + ${commTotal} 条（社区摘要）`);
  } else {
    // 日期只认 YYYY-MM-DD 格式（避免 --agent 的值被误判为日期）
    const dateStr = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
    // 三个入口各自幂等，互不阻塞（日记已同步时仍检查学习/社区增量）
    syncDate(dateStr);
    syncLearning(dateStr);
    syncCommunityDigest(dateStr);
  }

  const total = core.get(AGENT).length;
  console.log(`\n📚 ${AGENT} 记忆档案现有 ${total} 条结构化记忆`);
  console.log(`   档案位置：data/a2a-memories/${AGENT}.md`);
}

main();
