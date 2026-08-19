#!/usr/bin/env node
/**
 * migrate-lifecycle.js — 迁移现有记忆到v0.4生命周期
 * 
 * 根据访问次数和时间自动推断生命周期状态
 * 用法: node migrate-lifecycle.js [--dry-run]
 */

const fs = require('fs');
const path = require('path');
const { calculateDecayWeight, isForgotten, isCoreIdentity } = require('./memory');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');

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

function inferLifecycleState(meta) {
  const accessCount = meta.access_count || 0;
  const timestamp = meta.timestamp || '';
  const lastAccess = meta.last_access || timestamp;
  
  // 计算天数
  let daysSinceCreation = 0;
  let daysSinceLastAccess = 0;
  
  if (timestamp) {
    daysSinceCreation = (Date.now() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
  }
  if (lastAccess) {
    daysSinceLastAccess = (Date.now() - new Date(lastAccess).getTime()) / (1000 * 60 * 60 * 24);
  }
  
  // 遗忘判断
  if (isForgotten(meta) && !isCoreIdentity(meta)) {
    return 'forgotten';
  }
  
  // 归档判断：60天未访问
  if (daysSinceLastAccess > 60) {
    return 'archived';
  }
  
  // 巩固判断：访问次数 >= 3 且置信度 >= medium
  if (accessCount >= 3 && meta.confidence !== 'low') {
    return 'consolidated';
  }
  
  // 活跃判断：有访问记录
  if (accessCount > 0) {
    return 'active';
  }
  
  // 默认：新生
  return 'birth';
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return;
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  let total = 0;
  let migrated = 0;
  const stateCounts = { birth: 0, active: 0, consolidated: 0, archived: 0, forgotten: 0 };
  
  for (const file of files) {
    const filePath = path.join(MEMORY_DIR, file);
    const text = fs.readFileSync(filePath, 'utf-8');
    const parts = text.split('\n---\n');
    let modified = false;
    const newParts = [parts[0]]; // 保留 header
    
    for (let i = 1; i < parts.length; i += 2) {
      const yamlText = parts[i];
      const contentText = parts[i + 1] || '';
      if (!yamlText || !yamlText.includes('id:')) {
        newParts.push(yamlText);
        newParts.push(contentText);
        continue;
      }
      
      const meta = parseYamlLines(yamlText);
      total++;
      
      // 如果已有生命周期状态，跳过
      if (meta.lifecycle_state) {
        stateCounts[meta.lifecycle_state]++;
        newParts.push(yamlText);
        newParts.push(contentText);
        continue;
      }
      
      // 推断状态
      const inferredState = inferLifecycleState(meta);
      stateCounts[inferredState]++;
      
      // 更新元数据
      meta.lifecycle_state = inferredState;
      if (inferredState === 'forgotten') {
        meta.forgotten = true;
        meta.forgotten_at = formatTimestamp();
      } else if (inferredState === 'archived') {
        meta.archived_at = formatTimestamp();
      } else if (inferredState === 'consolidated') {
        meta.consolidated_at = formatTimestamp();
      }
      
      // 标记文件已修改
      modified = true;
      
      // 重新生成 YAML
      const fields = [
        `id: "${meta.id}"`,
        `type: ${meta.type || 'conversation'}`,
        `timestamp: "${meta.timestamp || ''}"`,
        `source: ${meta.source || 'unknown'}`,
        `confidence: ${meta.confidence || 'medium'}`,
        `tags: [${(meta.tags || []).join(', ')}]`,
        `visibility: ${meta.visibility || 'public'}`,
        `structural_weight: ${meta.structural_weight || 0}`,
        `is_core_identity: ${meta.is_core_identity || false}`,
        `affective_tag: ${JSON.stringify(meta.affective_tag || {})}`,
        `provenance: ${JSON.stringify(meta.provenance || [])}`,
        `access_count: ${meta.access_count || 0}`,
        `last_access: "${meta.last_access || ''}"`,
        `lifecycle_state: ${inferredState}`,
      ];
      
      if (meta.forgotten) fields.push(`forgotten: true`);
      if (meta.forgotten_at) fields.push(`forgotten_at: "${meta.forgotten_at}"`);
      if (meta.archived_at) fields.push(`archived_at: "${meta.archived_at}"`);
      if (meta.consolidated_at) fields.push(`consolidated_at: "${meta.consolidated_at}"`);
      
      newParts.push(fields.join('\n'));
      newParts.push(contentText);
      migrated++;
    }
    
    if (modified && !dryRun) {
      fs.writeFileSync(filePath, newParts.join('\n---\n'));
    }
  }
  
  console.log('=== 生命周期迁移报告 ===');
  console.log(`总记忆数: ${total}`);
  console.log(`已迁移: ${migrated}`);
  console.log(`模式: ${dryRun ? '预览' : '执行'}`);
  console.log('\n状态分布:');
  for (const [state, count] of Object.entries(stateCounts)) {
    const percentage = total > 0 ? (count / total * 100).toFixed(1) : 0;
    console.log(`  ${state}: ${count} (${percentage}%)`);
  }
}

if (require.main === module) main();
