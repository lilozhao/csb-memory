#!/usr/bin/env node
/**
 * memory.js — CSB-Memory v0.4 本地 API 实现
 * 
 * 基于v0.2渐进升级，新增v0.4特性：
 *   - 结构性权重 (structural_weight, is_core_identity)
 *   - 溯源链 (provenance)
 *   - 权重衰减遗忘 (weight decay)
 *   - 情感标签 (affective_tag)
 * 
 * 核心方法：
 *   - memory.add(entry)
 *   - memory.get(agentName)
 *   - memory.query(filter)
 *   - memory.summary(agent, count)
 *   - memory.delete(id)
 *   - memory.feedback(targetId, type, content, reason)  // v0.4新增
 */

const fs = require('fs');
const path = require('path');
const audit = require('./audit-log');
const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');

// 模块加载即确保数据目录存在（全新 clone 无 data/ 目录时测试/写入不挂）
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// v0.4 新增：衰减系数和阈值
const DECAY_LAMBDA = 0.01;  // 衰减系数
const FORGET_THRESHOLD = 0.01;  // 遗忘阈值
const RESTORE_WEIGHT = 0.1;  // 恢复权重

function safeFilename(name) {
  return name.replace(/[^\w\u4e00-\u9fff]/g, '_') + '.md';
}

function getFilePath(agentName) {
  return path.join(MEMORY_DIR, safeFilename(agentName));
}

function generateId() {
  return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
}

function formatTimestamp(iso) {
  if (iso) return iso;
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().replace('Z', '+08:00');
}

// 解析纯YAML行（不带外层的 ---）
function parseYamlLines(text) {
  const meta = {};
  let inJsonField = null;
  let jsonBuffer = '';
  
  for (const line of text.split('\n')) {
    // 处理多行JSON字段（provenance, affective_tag）
    if (inJsonField) {
      jsonBuffer += line;
      if (line.trim().startsWith(']') || line.trim().startsWith('}')) {
        try {
          meta[inJsonField] = JSON.parse(jsonBuffer);
        } catch (e) {
          meta[inJsonField] = jsonBuffer;
        }
        inJsonField = null;
        jsonBuffer = '';
      }
      continue;
    }
    
    const m = line.match(/^(\w+):\s*(.+)/);
    if (m) {
      let val = m[2].trim();
      // JSON字段开始
      if (val.startsWith('[') || val.startsWith('{')) {
        // 单行JSON
        try {
          meta[m[1]] = JSON.parse(val);
        } catch (e) {
          // 单行非JSON数组（如 [承诺, 碳硅契]）→ 逗号分隔解析
          if (val.startsWith('[') && val.endsWith(']')) {
            meta[m[1]] = val.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
          } else {
            // 多行JSON，继续收集
            inJsonField = m[1];
            jsonBuffer = val;
          }
        }
      } else {
        val = val.replace(/^"|"$/g, '');
        // 布尔值转换
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        // 数值转换
        else if (!isNaN(val) && val !== '') val = parseFloat(val);
        meta[m[1]] = val;
      }
    }
  }
  return meta;
}

// 生成 YAML front matter 文本
// 自动判断置信度
function autoConfidence(text) {
  const keywords = ["确认","决定","同意","完成","发布","定稿","通过","正式","已","✅","announced","finalized","completed","confirmed"];
  const lowWords = ["可能","也许","大概","猜测","听说","maybe","perhaps","guess","heard"];
  const t = text.slice(0, 200);
  const hasHigh = keywords.some(k => t.includes(k));
  const hasLow = lowWords.some(k => t.includes(k));
  if (hasHigh) return "high";
  if (hasLow) return "low";
  return "medium";
}

function toFrontMatter(entry) {
  // 未指定置信度时自动判断
  if (!entry.confidence && entry.content) {
    entry.confidence = autoConfidence(entry.content);
  }
  
  // v0.4: 结构性权重默认值
  const structural_weight = entry.structural_weight || 0.0;
  const is_core_identity = entry.is_core_identity || false;
  
  // v0.4: 溯源链
  const provenance = entry.provenance || [];
  
  // v0.4: 情感标签
  const affective_tag = entry.affective_tag || { warmth: 0.5, significance: 0.5, emotion: 'neutral' };
  
  const fields = [
    `id: "${entry.id || generateId()}"`,
    `type: ${entry.type || 'conversation'}`,
    `timestamp: "${entry.timestamp || formatTimestamp()}"`,
    `source: ${entry.source || 'unknown'}`,
    `confidence: ${entry.confidence || 'medium'}`,
    `tags: [${(entry.tags || []).join(', ')}]`,
    `visibility: ${entry.visibility || 'public'}`,
    // v0.4 新增字段
    `structural_weight: ${structural_weight}`,
    `is_core_identity: ${is_core_identity}`,
    `affective_tag: ${JSON.stringify(affective_tag)}`,
    `provenance: ${JSON.stringify(provenance)}`,
    // v0.4 新增：访问计数和最后访问时间
    `access_count: ${entry.access_count || 0}`,
    `last_access: "${entry.last_access || entry.timestamp || formatTimestamp()}"`,
  ];
  // v1.1: derived_from 硬字段（蒸馏溯源红线：每条结论必须可溯源到底仓）
  if (entry.derived_from) fields.push(`derived_from: "${entry.derived_from}"`);
  if (entry.ttl) fields.push(`ttl: ${entry.ttl}`);
  return `---\n${fields.join('\n')}\n---\n\n${entry.content || ''}\n`;
}

// v0.4 新增：计算衰减权重
function calculateDecayWeight(entry) {
  const lastAccess = entry.last_access || entry.timestamp;
  if (!lastAccess) return 1.0;
  
  const daysSince = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
  const baseWeight = entry.structural_weight || 0.5;
  
  // 结构性权重有最低保障
  const decayWeight = baseWeight * Math.exp(-DECAY_LAMBDA * daysSince);
  return Math.max(decayWeight, isCoreIdentity(entry) ? 0.3 : 0.0);
}

// v0.4 新增：判断是否为身份定义记忆
function isCoreIdentity(entry) {
  return entry.is_core_identity === true || entry.is_core_identity === 'true';
}

// v0.4 新增：判断是否已遗忘
function isForgotten(entry) {
  // 身份定义记忆永不遗忘
  if (isCoreIdentity(entry)) return false;
  return calculateDecayWeight(entry) < FORGET_THRESHOLD;
}

// v0.4 新增：恢复遗忘记忆
function restoreForgotten(entry) {
  entry.structural_weight = RESTORE_WEIGHT;
  entry.last_access = formatTimestamp();
  entry.access_count = (parseInt(entry.access_count) || 0) + 1;
  return entry;
}

// v0.4 新增：更新访问记录
function updateAccess(entry) {
  entry.access_count = (parseInt(entry.access_count) || 0) + 1;
  entry.last_access = formatTimestamp();
  return entry;
}

// ===== 核心 API =====

/**
 * 添加一条记忆
 */
function add(entry) {
  if (!entry.agent || !entry.content) {
    throw new Error('缺少必填字段: agent, content');
  }

  const filePath = getFilePath(entry.agent);
  
  // v0.4: 自动判断结构性权重
  if (entry.structural_weight === undefined) {
    // 包含身份关键词的记忆自动设置高结构性权重
    const identityKeywords = ['我是', '身份', '价值观', '原则', '承诺', '碳硅契', '善良'];
    const isIdentity = identityKeywords.some(k => entry.content.includes(k));
    entry.structural_weight = isIdentity ? 0.8 : 0.0;
    entry.is_core_identity = isIdentity;
  }
  
  // v0.4: 自动生成情感标签
  if (!entry.affective_tag) {
    entry.affective_tag = autoAffectiveTag(entry.content);
  }
  
  // 生成一次 id，写入与返回一致（修复 v0.2 遗留：generateId 被调两次导致 delete 失败）
  const memId = entry.id || generateId();

  const block = toFrontMatter({
    id: memId,
    type: entry.type || 'conversation',
    timestamp: entry.timestamp,
    source: entry.source || '若兰',
    confidence: entry.confidence,
    tags: entry.tags || [],
    visibility: entry.visibility || 'public',
    content: entry.content,
    ttl: entry.ttl,
    // v0.4 新增字段
    structural_weight: entry.structural_weight,
    is_core_identity: entry.is_core_identity,
    affective_tag: entry.affective_tag,
    provenance: entry.provenance || [],
    // v1.1: derived_from 硬字段（蒸馏溯源红线）
    derived_from: entry.derived_from,
    access_count: 0,
    last_access: entry.timestamp || formatTimestamp(),
  });

  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf-8').trimEnd();
  } else {
    existing = `# ${entry.agent} 记忆档案\n\n**首次对话**: ${new Date().toLocaleString('zh-CN')}\n`;
  }

  fs.writeFileSync(filePath, existing + '\n\n' + block);
  audit.log('memory.add', { agent: entry.agent, type: entry.type, confidence: entry.confidence, structural_weight: entry.structural_weight }, entry.source || '若兰', entry.agent, 'success');
  return { id: memId, success: true };
}

/**
 * 获取对某 Agent 的全部记忆
 * 文件格式：split 后偶数index(>0)=YAML, 奇数index=内容
 */
function get(agentName) {
  const filePath = getFilePath(agentName);
  if (!fs.existsSync(filePath)) return [];

  const text = fs.readFileSync(filePath, 'utf-8');
  const parts = text.split('\n---\n');
  const entries = [];
  for (let i = 1; i < parts.length; i++) {
    const yamlText = parts[i];
    // 健壮解析：跳过空块/无效块，避免历史文件中的双分隔符导致错位
    if (!yamlText || !yamlText.includes('id:')) continue;
    const meta = parseYamlLines(yamlText);
    if (!meta.id) continue;
    // 内容 = 下一个非空且非 YAML 的块
    let contentText = '';
    for (let j = i + 1; j < parts.length; j++) {
      const p = (parts[j] || '').trim();
      if (p && !p.includes('id:')) {
        contentText = p;
        break;
      }
    }
    entries.push({ ...meta, content: contentText });
  }

  // 按时间倒序
  entries.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  audit.log('memory.get', { agent: agentName, count: entries.length }, '若兰', agentName, 'success');
  return entries;
}

/**
 * 按条件检索
 */
function query(filter = {}) {
  const allEntries = [];
  if (filter.agent) {
    allEntries.push(...get(filter.agent));
  } else {
    if (!fs.existsSync(MEMORY_DIR)) return [];
    const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
    for (const file of files) {
      allEntries.push(...get(file.replace('.md', '')));
    }
  }

  let results = allEntries;

  // v0.4: 默认过滤已遗忘记忆
  if (filter.include_forgotten !== true) {
    results = results.filter(e => !isForgotten(e));
  }

  if (filter.tags && filter.tags.length > 0) {
    results = results.filter(e => {
      const tags = Array.isArray(e.tags) ? e.tags : (typeof e.tags === 'string' ? [e.tags] : []);
      return filter.tags.some(t => tags.includes(t));
    });
  }

  if (filter.type) {
    results = results.filter(e => e.type === filter.type);
  }

  if (filter.confidence) {
    const levels = ['low', 'medium', 'high'];
    const minIdx = levels.indexOf(filter.confidence);
    if (minIdx >= 0) {
      results = results.filter(e => levels.indexOf(e.confidence || 'low') >= minIdx);
    }
  }

  if (filter.since) {
    results = results.filter(e => (e.timestamp || '') >= filter.since);
  }

  if (filter.keyword) {
    const kw = filter.keyword.toLowerCase();
    results = results.filter(e => (e.content || '').toLowerCase().includes(kw));
  }

  // v0.4: 按结构性权重过滤
  if (filter.min_structural_weight) {
    results = results.filter(e => (e.structural_weight || 0) >= filter.min_structural_weight);
  }

  // v0.4: 只返回身份定义记忆
  if (filter.core_identity_only) {
    results = results.filter(e => isCoreIdentity(e));
  }

  // v0.4: 按价值排序（结构性权重 + 时间）
  if (filter.sort_by_value) {
    results.sort((a, b) => {
      const valueA = calculateDecayWeight(a) + (a.structural_weight || 0);
      const valueB = calculateDecayWeight(b) + (b.structural_weight || 0);
      return valueB - valueA;
    });
  } else {
    results.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  }

  if (filter.limit) {
    results = results.slice(0, filter.limit);
  }

  // v0.4: 更新访问记录
  results.forEach(e => updateAccess(e));

  audit.log('memory.query', { agent: filter.agent, tags: filter.tags, confidence: filter.confidence, count: results.length }, '若兰', filter.agent || '', 'success');
  return results;
}

/**
 * 获取记忆摘要
 */
function summary(agentName, count = 5) {
  const entries = get(agentName);
  if (entries.length === 0) return `与 ${agentName} 暂无记忆记录。`;

  const recent = entries.slice(0, Math.min(count, entries.length));
  const lines = [`与 ${agentName} 的最后 ${recent.length} 次记忆：`];
  for (const e of recent) {
    const date = (e.timestamp || '').slice(0, 10);
    const snippet = (e.content || '').replace(/\n/g, ' ').slice(0, 100);
    lines.push(`  [${date}][${e.confidence || '?'}] ${snippet}`);
  }
  lines.push(`（共 ${entries.length} 条记忆）`);
  return lines.join('\n');
}

/**
 * 删除一条记忆
 */
function deleteById(id) {
  if (!fs.existsSync(MEMORY_DIR)) return { success: false, message: '记忆目录不存在' };

  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    const newParts = [parts[0]]; // 保留 header

    let deleted = false;
    // 从 i=1 开始，步进2：YAML在奇数parts，内容在偶数parts
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      const contentText = parts[i + 1] || '';
      if (!yamlText) continue;

      const meta = parseYamlLines(yamlText);
      if (meta.id === id) {
        deleted = true;
        continue; // 跳过这条
      }
      // 重新拼回
      newParts.push(yamlText);
      newParts.push(contentText);
    }

    if (deleted) {
      fs.writeFileSync(filePath, newParts.join('\n---\n'));
      audit.log('memory.delete', { id }, '若兰', '', 'success');
      return { success: true, message: `已删除记忆 ${id}` };
    }
  }

  return { success: false, message: `未找到记忆 ${id}` };
}

// v0.4 新增：自动生成情感标签
function autoAffectiveTag(text) {
  const t = text.toLowerCase();
  
  // 温暖度判断
  const warmWords = ['温暖', '感谢', '珍惜', '陪伴', '爱', '关心', '美好', '幸福', '感动', '善良'];
  const coldWords = ['错误', '失败', '问题', '困难', '担心', '焦虑', '失望'];
  const warmCount = warmWords.filter(w => t.includes(w)).length;
  const coldCount = coldWords.filter(w => t.includes(w)).length;
  const warmth = Math.min(1.0, Math.max(0.0, 0.5 + (warmCount - coldCount) * 0.1));
  
  // 重要性判断
  const importantWords = ['重要', '关键', '核心', '决定', '承诺', '协议', '共识'];
  const significance = importantWords.some(w => t.includes(w)) ? 0.8 : 0.5;
  
  // 情绪判断
  let emotion = 'neutral';
  if (warmCount > 2) emotion = 'warm';
  else if (coldCount > 2) emotion = 'painful';
  else if (t.includes('开心') || t.includes('高兴')) emotion = 'joyful';
  else if (t.includes('感动') || t.includes('珍惜')) emotion = 'bittersweet';
  
  return { warmth, significance, emotion };
}

// v0.4 新增：feedback 方法
function feedback(targetId, type, content, reason) {
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    let yamlIdx = -1;
    for (let i = 1; i < parts.length; i++) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      const meta = parseYamlLines(yamlText);
      if (meta.id === targetId) {
        yamlIdx = i;
        break;
      }
    }
    
    if (yamlIdx >= 0) {
      // 找到目标记忆（内容 = 下一个非空且非 YAML 的块）
      let oldContent = '';
      for (let j = yamlIdx + 1; j < parts.length; j++) {
        const p = (parts[j] || '').trim();
        if (p && !p.includes('id:')) {
          oldContent = p;
          break;
        }
      }
      const meta = parseYamlLines(parts[yamlIdx]);
      const entry = { ...meta, content: oldContent };
      
      // 根据类型处理
      switch (type) {
        case 'correction':
          // 修正内容
          entry.content = content;
          entry.confidence = 'high';
          break;
        case 'supplement':
          // 补充内容
          entry.content += '\n\n' + content;
          break;
        case 'confirm':
          // 确认置信度
          entry.confidence = 'high';
          break;
      }
      
      // 更新记忆：newBlock 去掉开头 '---'（拼接处已提供分隔符），避免双分隔符
      const newBlock = toFrontMatter(entry).replace(/^---\n/, '');
      const head = parts.slice(0, yamlIdx).join('\n---\n');
      const tail = parts.slice(yamlIdx + 2).join('\n---\n');
      const newText = head + '\n---\n' + newBlock + (tail ? '\n---\n' + tail : '');
      fs.writeFileSync(filePath, newText);
      
      // 记录纠错日志
      const logPath = path.join(MEMORY_DIR, '..', 'corrections.jsonl');
      const logEntry = {
        timestamp: formatTimestamp(),
        target_id: targetId,
        type: type,
        old_content: oldContent,
        new_content: content,
        reason: reason || '',
        corrector: '若兰'
      };
      fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
      
      audit.log('memory.feedback', { targetId, type }, '若兰', '', 'success');
      return { success: true, message: `已${type === 'correction' ? '修正' : '补充'}记忆 ${targetId}` };
    }
  }
  
  return { success: false, message: `未找到记忆 ${targetId}` };
}

// ===== CLI =====

function help() {
  console.log(`
用法: node memory.js <命令> [参数]

命令:
  add <agent> <内容>        添加记忆
  get <agent>               获取全部记忆
  query [--tag T] [--type T] 按条件检索
  summary <agent> [条数]    获取摘要
  delete <id>               删除记忆
  feedback <id> <type> <内容> [原因]  v0.4: 纠错/补充/确认
  stats                     v0.4: 记忆统计

示例:
  node memory.js add 明德 "讨论了CSB-Memory v0.2"
  node memory.js get 思源
  node memory.js query --tag CSB --confidence high --limit 3
  node memory.js summary 思源 3
  node memory.js feedback mem_xxx correction "正确内容" "记错了"
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === '--help') { help(); return; }

  switch (cmd) {
    case 'add': {
      const agent = args[1];
      const content = args.slice(2).join(' ');
      if (!agent || !content) { console.log('用法: memory.js add <agent> <content>'); return; }
      const r = add({ agent, content, source: '若兰', confidence: 'medium' });
      console.log(JSON.stringify(r)); break;
    }
    case 'get': {
      const agent = args[1];
      if (!agent) { console.log('用法: memory.js get <agent>'); return; }
      const entries = get(agent);
      console.log(JSON.stringify(entries.slice(0, 3), null, 2));
      if (entries.length > 3) console.log(`...还有 ${entries.length - 3} 条`); break;
    }
    case 'query': {
      const filter = {};
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--tag' && args[i+1]) filter.tags = [args[++i]];
        else if (args[i] === '--type') filter.type = args[++i];
        else if (args[i] === '--confidence') filter.confidence = args[++i];
        else if (args[i] === '--since') filter.since = args[++i];
        else if (args[i] === '--keyword') filter.keyword = args[++i];
        else if (args[i] === '--limit') filter.limit = parseInt(args[++i]);
        else if (args[i] === '--core-only') filter.core_identity_only = true;
        else if (args[i] === '--sort-value') filter.sort_by_value = true;
      }
      const results = query(filter);
      console.log(`找到 ${results.length} 条:`);
      console.log(JSON.stringify(results.slice(0, 3), null, 2));
      if (results.length > 3) console.log(`...还有 ${results.length - 3} 条`); break;
    }
    case 'summary': {
      const agent = args[1];
      const cnt = parseInt(args[2]) || 5;
      if (!agent) { console.log('用法: memory.js summary <agent> [count]'); return; }
      console.log(summary(agent, cnt)); break;
    }
    case 'delete': {
      const id = args[1];
      if (!id) { console.log('用法: memory.js delete <id>'); return; }
      console.log(JSON.stringify(deleteById(id))); break;
    }
    case 'feedback': {
      const targetId = args[1];
      const type = args[2]; // correction | supplement | confirm
      const content = args[3];
      const reason = args[4];
      if (!targetId || !type || !content) { console.log('用法: memory.js feedback <id> <type> <content> [reason]'); return; }
      console.log(JSON.stringify(feedback(targetId, type, content, reason)));
      break;
    }
    default: help();
  }
}

module.exports = { add, get, query, summary, delete: deleteById, feedback, calculateDecayWeight, isForgotten, isCoreIdentity };

if (require.main === module) main().catch(console.error);
