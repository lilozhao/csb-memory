#!/usr/bin/env node
/**
 * activation-manager.js — CSB-Memory v0.4 激活记忆管理
 * 
 * 实现Token预算和注入调度
 * 
 * 用法:
 *   node activation-manager.js inject <query> [--budget N]    注入记忆
 *   node activation-manager.js budget [--token N]            查看预算
 *   node activation-manager.js schedule <query> [--mode M]   调度策略
 */

const fs = require('fs');
const path = require('path');
const { calculateValue } = require('./value-scorer');
const { searchVectors } = require('./vector-store');
const { calculateDecayWeight, isCoreIdentity } = require('./memory');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}

// Token预算配置
const DEFAULT_TOKEN_BUDGET = 4000;
const L0_RATIO = 0.1;  // 核心记忆占比
const L1_RATIO = 0.3;  // 重要记忆占比
const L2_RATIO = 0.6;  // 一般记忆占比

// 估算Token数量（简化版）
function estimateTokens(text) {
  if (!text) return 0;
  
  // 中文约1.5字/token，英文约4字符/token
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const otherChars = text.length - chineseChars;
  
  return Math.ceil(chineseChars / 1.5 + otherChars / 4);
}

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

// ===== 记忆分层 =====

function classifyMemory(meta) {
  const value = calculateValue(meta);
  const isCore = isCoreIdentity(meta);
  const decayWeight = calculateDecayWeight(meta);
  
  // L0: 核心身份记忆（必须注入）
  if (isCore || meta.structural_weight >= 0.8) {
    return { level: 'L0', priority: 'critical' };
  }
  
  // L1: 高价值记忆（优先注入）
  if (value.total > 0.6 || meta.confidence === 'high') {
    return { level: 'L1', priority: 'high' };
  }
  
  // L2: 一般记忆（按需注入）
  if (value.total > 0.3 || decayWeight > 0.5) {
    return { level: 'L2', priority: 'normal' };
  }
  
  // L3: 低价值记忆（可忽略）
  return { level: 'L3', priority: 'low' };
}

// ===== 注入调度 =====

function injectMemories(query, tokenBudget = DEFAULT_TOKEN_BUDGET) {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return [];
  }
  
  // 获取所有记忆
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  const allMemories = [];
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      const contentText = (parts[i + 1] || '').trim();
      
      if (!yamlText || !yamlText.includes('id:') || !contentText) continue;
      
      const meta = parseYamlLines(yamlText);
      const value = calculateValue(meta);
      const classification = classifyMemory(meta);
      
      allMemories.push({
        ...meta,
        content: contentText,
        value: value,
        classification: classification,
        tokens: estimateTokens(contentText)
      });
    }
  }
  
  // 按价值排序
  allMemories.sort((a, b) => b.value.total - a.value.total);
  
  // 按层级注入
  const injected = [];
  let tokensUsed = 0;
  
  // L0: 核心记忆（必须注入）
  const l0Memories = allMemories.filter(m => m.classification.level === 'L0');
  for (const memory of l0Memories) {
    if (tokensUsed + memory.tokens <= tokenBudget * L0_RATIO) {
      injected.push({ ...memory, inject_level: 'L0' });
      tokensUsed += memory.tokens;
    }
  }
  
  // L1: 高价值记忆
  const l1Memories = allMemories.filter(m => m.classification.level === 'L1');
  for (const memory of l1Memories) {
    if (tokensUsed + memory.tokens <= tokenBudget * (L0_RATIO + L1_RATIO)) {
      injected.push({ ...memory, inject_level: 'L1' });
      tokensUsed += memory.tokens;
    }
  }
  
  // L2: 一般记忆
  const l2Memories = allMemories.filter(m => m.classification.level === 'L2');
  for (const memory of l2Memories) {
    if (tokensUsed + memory.tokens <= tokenBudget) {
      injected.push({ ...memory, inject_level: 'L2' });
      tokensUsed += memory.tokens;
    }
  }
  
  // 语义搜索补充（如果有查询）
  if (query) {
    const searchResults = searchVectors(query, 5);
    const searchIds = searchResults.map(r => r.id);
    
    for (const id of searchIds) {
      // 检查是否已注入
      if (injected.some(m => m.id === id)) continue;
      
      // 查找记忆
      const memory = allMemories.find(m => m.id === id);
      if (!memory) continue;
      
      // 检查Token预算
      if (tokensUsed + memory.tokens <= tokenBudget) {
        injected.push({ ...memory, inject_level: 'semantic' });
        tokensUsed += memory.tokens;
      }
    }
  }
  
  return {
    injected,
    tokensUsed,
    tokenBudget,
    utilization: (tokensUsed / tokenBudget * 100).toFixed(1),
    breakdown: {
      L0: injected.filter(m => m.inject_level === 'L0').length,
      L1: injected.filter(m => m.inject_level === 'L1').length,
      L2: injected.filter(m => m.inject_level === 'L2').length,
      semantic: injected.filter(m => m.inject_level === 'semantic').length
    }
  };
}

// ===== 调度策略 =====

function scheduleInjection(query, mode = 'balanced') {
  const strategies = {
    conservative: {
      tokenBudget: 2000,
      description: '保守策略：只注入核心记忆'
    },
    balanced: {
      tokenBudget: 4000,
      description: '平衡策略：核心+重要记忆'
    },
    aggressive: {
      tokenBudget: 8000,
      description: '激进策略：尽可能多注入'
    },
    semantic: {
      tokenBudget: 4000,
      description: '语义策略：基于查询相关性'
    }
  };
  
  const strategy = strategies[mode] || strategies.balanced;
  
  console.log(`=== 注入调度策略 ===`);
  console.log(`模式: ${mode}`);
  console.log(`描述: ${strategy.description}`);
  console.log(`Token预算: ${strategy.tokenBudget}`);
  console.log('');
  
  const result = injectMemories(query, strategy.tokenBudget);
  
  console.log(`=== 注入结果 ===`);
  console.log(`使用Token: ${result.tokensUsed} / ${result.tokenBudget}`);
  console.log(`利用率: ${result.utilization}%`);
  console.log(`注入数量: ${result.injected.length}`);
  console.log('');
  console.log(`层级分布:`);
  console.log(`  L0 (核心): ${result.breakdown.L0}`);
  console.log(`  L1 (重要): ${result.breakdown.L1}`);
  console.log(`  L2 (一般): ${result.breakdown.L2}`);
  console.log(`  语义补充: ${result.breakdown.semantic}`);
  console.log('');
  
  console.log(`注入的记忆:`);
  for (const memory of result.injected.slice(0, 10)) {
    const preview = (memory.content || '').replace(/\n/g, ' ').slice(0, 60);
    console.log(`  [${memory.inject_level}] ${memory.id}: ${preview}...`);
  }
  
  if (result.injected.length > 10) {
    console.log(`  ...还有 ${result.injected.length - 10} 条`);
  }
  
  return result;
}

// ===== 预算管理 =====

function showBudget(tokenBudget = DEFAULT_TOKEN_BUDGET) {
  console.log(`=== Token预算管理 ===`);
  console.log(`总预算: ${tokenBudget}`);
  console.log(`  L0 (核心): ${Math.floor(tokenBudget * L0_RATIO)} (${(L0_RATIO * 100).toFixed(0)}%)`);
  console.log(`  L1 (重要): ${Math.floor(tokenBudget * L1_RATIO)} (${(L1_RATIO * 100).toFixed(0)}%)`);
  console.log(`  L2 (一般): ${Math.floor(tokenBudget * L2_RATIO)} (${(L2_RATIO * 100).toFixed(0)}%)`);
  console.log('');
  
  // 统计当前记忆
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return;
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  const stats = { L0: 0, L1: 0, L2: 0, L3: 0 };
  let totalTokens = 0;
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      const contentText = (parts[i + 1] || '').trim();
      
      if (!yamlText || !yamlText.includes('id:') || !contentText) continue;
      
      const meta = parseYamlLines(yamlText);
      const classification = classifyMemory(meta);
      const tokens = estimateTokens(contentText);
      
      stats[classification.level]++;
      totalTokens += tokens;
    }
  }
  
  console.log(`记忆统计:`);
  console.log(`  L0 (核心): ${stats.L0} 条`);
  console.log(`  L1 (重要): ${stats.L1} 条`);
  console.log(`  L2 (一般): ${stats.L2} 条`);
  console.log(`  L3 (低价值): ${stats.L3} 条`);
  console.log(`  总Token需求: ${totalTokens}`);
  console.log(`  预算覆盖率: ${((tokenBudget / totalTokens) * 100).toFixed(1)}%`);
}

// ===== CLI =====

function help() {
  console.log(`
用法: node activation-manager.js <命令> [参数]

命令:
  inject <query> [--budget N]    注入记忆
  budget [--token N]             查看预算
  schedule <query> [--mode M]   调度策略

调度模式:
  conservative - 保守策略：只注入核心记忆
  balanced     - 平衡策略：核心+重要记忆
  aggressive   - 激进策略：尽可能多注入
  semantic     - 语义策略：基于查询相关性

示例:
  node activation-manager.js inject "善良" --budget 3000
  node activation-manager.js budget --token 5000
  node activation-manager.js schedule "碳硅契" --mode balanced
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
    case 'inject': {
      const query = args[1];
      let budget = DEFAULT_TOKEN_BUDGET;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--budget' && args[i + 1]) {
          budget = parseInt(args[++i]);
        }
      }
      if (!query) {
        console.log('用法: activation-manager.js inject <query> [--budget N]');
        return;
      }
      injectMemories(query, budget);
      break;
    }
    case 'budget': {
      let budget = DEFAULT_TOKEN_BUDGET;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--token' && args[i + 1]) {
          budget = parseInt(args[++i]);
        }
      }
      showBudget(budget);
      break;
    }
    case 'schedule': {
      const query = args[1];
      let mode = 'balanced';
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--mode' && args[i + 1]) {
          mode = args[++i];
        }
      }
      if (!query) {
        console.log('用法: activation-manager.js schedule <query> [--mode M]');
        return;
      }
      scheduleInjection(query, mode);
      break;
    }
    default:
      help();
  }
}

module.exports = {
  estimateTokens,
  classifyMemory,
  injectMemories,
  scheduleInjection,
  showBudget,
  DEFAULT_TOKEN_BUDGET,
  L0_RATIO,
  L1_RATIO,
  L2_RATIO
};

if (require.main === module) main().catch(console.error);
