#!/usr/bin/env node
/**
 * lifecycle.js — CSB-Memory v0.4 生命周期状态机
 * 
 * 状态流转：birth → active → consolidated → archived → forgotten
 * 
 * 用法:
 *   node lifecycle.js status <id>          查看记忆状态
 *   node lifecycle.js transition <id> <state> 状态流转
 *   node lifecycle.js stats               统计各状态数量
 *   node lifecycle.js check-forgotten     检查可遗忘记忆
 *   node lifecycle.js restore <id>        恢复遗忘记忆
 */

const fs = require('fs');
const path = require('path');
const { calculateDecayWeight, isForgotten, isCoreIdentity } = require('./memory');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}
const LIFECYCLE_LOG = path.join(__dirname, '..', '..', 'data', 'lifecycle.jsonl');

// 生命周期状态定义
const LIFECYCLE_STATES = {
  birth: { next: 'active', description: '新生' },
  active: { next: 'consolidated', description: '活跃' },
  consolidated: { next: 'archived', description: '巩固' },
  archived: { next: 'forgotten', description: '归档' },
  forgotten: { next: null, description: '遗忘' }
};

// 状态转换条件
const TRANSITION_CONDITIONS = {
  birth_to_active: (meta) => {
    // 新生 → 活跃：首次被访问
    return meta.access_count > 0;
  },
  active_to_consolidated: (meta) => {
    // 活跃 → 巩固：访问次数 ≥ 3 且置信度 ≥ medium
    return meta.access_count >= 3 && meta.confidence !== 'low';
  },
  consolidated_to_archived: (meta) => {
    // 巩固 → 归档：30天未访问
    const lastAccess = meta.last_access || meta.timestamp;
    if (!lastAccess) return false;
    const daysSince = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince > 30;
  },
  archived_to_forgotten: (meta) => {
    // 归档 → 遗忘：权重衰减至阈值以下
    return isForgotten(meta);
  }
};

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

function logLifecycleEvent(event) {
  const logEntry = {
    timestamp: formatTimestamp(),
    ...event
  };
  fs.appendFileSync(LIFECYCLE_LOG, JSON.stringify(logEntry) + '\n');
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
        return { meta, filePath, yamlIndex: i, parts };
      }
    }
  }
  
  return null;
}

function updateMemoryInFile(filePath, yamlIndex, parts, updatedMeta) {
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
  
  parts[yamlIndex] = fields.join('\n');
  fs.writeFileSync(filePath, parts.join('\n---\n'));
}

function getLifecycleState(meta) {
  // 如果已有明确状态，直接返回
  if (meta.lifecycle_state && LIFECYCLE_STATES[meta.lifecycle_state]) {
    return meta.lifecycle_state;
  }
  
  // 自动推断状态
  if (meta.forgotten) return 'forgotten';
  if (meta.archived_at) return 'archived';
  if (meta.consolidated_at) return 'consolidated';
  if (meta.access_count > 0) return 'active';
  return 'birth';
}

function checkTransition(meta) {
  const currentState = getLifecycleState(meta);
  const stateDef = LIFECYCLE_STATES[currentState];
  
  if (!stateDef.next) return null; // 已是最终状态
  
  const transitionKey = `${currentState}_to_${stateDef.next}`;
  const condition = TRANSITION_CONDITIONS[transitionKey];
  
  if (condition && condition(meta)) {
    return {
      from: currentState,
      to: stateDef.next,
      reason: transitionKey
    };
  }
  
  return null;
}

// ===== 核心功能 =====

function getStatus(id) {
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return null;
  }
  
  const { meta } = result;
  const state = getLifecycleState(meta);
  const weight = calculateDecayWeight(meta);
  const transition = checkTransition(meta);
  
  console.log(`记忆 ${id} 状态:`);
  console.log(`  生命周期: ${state} (${LIFECYCLE_STATES[state].description})`);
  console.log(`  衰减权重: ${weight.toFixed(4)}`);
  console.log(`  结构性权重: ${meta.structural_weight || 0}`);
  console.log(`  访问次数: ${meta.access_count || 0}`);
  console.log(`  最后访问: ${meta.last_access || '无'}`);
  console.log(`  身份定义: ${isCoreIdentity(meta) ? '是' : '否'}`);
  
  if (transition) {
    console.log(`  可转换: ${transition.from} → ${transition.to}`);
  }
  
  return { state, weight, transition };
}

function transitionState(id, targetState) {
  if (!LIFECYCLE_STATES[targetState]) {
    console.log(`无效状态: ${targetState}`);
    return false;
  }
  
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return false;
  }
  
  const { meta, filePath, yamlIndex, parts } = result;
  const currentState = getLifecycleState(meta);
  
  // 验证转换合法性
  const stateDef = LIFECYCLE_STATES[currentState];
  if (stateDef.next !== targetState) {
    console.log(`非法转换: ${currentState} → ${targetState}`);
    console.log(`合法转换: ${currentState} → ${stateDef.next}`);
    return false;
  }
  
  // 执行转换
  meta.lifecycle_state = targetState;
  
  // 设置时间戳
  if (targetState === 'consolidated') {
    meta.consolidated_at = formatTimestamp();
  } else if (targetState === 'archived') {
    meta.archived_at = formatTimestamp();
  } else if (targetState === 'forgotten') {
    meta.forgotten = true;
    meta.forgotten_at = formatTimestamp();
  }
  
  // 如果是恢复操作，清除遗忘标记
  if (targetState !== 'forgotten') {
    meta.forgotten = false;
    meta.forgotten_at = null;
  }
  
  updateMemoryInFile(filePath, yamlIndex, parts, meta);
  
  // 记录日志
  logLifecycleEvent({
    memory_id: id,
    from_state: currentState,
    to_state: targetState,
    action: 'manual_transition'
  });
  
  console.log(`状态转换: ${currentState} → ${targetState}`);
  return true;
}

function getStats() {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return;
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  const stats = { birth: 0, active: 0, consolidated: 0, archived: 0, forgotten: 0 };
  let total = 0;
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      
      const meta = parseYamlLines(yamlText);
      const state = getLifecycleState(meta);
      stats[state]++;
      total++;
    }
  }
  
  console.log('=== 生命周期统计 ===');
  console.log(`总数: ${total}`);
  for (const [state, count] of Object.entries(stats)) {
    const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;
    console.log(`  ${state}: ${count} (${percentage}%)`);
  }
}

function checkForgotten() {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return;
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  let canForget = 0;
  let total = 0;
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      
      const meta = parseYamlLines(yamlText);
      total++;
      
      const currentState = getLifecycleState(meta);
      const transition = checkTransition(meta);
      
      if (transition && transition.to === 'forgotten') {
        console.log(`可遗忘: ${meta.id} (当前: ${currentState}, 权重: ${calculateDecayWeight(meta).toFixed(4)})`);
        canForget++;
      }
    }
  }
  
  console.log(`\n=== 遗忘检查 ===`);
  console.log(`总数: ${total}`);
  console.log(`可遗忘: ${canForget}`);
}

function restoreMemory(id) {
  const result = findMemoryById(id);
  if (!result) {
    console.log(`未找到记忆: ${id}`);
    return false;
  }
  
  const { meta, filePath, yamlIndex, parts } = result;
  const currentState = getLifecycleState(meta);
  
  if (currentState !== 'forgotten') {
    console.log(`记忆 ${id} 不是遗忘状态，无需恢复`);
    return false;
  }
  
  // 恢复到活跃状态
  meta.lifecycle_state = 'active';
  meta.forgotten = false;
  meta.forgotten_at = null;
  meta.structural_weight = 0.1; // 恢复权重
  meta.last_access = formatTimestamp();
  meta.access_count = (meta.access_count || 0) + 1;
  
  updateMemoryInFile(filePath, yamlIndex, parts, meta);
  
  // 记录日志
  logLifecycleEvent({
    memory_id: id,
    from_state: 'forgotten',
    to_state: 'active',
    action: 'restore'
  });
  
  console.log(`恢复记忆: ${id} (forgotten → active)`);
  return true;
}

// ===== CLI =====

function help() {
  console.log(`
用法: node lifecycle.js <命令> [参数]

命令:
  status <id>                查看记忆状态
  transition <id> <state>    状态流转
  stats                      统计各状态数量
  check-forgotten            检查可遗忘记忆
  restore <id>               恢复遗忘记忆

状态流转: birth → active → consolidated → archived → forgotten

示例:
  node lifecycle.js status mem_xxx
  node lifecycle.js transition mem_xxx active
  node lifecycle.js stats
  node lifecycle.js check-forgotten
  node lifecycle.js restore mem_xxx
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
    case 'status': {
      const id = args[1];
      if (!id) {
        console.log('用法: lifecycle.js status <id>');
        return;
      }
      getStatus(id);
      break;
    }
    case 'transition': {
      const id = args[1];
      const state = args[2];
      if (!id || !state) {
        console.log('用法: lifecycle.js transition <id> <state>');
        return;
      }
      transitionState(id, state);
      break;
    }
    case 'stats': {
      getStats();
      break;
    }
    case 'check-forgotten': {
      checkForgotten();
      break;
    }
    case 'restore': {
      const id = args[1];
      if (!id) {
        console.log('用法: lifecycle.js restore <id>');
        return;
      }
      restoreMemory(id);
      break;
    }
    default:
      help();
  }
}

module.exports = {
  getStatus,
  transitionState,
  getStats,
  checkForgotten,
  restoreMemory,
  getLifecycleState,
  checkTransition,
  LIFECYCLE_STATES
};

if (require.main === module) main().catch(console.error);
