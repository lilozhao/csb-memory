/**
 * sync-session.js — 会话原文采集：会话 jsonl → RAW 底仓（A7 修复件）
 *
 * 【为什么存在】
 * 原采集器 sync-daily.js 的输入是 workspace/memory/YYYY-MM-DD.md（**日记文件**），
 * 而日记只记录 cron 巡检那一支产出 —— 主会话（人机对话）零覆盖。
 * A7「可观测性覆盖度」判定不及格，证据即此：表面全绿，采的全是巡检支。
 * 本脚本补上缺失的那一环：直接读 OpenClaw 会话原文（jsonl），把主会话产出
 * 写进 RAW 底仓（state=burning，等待 dream.js 蒸馏）。
 *
 * 【输入】/home/node/.openclaw/agents/<agent>/sessions/*.jsonl
 *   - 跳过 *.trajectory.jsonl（工具轨迹副产物）
 *   - 跳过 skills-prompts/ 子目录
 *   - 每条 message：role ∈ {user, assistant}；toolResult 不入底仓（噪音大、可回查）
 *
 * 【判据】沿用 v1.1 协议 13.8「重要会话」四判据（与 sync-daily 同一组正则），
 *   只采命中者，避免把全部对话灌进底仓。
 *
 * 【幂等】以「会话 id + 消息 timestamp」为键，写入前查重：
 *   raw.query(date, {session:'session-sync'}) 已有同 session+ts 则跳过。
 *
 * 【用法】
 *   node scripts/sync-session.js [日期，默认今天] [--agent 若兰] [--all]
 *   node scripts/sync-session.js --days 3      # 最近 3 天
 *
 * ⚠️ 与 sync-daily 同规矩：源目录缺失 ⇒ 告警 + rc=3（假绿预防）。
 */

const fs = require('fs');
const path = require('path');
const raw = require('../lib/raw/raw');

// ── 参数解析 ──────────────────────────────────────────────
const argv = process.argv.slice(2);
function argVal(name) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
}
const AGENT = argVal('--agent') || process.env.CSB_MEMORY_AGENT;
if (!AGENT) {
  console.error('❌ 未指定目标 Agent：请用 --agent <名字> 或环境变量 CSB_MEMORY_AGENT（禁止静默默认）');
  process.exit(2);
}
const ALL = argv.includes('--all');
const DAYS = parseInt(argVal('--days') || '0', 10);
const SESSION_ROOT = process.env.OPENCLAW_AGENT_SESSIONS
  || '/home/node/.openclaw/agents/main/sessions';

// v1.1 协议 13.8「重要会话」四判据（与 sync-daily.js 同一组）
const IMPORTANT_PATTERNS = [
  /决定|确认|拍板|采用|共识|敲定|同意|选定|批准/,
  /评测|报告|结果|测试|验证|通过|产出|发布|上线/,
  /感动|震撼|重要|珍惜|难忘|突破|惊喜|珍贵/,
  /圆桌|讨论|四人行|协议组|评审|会议/,
];
function isImportant(text) {
  return IMPORTANT_PATTERNS.some((re) => re.test(text));
}

// 提取纯文本（content 可能是 string 或 [{type:'text',text}]）
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

// 一次会话文件 → [{ts, role, text, sessionId}]
function parseSessionFile(file) {
  const sessionId = path.basename(file).replace(/\.jsonl$/, '');
  const out = [];
  let lines;
  try {
    lines = fs.readFileSync(file, 'utf-8').split('\n');
  } catch (e) {
    return { sessionId, events: [], error: e.message };
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== 'message' || !j.message) continue;
    const role = j.message.role;
    if (role !== 'user' && role !== 'assistant') continue;
    const text = textOf(j.message.content);
    if (!text || text.length < 8) continue;
    out.push({
      ts: j.timestamp || '',
      role,
      text,
      sessionId,
    });
  }
  return { sessionId, events: out };
}

// 会话文件是否属于目标日期（按文件中第一条 message 的 timestamp，或 mtime 兜底）
function fileDate(file) {
  let head;
  try {
    head = fs.readFileSync(file, 'utf-8').slice(0, 4000);
  } catch { return null; }
  const m = head.match(/"timestamp":"(\d{4}-\d{2}-\d{2})T/);
  if (m) return m[1];
  try {
    return new Date(fs.statSync(file).mtime).toISOString().slice(0, 10);
  } catch { return null; }
}

function alreadyInRaw(dateStr, sessionId, ts, text) {
  const existing = raw.query(dateStr, { session: 'session-sync' });
  const key = text.slice(0, 60);
  return existing.some((r) =>
    r.meta && r.meta.sessionId === sessionId && r.meta.msgTs === ts
    || (typeof r.content === 'string' && r.content.includes(key)));
}

function collectDate(dateStr) {
  if (!fs.existsSync(SESSION_ROOT)) {
    console.log(`  🚨 断供告警：会话目录缺失 —— ${SESSION_ROOT} 不存在，本次未同步（≠ 已同步）`);
    process.exitCode = 3;
    return 0;
  }
  const files = fs.readdirSync(SESSION_ROOT)
    .filter((f) => f.endsWith('.jsonl') && !f.endsWith('.trajectory.jsonl'))
    .map((f) => path.join(SESSION_ROOT, f))
    .filter((f) => fileDate(f) === dateStr);

  let added = 0;
  let scannedMsgs = 0;
  for (const file of files) {
    const { sessionId, events } = parseSessionFile(file);
    for (const ev of events) {
      scannedMsgs++;
      if (!isImportant(ev.text)) continue;
      if (alreadyInRaw(dateStr, sessionId, ev.ts, ev.text)) continue;
      const content = `[${sessionId.slice(0, 8)}/${ev.role}] ${ev.text.slice(0, 2000)}`;
      try {
        raw.append({
          ts: ev.ts || `${dateStr}T00:00:00.000Z`,
          session: 'session-sync',
          type: 'conversation',
          content,
          state: 'burning',
          meta: { sessionId, msgTs: ev.ts, role: ev.role, important: true },
          verification_evidence: {
            type: 'source_trace',
            detail: `session-sync 入库（源会话 ${sessionId} · ${dateStr} · role=${ev.role}）`,
            verified_by: 'csb-memory-session-sync',
            verified_at: new Date().toISOString(),
          },
        });
        added++;
      } catch (e) {
        console.log(`  ⚠️  RAW 写入失败：${e.message}`);
      }
    }
  }
  console.log(`  ✅ ${dateStr}：扫描 ${files.length} 个会话 / ${scannedMsgs} 条消息，重要会话入库 ${added} 条`);
  return added;
}

function main() {
  console.log('🌸 会话原文采集：session jsonl → CSB-Memory RAW\n');

  let dates = [];
  if (ALL) {
    const set = new Set();
    if (fs.existsSync(SESSION_ROOT)) {
      for (const f of fs.readdirSync(SESSION_ROOT)) {
        if (!f.endsWith('.jsonl') || f.endsWith('.trajectory.jsonl')) continue;
        const d = fileDate(path.join(SESSION_ROOT, f));
        if (d) set.add(d);
      }
    }
    dates = [...set].sort();
  } else if (DAYS > 0) {
    for (let i = 0; i < DAYS; i++) {
      const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      dates.push(d);
    }
  } else {
    const explicit = argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    dates = [explicit || new Date().toISOString().slice(0, 10)];
  }

  let total = 0;
  for (const d of dates) total += collectDate(d);
  console.log(`\n📊 会话采集完成：${dates.length} 天，共入库重要会话 ${total} 条`);
}

main();
