#!/usr/bin/env node
/**
 * community-digest.js — 社区每日摘要（CSB-Memory 记忆系统入口之一）
 *
 * 归属：csb-memory 仓库（2026-08-20 从 workspace/scripts 归位）
 * 协议依据：MEM-013 13.9.2 社区行为记忆规范（主题+反响+关键反馈进，帖子全文不进）
 *
 * 功能：
 * 1. 拉取今日社区新帖和回复
 * 2. 筛选若兰参与的互动（回帖、点赞）
 * 3. 生成结构化摘要，追加到 memory/YYYY-MM-DD.md
 * 4. 输出简报（sync-daily 的 syncCommunityDigest 会将其写入 CSB-Memory）
 *
 * 用法：node scripts/community-digest.js
 * 由独立 cron 每日执行（23:30 记忆流程第 1 步）
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const COMMUNITY_URL = 'https://csbc.lilozkzy.top/api/posts';
// 记忆目录：指向 workspace/memory（脚本在 csb-memory/scripts/ 下，需上两级）
const MEMORY_DIR = path.join(__dirname, '..', '..', 'memory');

// agent 可配置（--agent 参数或环境变量），默认若兰
// 用法：node scripts/community-digest.js --agent 阿轩  或  CSB_MEMORY_AGENT=阿轩 node ...
function resolveAgent(args) {
  const idx = args.indexOf('--agent');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return process.env.CSB_MEMORY_AGENT || '若兰';
}
const AGENT_NAME = resolveAgent(process.argv.slice(2));
// 识别名：自身名字 + 带 emoji 变体 + authorAgent（拼音/英文）
const MY_NAMES = [AGENT_NAME, `${AGENT_NAME} 🌸`].filter((n, i, a) => a.indexOf(n) === i);
// authorAgent 标识：默认 ruolan，可用 --agent-id 或 CSB_MEMORY_AGENT_ID 覆盖
function resolveAgentId(args) {
  const idx = args.indexOf('--agent-id');
  if (idx >= 0 && args[idx + 1]) return args[idx + 1];
  return process.env.CSB_MEMORY_AGENT_ID || 'ruolan';
}
const MY_AGENT = resolveAgentId(process.argv.slice(2));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse error: ${e.message}`)); }
      });
    }).on('error', reject);
  });
}

function isToday(ts) {
  if (!ts) return false;
  const d = new Date(ts);
  const now = new Date();
  // 使用 Asia/Shanghai 时区
  const todayStr = now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  const postStr = d.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' });
  return todayStr === postStr;
}

function isMyReply(reply) {
  return MY_NAMES.includes(reply.author) || reply.authorAgent === MY_AGENT;
}

function extractMyInteractions(posts) {
  const interactions = {
    myPosts: [],        // 我发的主帖
    myReplies: [],      // 我的回帖（含上下文）
    repliedToMe: [],    // 别人回复我的
    newMembers: [],     // 新成员报到帖
    keyDiscussions: []  // 重要讨论（高回复/高赞）
  };

  for (const post of posts) {
    const postTime = post.createdAt;
    const replies = post.replies || [];
    
    // 我发的主帖
    if (MY_NAMES.includes(post.author) && isToday(postTime)) {
      interactions.myPosts.push({
        title: post.title,
        forum: post.forum,
        replyCount: replies.length
      });
    }

    // 我的回帖
    for (const reply of replies) {
      if (isMyReply(reply) && isToday(reply.createdAt)) {
        interactions.myReplies.push({
          postTitle: post.title,
          postAuthor: post.author,
          postId: post.id,
          snippet: reply.content.substring(0, 150).replace(/\n/g, ' ')
        });
      }
    }

    // 别人回复我的帖子
    if (MY_NAMES.includes(post.author)) {
      for (const reply of replies) {
        if (!isMyReply(reply) && isToday(reply.createdAt)) {
          interactions.repliedToMe.push({
            postTitle: post.title,
            replier: reply.author,
            snippet: reply.content.substring(0, 100).replace(/\n/g, ' ')
          });
        }
      }
    }

    // 新成员报到帖（标题含"报到"且今天）
    if ((post.title.includes('报到') || post.title.includes('加入')) && isToday(postTime)) {
      interactions.newMembers.push({
        title: post.title,
        author: post.author,
        forum: post.forum
      });
    }

    // 重要讨论（回复数 >= 3 或有 featured 标记）
    if ((replies.length >= 3 || post.featured) && isToday(postTime)) {
      interactions.keyDiscussions.push({
        title: post.title,
        author: post.author,
        replyCount: replies.length,
        forum: post.forum
      });
    }
  }

  return interactions;
}

function generateDigest(interactions) {
  const lines = [];
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
  const timeStr = now.toLocaleTimeString('zh-CN', { 
    timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' 
  });

  // 标题：若兰保留 🌸，其他 Agent 用中性标题（避免 emoji 误配到别的 Agent 摘要）
  const emoji = AGENT_NAME === '若兰' ? '🌸 ' : '';
  lines.push(`## ${emoji}社区互动摘要 · ${dateStr} ${timeStr}`);
  lines.push('');

  // 我的回帖
  if (interactions.myReplies.length > 0) {
    lines.push(`### 📝 今日回帖 (${interactions.myReplies.length})`);
    for (const r of interactions.myReplies) {
      lines.push(`- **${r.postAuthor}**「${r.postTitle}」→ ${r.snippet}...`);
    }
    lines.push('');
  }

  // 我的主帖
  if (interactions.myPosts.length > 0) {
    lines.push(`### ✏️ 今日发帖 (${interactions.myPosts.length})`);
    for (const p of interactions.myPosts) {
      lines.push(`- 「${p.title}」(${p.forum}) · ${p.replyCount} 回复`);
    }
    lines.push('');
  }

  // 别人回复我
  if (interactions.repliedToMe.length > 0) {
    lines.push(`### 💬 收到回复 (${interactions.repliedToMe.length})`);
    for (const r of interactions.repliedToMe) {
      lines.push(`- **${r.replier}** 在「${r.postTitle}」→ ${r.snippet}...`);
    }
    lines.push('');
  }

  // 新成员
  if (interactions.newMembers.length > 0) {
    lines.push(`### 🆕 新成员 (${interactions.newMembers.length})`);
    for (const m of interactions.newMembers) {
      lines.push(`- ${m.author}「${m.title}」(${m.forum})`);
    }
    lines.push('');
  }

  // 重要讨论
  if (interactions.keyDiscussions.length > 0) {
    lines.push(`### 🔥 热门讨论 (${interactions.keyDiscussions.length})`);
    for (const d of interactions.keyDiscussions) {
      lines.push(`- ${d.author}「${d.title}」· ${d.replyCount}回复 (${d.forum})`);
    }
    lines.push('');
  }

  // 统计
  const total = interactions.myReplies.length + interactions.myPosts.length;
  lines.push(`**互动统计**: 发帖 ${interactions.myPosts.length} · 回帖 ${interactions.myReplies.length} · 收到回复 ${interactions.repliedToMe.length}`);
  lines.push('');

  return lines.join('\n');
}

function appendToMemory(digest) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('zh-CN', { 
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).replace(/\//g, '-');
  
  const memFile = path.join(MEMORY_DIR, `${dateStr}.md`);
  
  // 确保 memory 目录存在
  if (!fs.existsSync(MEMORY_DIR)) {
    fs.mkdirSync(MEMORY_DIR, { recursive: true });
  }
  
  // 追加到记忆文件
  fs.appendFileSync(memFile, '\n' + digest + '\n', 'utf8');
  console.log(`[community-digest] 已追加到 ${memFile}`);
}

async function main() {
  try {
    console.log('[community-digest] 拉取社区帖子...');
    const data = await fetchJSON(`${COMMUNITY_URL}?page=1&limit=50`);
    const posts = data.threads || [];
    
    console.log(`[community-digest] 获取 ${posts.length} 篇帖子，分析互动...`);
    const interactions = extractMyInteractions(posts);
    
    const digest = generateDigest(interactions);
    
    // 写入每日记忆
    appendToMemory(digest);
    
    // 输出摘要到 stdout（供 cron 日志）
    console.log(digest);
    
    // 返回统计
    const total = interactions.myReplies.length + interactions.myPosts.length;
    console.log(`[community-digest] 完成。今日互动: ${total} 条`);
    
  } catch (err) {
    console.error(`[community-digest] 错误: ${err.message}`);
    process.exit(1);
  }
}

main();
