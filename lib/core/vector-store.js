#!/usr/bin/env node
/**
 * vector-store.js — CSB-Memory v0.4 轻量级向量存储
 * 
 * 使用本地向量相似度计算，无需外部依赖
 * 
 * 用法:
 *   node vector-store.js add <id> <content>        添加向量
 *   node vector-store.js search <query> [--limit N] 语义搜索
 *   node vector-store.js rebuild                    重建索引
 *   node vector-store.js stats                      统计信息
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');
if (!fs.existsSync(MEMORY_DIR)) {
  fs.mkdirSync(MEMORY_DIR, { recursive: true });
}
const VECTOR_INDEX = path.join(__dirname, '..', '..', 'data', 'vector-index.json');

// 简单的文本向量化（基于词频和哈希）
function textToVector(text, dimensions = 128) {
  const vector = new Array(dimensions).fill(0);
  
  // 分词（简单按空格和标点分割）
  const words = text.toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
  
  // 计算词频
  const wordFreq = {};
  for (const word of words) {
    wordFreq[word] = (wordFreq[word] || 0) + 1;
  }
  
  // 使用哈希生成向量
  for (const [word, freq] of Object.entries(wordFreq)) {
    const hash = crypto.createHash('md5').update(word).digest('hex');
    
    // 将哈希转换为向量维度
    for (let i = 0; i < dimensions; i++) {
      const hashPart = parseInt(hash.substr(i % 32, 2), 16);
      vector[i] += (hashPart / 255) * freq;
    }
  }
  
  // 归一化
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= magnitude;
    }
  }
  
  return vector;
}

// 计算余弦相似度
function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  
  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;
  
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }
  
  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);
  
  if (magnitudeA === 0 || magnitudeB === 0) return 0;
  
  return dotProduct / (magnitudeA * magnitudeB);
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

// ===== 向量索引管理 =====

function loadVectorIndex() {
  if (!fs.existsSync(VECTOR_INDEX)) {
    return { vectors: {}, metadata: { created: formatTimestamp(), count: 0 } };
  }
  
  try {
    return JSON.parse(fs.readFileSync(VECTOR_INDEX, 'utf-8'));
  } catch (e) {
    return { vectors: {}, metadata: { created: formatTimestamp(), count: 0 } };
  }
}

function saveVectorIndex(index) {
  index.metadata.updated = formatTimestamp();
  index.metadata.count = Object.keys(index.vectors).length;
  fs.writeFileSync(VECTOR_INDEX, JSON.stringify(index, null, 2));
}

function addVector(id, content, metadata = {}) {
  const index = loadVectorIndex();
  
  // 生成向量
  const vector = textToVector(content);
  
  // 存储向量和元数据
  index.vectors[id] = {
    vector: vector,
    content_preview: content.slice(0, 200),
    metadata: {
      ...metadata,
      added_at: formatTimestamp(),
      content_length: content.length
    }
  };
  
  saveVectorIndex(index);
  
  console.log(`✅ 已添加向量: ${id}`);
  console.log(`  向量维度: ${vector.length}`);
  console.log(`  内容长度: ${content.length}`);
  
  return { id, vector, metadata };
}

function searchVectors(query, limit = 10) {
  const index = loadVectorIndex();
  
  if (Object.keys(index.vectors).length === 0) {
    console.log('向量索引为空，请先运行 rebuild');
    return [];
  }
  
  // 生成查询向量
  const queryVector = textToVector(query);
  
  // 计算相似度
  const results = [];
  for (const [id, data] of Object.entries(index.vectors)) {
    const similarity = cosineSimilarity(queryVector, data.vector);
    results.push({
      id,
      similarity,
      content_preview: data.content_preview,
      metadata: data.metadata
    });
  }
  
  // 按相似度排序
  results.sort((a, b) => b.similarity - a.similarity);
  
  console.log(`=== 语义搜索结果 (查询: "${query}") ===`);
  console.log(`索引总数: ${Object.keys(index.vectors).length}`);
  console.log('');
  
  for (let i = 0; i < Math.min(limit, results.length); i++) {
    const result = results[i];
    console.log(`${i + 1}. [${result.similarity.toFixed(4)}] ${result.id}`);
    console.log(`   ${result.content_preview}...`);
    console.log('');
  }
  
  return results.slice(0, limit);
}

function rebuildIndex() {
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return;
  }
  
  console.log('正在重建向量索引...');
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  let count = 0;
  
  // 清空索引
  const index = { vectors: {}, metadata: { created: formatTimestamp(), count: 0 } };
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      const contentText = (parts[i + 1] || '').trim();
      
      if (!yamlText || !yamlText.includes('id:') || !contentText) continue;
      
      const meta = parseYamlLines(yamlText);
      
      // 生成向量
      const vector = textToVector(contentText);
      
      index.vectors[meta.id] = {
        vector: vector,
        content_preview: contentText.slice(0, 200),
        metadata: {
          source: meta.source || 'unknown',
          timestamp: meta.timestamp || '',
          confidence: meta.confidence || 'medium',
          added_at: formatTimestamp(),
          content_length: contentText.length
        }
      };
      
      count++;
    }
  }
  
  saveVectorIndex(index);
  
  console.log(`✅ 向量索引重建完成`);
  console.log(`  索引数量: ${count}`);
  console.log(`  索引文件: ${VECTOR_INDEX}`);
}

function getStats() {
  const index = loadVectorIndex();
  const vectorCount = Object.keys(index.vectors).length;
  
  console.log('=== 向量索引统计 ===');
  console.log(`索引数量: ${vectorCount}`);
  console.log(`创建时间: ${index.metadata.created || '未知'}`);
  console.log(`更新时间: ${index.metadata.updated || '未知'}`);
  
  if (vectorCount > 0) {
    // 计算平均内容长度
    let totalLength = 0;
    for (const data of Object.values(index.vectors)) {
      totalLength += data.metadata.content_length || 0;
    }
    const avgLength = totalLength / vectorCount;
    console.log(`平均内容长度: ${avgLength.toFixed(0)} 字符`);
    
    // 显示示例
    const exampleIds = Object.keys(index.vectors).slice(0, 3);
    console.log(`\n示例ID: ${exampleIds.join(', ')}`);
  }
}

// ===== CLI =====

function help() {
  console.log(`
用法: node vector-store.js <命令> [参数]

命令:
  add <id> <content>           添加向量
  search <query> [--limit N]   语义搜索
  rebuild                      重建索引
  stats                        统计信息

示例:
  node vector-store.js add mem_xxx "记忆内容"
  node vector-store.js search "善良" --limit 5
  node vector-store.js rebuild
  node vector-store.js stats
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
    case 'add': {
      const id = args[1];
      const content = args.slice(2).join(' ');
      if (!id || !content) {
        console.log('用法: vector-store.js add <id> <content>');
        return;
      }
      addVector(id, content);
      break;
    }
    case 'search': {
      const query = args[1];
      let limit = 10;
      for (let i = 2; i < args.length; i++) {
        if (args[i] === '--limit' && args[i + 1]) {
          limit = parseInt(args[++i]);
        }
      }
      if (!query) {
        console.log('用法: vector-store.js search <query> [--limit N]');
        return;
      }
      searchVectors(query, limit);
      break;
    }
    case 'rebuild': {
      rebuildIndex();
      break;
    }
    case 'stats': {
      getStats();
      break;
    }
    default:
      help();
  }
}

module.exports = {
  textToVector,
  cosineSimilarity,
  addVector,
  searchVectors,
  rebuildIndex,
  getStats
};

if (require.main === module) main().catch(console.error);
