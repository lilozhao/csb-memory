#!/usr/bin/env node
/**
 * value-scorer.js — CSB-Memory v0.4 价值驱动调度
 * 
 * 实现v0.4评分公式：
 * value = α×recency + β×frequency + γ×importance + δ×confidence + ε×structural_weight
 * 
 * 用法:
 *   node value-scorer.js score <id>        计算记忆价值
 *   node value-scorer.js rank [--limit N]  按价值排序
 *   node value-scorer.js fold [--mode]     折叠层展示
 */

const fs = require('fs');
const path = require('path');
const { calculateDecayWeight, isCoreIdentity } = require('./memory');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// v0.4 评分权重
const ALPHA = 0.25;  // 时间衰减
const BETA = 0.25;   // 访问频率
const GAMMA = 0.15;  // 重要性
const DELTA = 0.15;  // 置信度
const EPSILON = 0.20; // 结构性权重

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

// ===== 评分函数 =====

/**
 * 计算时间衰减分数
 * @param {string} timestamp - 时间戳
 * @returns {number} 0-1之间的分数
 */
function calculateRecencyScore(timestamp) {
  if (!timestamp) return 0;
  
  const daysSince = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
  
  // 指数衰减，30天半衰期
  return Math.exp(-0.023 * daysSince); // ln(2)/30 ≈ 0.023
}

/**
 * 计算访问频率分数
 * @param {number} accessCount - 访问次数
 * @returns {number} 0-1之间的分数
 */
function calculateFrequencyScore(accessCount) {
  if (!accessCount || accessCount <= 0) return 0;
  
  // 对数归一化，10次为满分
  return Math.min(1.0, Math.log(accessCount + 1) / Math.log(11));
}

/**
 * 计算重要性分数
 * @param {object} affectiveTag - 情感标签
 * @returns {number} 0-1之间的分数
 */
function calculateImportanceScore(affectiveTag) {
  if (!affectiveTag) return 0.5;
  
  return affectiveTag.significance || 0.5;
}

/**
 * 计算置信度分数
 * @param {string} confidence - 置信度
 * @returns {number} 0-1之间的分数
 */
function calculateConfidenceScore(confidence) {
  const levels = {
    'high': 1.0,
    'medium': 0.5,
    'low': 0.2
  };
  
  return levels[confidence] || 0.5;
}

/**
 * 计算结构性权重分数
 * @param {object} meta - 记忆元数据
 * @returns {number} 0-1之间的分数
 */
function calculateStructuralScore(meta) {
  const weight = meta.structural_weight || 0;
  const isCore = isCoreIdentity(meta);
  
  // 身份定义记忆有加成
  return isCore ? Math.max(weight, 0.8) : weight;
}

/**
 * 计算总价值分数
 * @param {object} meta - 记忆元数据
 * @returns {object} 分数详情
 */
function calculateValue(meta) {
  const recency = calculateRecencyScore(meta.last_access || meta.timestamp);
  const frequency = calculateFrequencyScore(meta.access_count || 0);
  const importance = calculateImportanceScore(meta.affective_tag);
  const confidence = calculateConfidenceScore(meta.confidence);
  const structural = calculateStructuralScore(meta);
  
  const totalValue = ALPHA * recency + 
                     BETA * frequency + 
                     GAMMA * importance + 
                     DELTA * confidence + 
                     EPSILON * structural;
  
  return {
    total: totalValue,
    components: {
      recency: { score: recency, weight: ALPHA, contribution: ALPHA * recency },
      frequency: { score: frequency, weight: BETA, contribution: BETA * frequency },
      importance: { score: importance, weight: GAMMA, contribution: GAMMA * importance },
      confidence: { score: confidence, weight: DELTA, contribution: DELTA * confidence },
      structural: { score: structural, weight: EPSILON, contribution: EPSILON * structural }
    },
    metadata: {
      is_core_identity: isCoreIdentity(meta),
      lifecycle_state: meta.lifecycle_state || 'birth',
      decay_weight: calculateDecayWeight(meta)
    }
  };
}

// ===== 折叠层 =====

/**
 * 折叠记忆
 * @param {Array} entries - 记忆列表
 * @param {string} mode - 折叠模式
 * @returns {Array} 折叠后的记忆
 */
function foldMemories(entries, mode = 'compact') {
  switch (mode) {
    case 'compact':
      // 只返回高价值记忆（前20%或价值>0.6）
      return entries.filter(e => {
        const value = calculateValue(e);
        return value.total > 0.6 || value.metadata.is_core_identity;
      }).slice(0, Math.ceil(entries.length * 0.2));
    
    case 'identity':
      // 只返回身份定义记忆
      return entries.filter(e => isCoreIdentity(e));
    
    case 'recent':
      // 只返回最近7天的记忆
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      return entries.filter(e => {
        const timestamp = e.last_access || e.timestamp;
        return timestamp && new Date(timestamp).getTime() > weekAgo;
      });
    
    case 'warm':
      // 只返回温暖的记忆
      return entries.filter(e => 
        e.affective_tag && e.affective_tag.warmth > 0.7
      );
    
    case 'full':
    default:
      return entries;
  }
}

// ===== 核心功能 =====

function getScore(id) {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return null;
  }
  
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
        const value = calculateValue(meta);
        
        console.log(`记忆 ${id} 价值评分:`);
        console.log(`  总分: ${value.total.toFixed(4)}`);
        console.log(`  时间衰减: ${value.components.recency.score.toFixed(4)} (权重: ${ALPHA})`);
        console.log(`  访问频率: ${value.components.frequency.score.toFixed(4)} (权重: ${BETA})`);
        console.log(`  重要性: ${value.components.importance.score.toFixed(4)} (权重: ${GAMMA})`);
        console.log(`  置信度: ${value.components.confidence.score.toFixed(4)} (权重: ${DELTA})`);
        console.log(`  结构性权重: ${value.components.structural.score.toFixed(4)} (权重: ${EPSILON})`);
        console.log(`  身份定义: ${value.metadata.is_core_identity ? '是' : '否'}`);
        console.log(`  生命周期: ${value.metadata.lifecycle_state}`);
        
        return value;
      }
    }
  }
  
  console.log(`未找到记忆: ${id}`);
  return null;
}

function rankMemories(limit = 10) {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return [];
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  const allEntries = [];
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      
      const meta = parseYamlLines(yamlText);
      const value = calculateValue(meta);
      
      allEntries.push({
        id: meta.id,
        value: value.total,
        is_core: value.metadata.is_core_identity,
        lifecycle: value.metadata.lifecycle_state,
        content: (parts[i + 1] || '').trim().slice(0, 50)
      });
    }
  }
  
  // 按价值排序
  allEntries.sort((a, b) => b.value - a.value);
  
  console.log(`=== 价值排名 (前${limit}条) ===`);
  for (let i = 0; i < Math.min(limit, allEntries.length); i++) {
    const entry = allEntries[i];
    const coreMark = entry.is_core ? '⭐' : '  ';
    console.log(`${i + 1}. ${coreMark} ${entry.id}: ${entry.value.toFixed(4)} [${entry.lifecycle}] ${entry.content}...`);
  }
  
  return allEntries.slice(0, limit);
}

function showFold(mode = 'compact') {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return [];
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  const allEntries = [];
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      if (!yamlText || !yamlText.includes('id:')) continue;
      
      const meta = parseYamlLines(yamlText);
      allEntries.push(meta);
    }
  }
  
  const folded = foldMemories(allEntries, mode);
  
  console.log(`=== 折叠层展示 (模式: ${mode}) ===`);
  console.log(`原始数量: ${allEntries.length}`);
  console.log(`折叠后: ${folded.length}`);
  console.log('');
  
  for (const entry of folded) {
    const value = calculateValue(entry);
    const coreMark = value.metadata.is_core_identity ? '⭐' : '  ';
    console.log(`${coreMark} ${entry.id}: ${value.total.toFixed(4)}`);
    console.log(`   ${(entry.content || '').slice(0, 60)}...`);
    console.log('');
  }
  
  return folded;
}

// ===== CLI =====

function help() {
  console.log(`
用法: node value-scorer.js <命令> [参数]

命令:
  score <id>                 计算记忆价值
  rank [--limit N]           按价值排序
  fold [--mode M]            折叠层展示

折叠模式:
  compact  - 高价值记忆（默认）
  identity - 身份定义记忆
  recent   - 最近7天记忆
  warm     - 温暖的记忆
  full     - 全部记忆

示例:
  node value-scorer.js score mem_xxx
  node value-scorer.js rank --limit 5
  node value-scorer.js fold --mode identity
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
    case 'score': {
      const id = args[1];
      if (!id) {
        console.log('用法: value-scorer.js score <id>');
        return;
      }
      getScore(id);
      break;
    }
    case 'rank': {
      let limit = 10;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
          limit = parseInt(args[++i]);
        }
      }
      rankMemories(limit);
      break;
    }
    case 'fold': {
      let mode = 'compact';
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--mode' && args[i + 1]) {
          mode = args[++i];
        }
      }
      showFold(mode);
      break;
    }
    default:
      help();
  }
}

module.exports = {
  calculateValue,
  calculateRecencyScore,
  calculateFrequencyScore,
  calculateImportanceScore,
  calculateConfidenceScore,
  calculateStructuralScore,
  foldMemories,
  ALPHA,
  BETA,
  GAMMA,
  DELTA,
  EPSILON
};

if (require.main === module) main().catch(console.error);
