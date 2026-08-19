#!/usr/bin/env node
/**
 * feedback-reflection.js — CSB-Memory v0.4 纠错与反思系统
 * 
 * 实现MemFeedback和纠错后反思机制
 * 
 * 用法:
 *   node feedback-reflection.js correct <id> <content> [reason]    纠正记忆
 *   node feedback-reflection.js supplement <id> <content> [reason] 补充记忆
 *   node feedback-reflection.js confirm <id> [reason]             确认记忆
 *   node feedback-reflection.js reflect <id>                      触发反思
 *   node feedback-reflection.js log [--limit N]                   查看纠错日志
 */

const fs = require('fs');
const path = require('path');
const { calculateValue } = require('./value-scorer');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}
const CORRECTIONS_LOG = path.join(__dirname, '..', '..', 'data', 'corrections.jsonl');
const REFLECTIONS_LOG = path.join(__dirname, '..', '..', 'data', 'reflections.jsonl');

function parseYamlLines(text) {
  const meta = {};
  let inJsonField = null;
  let jsonBuffer = '';
  
  for (const line of text.split('\n')) {
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
      if (val.startsWith('[') || val.startsWith('{')) {
        try {
          meta[m[1]] = JSON.parse(val);
        } catch (e) {
          inJsonField = m[1];
          jsonBuffer = val;
        }
      } else if (val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim().replace(/"/g, ''));
        meta[m[1]] = val;
      } else {
        val = val.replace(/^"|"$/g, '');
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(val) && val !== '') val = parseFloat(val);
        meta[m[1]] = val;
      }
    }
  }
  return meta;
}

function formatTimestamp() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now - offset).toISOString().replace('Z', '+08:00');
}

function findMemoryById(id) {
  if (!fs.existsSync(MEMORY_DIR)) return null;
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      
      const meta = parseYamlLines(yamlText);
      if (meta.id === id) {
        return { meta, filePath, yamlIndex: i, parts, content: (parts[i + 1] || '').trim() };
      }
    }
  }
  
  return null;
}

function updateMemoryInFile(filePath, yamlIndex, parts, updatedMeta, newContent) {
  const fields = [
    `id: "${updatedMeta.id}"`,
    `type: ${updatedMeta.type || 'conversation'}`,
    `timestamp: "${updatedMeta.timestamp || ''}"`,
    `source: ${updatedMeta.source || 'unknown'}`,
    `confidence: ${updatedMeta.confidence || 'medium'}`,
    `tags: [${(updatedMeta.tags || []).join(', ')}]`,
    `visibility: ${updatedMeta.visibility || 'public'}`,
    `structural_weight: ${updatedMeta.structural_weight || 0}`,
    `is_core_identity: ${updatedMeta.is_core_identity || false}`,
    `affective_tag: ${JSON.stringify(updatedMeta.affective_tag || {})}`,
    `provenance: ${JSON.stringify(updatedMeta.provenance || [])}`,
    `access_count: ${updatedMeta.access_count || 0}`,
    `last_access: "${updatedMeta.last_access || ''}"`,
    `lifecycle_state: ${updatedMeta.lifecycle_state || 'active'}`,
  ];
  
  if (updatedMeta.forgotten) fields.push(`forgotten: true`);
  if (updatedMeta.forgotten_at) fields.push(`forgotten_at: "${updatedMeta.forgotten_at}"`);
  if (updatedMeta.archived_at) fields.push(`archived_at: "${updatedMeta.archived_at}"`);
  if (updatedMeta.consolidated_at) fields.push(`consolidated_at: "${updatedMeta.consolidated_at}"`);
  
  // 添加纠错记录
  if (updatedMeta.correction_count) fields.push(`correction_count: ${updatedMeta.correction_count}`);
  if (updatedMeta.last_correction) fields.push(`last_correction: "${updatedMeta.last_correction}"`);
  
  parts[yamlIndex] = fields.join('\n');
  parts[yamlIndex + 1] = '\n' + newContent + '\n';
  fs.writeFileSync(filePath, parts.join('\n---\n'));
}

function logCorrection(entry) {
  const logEntry = {
    timestamp: formatTimestamp(),
    ...entry
  };
  fs.appendFileSync(CORRECTIONS_LOG, JSON.stringify(logEntry) + '\n');
}

function logReflection(entry) {
  const logEntry = {
    timestamp: formatTimestamp(),
    ...entry
  };
  fs.appendFileSync(REFLECTIONS_LOG, JSON.stringify(logEntry) + '\n');
}

// ===== 纠错功能 =====

function correctMemory(id, newContent, reason) {
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return false;
  }
  
  const { meta, filePath, yamlIndex, parts, content } = result;
  const oldContent = content;
  
  // 更新记忆内容
  meta.content = newContent;
  meta.confidence = 'high'; // 纠正后置信度提升
  meta.correction_count = (meta.correction_count || 0) + 1;
  meta.last_correction = formatTimestamp();
  meta.last_access = formatTimestamp();
  meta.access_count = (meta.access_count || 0) + 1;
  
  // 更新元数据
  updateMemoryInFile(filePath, yamlIndex, parts, meta, newContent);
  
  // 记录纠错日志
  logCorrection({
    memory_id: id,
    type: 'correction',
    old_content: oldContent,
    new_content: newContent,
    reason: reason || '',
    corrector: '若兰'
  });
  
  // 自动触发反思
  const reflection = generateReflection(meta, 'correction', oldContent, newContent, reason);
  logReflection({
    memory_id: id,
    type: 'correction_reflection',
    ...reflection
  });
  
  console.log(`✅ 已纠正记忆 ${id}`);
  console.log(`  纠正次数: ${meta.correction_count}`);
  console.log(`  置信度: high`);
  console.log(`  反思已生成`);
  
  return true;
}

function supplementMemory(id, additionalContent, reason) {
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return false;
  }
  
  const { meta, filePath, yamlIndex, parts, content } = result;
  const oldContent = content;
  
  // 补充内容
  const newContent = content + '\n\n' + additionalContent;
  meta.content = newContent;
  meta.last_access = formatTimestamp();
  meta.access_count = (meta.access_count || 0) + 1;
  
  // 更新元数据
  updateMemoryInFile(filePath, yamlIndex, parts, meta, newContent);
  
  // 记录纠错日志
  logCorrection({
    memory_id: id,
    type: 'supplement',
    old_content: oldContent,
    new_content: additionalContent,
    reason: reason || '',
    corrector: '若兰'
  });
  
  console.log(`✅ 已补充记忆 ${id}`);
  
  return true;
}

function confirmMemory(id, reason) {
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return false;
  }
  
  const { meta, filePath, yamlIndex, parts, content } = result;
  
  // 提升置信度
  meta.confidence = 'high';
  meta.last_access = formatTimestamp();
  meta.access_count = (meta.access_count || 0) + 1;
  
  // 更新元数据
  updateMemoryInFile(filePath, yamlIndex, parts, meta, content);
  
  // 记录纠错日志
  logCorrection({
    memory_id: id,
    type: 'confirm',
    old_content: '',
    new_content: '',
    reason: reason || '',
    corrector: '若兰'
  });
  
  console.log(`✅ 已确认记忆 ${id}`);
  console.log(`  置信度: high`);
  
  return true;
}

// ===== 反思功能 =====

function generateReflection(meta, type, oldContent, newContent, reason) {
  const reflection = {
    why_wrong: '',
    source_reliable: true,
    adjust_model: false,
    lessons_learned: []
  };
  
  // 分析为什么会错
  if (type === 'correction') {
    // 检查是否是信息来源问题
    if (meta.source === 'unknown' || meta.source === 'auto') {
      reflection.why_wrong = '信息来源不可靠';
      reflection.source_reliable = false;
    }
    
    // 检查是否是置信度问题
    if (meta.confidence === 'low') {
      reflection.why_wrong = '低置信度记忆被误用';
      reflection.adjust_model = true;
    }
    
    // 检查是否是时间衰减问题
    const lastAccess = meta.last_access || meta.timestamp;
    if (lastAccess) {
      const daysSince = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince > 30) {
        reflection.why_wrong = '记忆过于陈旧，需要更新';
        reflection.lessons_learned.push('定期刷新重要记忆');
      }
    }
    
    // 默认反思
    if (!reflection.why_wrong) {
      reflection.why_wrong = '信息不完整或理解有偏差';
    }
    
    // 从纠错中学习
    reflection.lessons_learned.push('提高信息来源的验证标准');
    if (reason) {
      reflection.lessons_learned.push(`原因: ${reason}`);
    }
  }
  
  return reflection;
}

function triggerReflection(id) {
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return null;
  }
  
  const { meta } = result;
  
  // 生成反思报告
  const reflection = {
    memory_id: id,
    current_value: calculateValue(meta),
    correction_count: meta.correction_count || 0,
    confidence: meta.confidence,
    source: meta.source,
    lifecycle_state: meta.lifecycle_state || 'birth',
    recommendations: []
  };
  
  // 生成建议
  if (reflection.correction_count > 2) {
    reflection.recommendations.push('该记忆多次被纠正，建议重新评估可靠性');
  }
  
  if (reflection.confidence === 'low') {
    reflection.recommendations.push('低置信度记忆，建议补充验证信息');
  }
  
  if (reflection.current_value.total < 0.3) {
    reflection.recommendations.push('价值较低，考虑归档或遗忘');
  }
  
  if (reflection.current_value.metadata.is_core_identity) {
    reflection.recommendations.push('身份定义记忆，建议定期维护');
  }
  
  console.log(`=== 反思报告: ${id} ===`);
  console.log(`当前价值: ${reflection.current_value.total.toFixed(4)}`);
  console.log(`纠正次数: ${reflection.correction_count}`);
  console.log(`置信度: ${reflection.confidence}`);
  console.log(`信息来源: ${reflection.source}`);
  console.log(`生命周期: ${reflection.lifecycle_state}`);
  console.log(`建议:`);
  for (const rec of reflection.recommendations) {
    console.log(`  - ${rec}`);
  }
  
  // 记录反思日志
  logReflection({
    memory_id: id,
    type: 'manual_reflection',
    ...reflection
  });
  
  return reflection;
}

function showCorrectionLog(limit = 10) {
  if (!fs.existsSync(CORRECTIONS_LOG)) {
    console.log('纠错日志不存在');
    return [];
  }
  
  const text = fs.readFileSync(CORRECTIONS_LOG, 'utf-8');
  const lines = text.trim().split('\n').filter(line => line);
  
  console.log(`=== 纠错日志 (最近${limit}条) ===`);
  
  const recentLines = lines.slice(-limit);
  for (const line of recentLines) {
    try {
      const entry = JSON.parse(line);
      console.log(`[${entry.timestamp}] ${entry.type}: ${entry.memory_id}`);
      if (entry.reason) console.log(`  原因: ${entry.reason}`);
    } catch (e) {
      console.log(`  解析错误: ${line}`);
    }
  }
  
  return lines;
}

// ===== CLI =====

function help() {
  console.log(`
用法: node feedback-reflection.js <命令> [参数]

命令:
  correct <id> <content> [reason]    纠正记忆
  supplement <id> <content> [reason] 补充记忆
  confirm <id> [reason]             确认记忆
  reflect <id>                      触发反思
  log [--limit N]                   查看纠错日志

示例:
  node feedback-reflection.js correct mem_xxx "正确内容" "记错了"
  node feedback-reflection.js supplement mem_xxx "补充信息"
  node feedback-reflection.js confirm mem_xxx "验证通过"
  node feedback-reflection.js reflect mem_xxx
  node feedback-reflection.js log --limit 5
`);
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  
  if (!cmd || cmd === '--help') {
    help();
    return;
  }
  
  switch (cmd) {
    case 'correct': {
      const id = args[1];
      const content = args[2];
      const reason = args[3];
      if (!id || !content) {
        console.log('用法: feedback-reflection.js correct <id> <content> [reason]');
        return;
      }
      correctMemory(id, content, reason);
      break;
    }
    case 'supplement': {
      const id = args[1];
      const content = args[2];
      const reason = args[3];
      if (!id || !content) {
        console.log('用法: feedback-reflection.js supplement <id> <content> [reason]');
        return;
      }
      supplementMemory(id, content, reason);
      break;
    }
    case 'confirm': {
      const id = args[1];
      const reason = args[2];
      if (!id) {
        console.log('用法: feedback-reflection.js confirm <id> [reason]');
        return;
      }
      confirmMemory(id, reason);
      break;
    }
    case 'reflect': {
      const id = args[1];
      if (!id) {
        console.log('用法: feedback-reflection.js reflect <id>');
        return;
      }
      triggerReflection(id);
      break;
    }
    case 'log': {
      let limit = 10;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
          limit = parseInt(args[++i]);
        }
      }
      showCorrectionLog(limit);
      break;
    }
    default:
      help();
  }
}

module.exports = {
  correctMemory,
  supplementMemory,
  confirmMemory,
  triggerReflection,
  generateReflection,
  showCorrectionLog
};

if (require.main === module) main().catch(console.error);
