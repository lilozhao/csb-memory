#!/usr/bin/env node
/**
 * weight-decay.js — CSB-Memory v0.4 权重衰减遗忘机制
 * 
 * 定期运行，标记遗忘记忆，但不物理删除
 * 用法: node weight-decay.js [--dry-run] [--restore <id>]
 */

const fs = require('fs');
const path = require('path');
const { calculateDecayWeight, isForgotten, isCoreIdentity } = require('./memory');

const MEMORY_DIR = path.join(__dirname, '..', '..', 'data', 'a2a-memories');
const FORGET_THRESHOLD = 0.01;

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

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const restoreIdx = args.indexOf('--restore');
  
  if (!fs.existsSync(MEMORY_DIR)) {
    console.log('记忆目录不存在');
    return;
  }
  
  const files = fs.readdirSync(MEMORY_DIR).filter(f => f.endsWith('.md') && !f.endsWith('.bak'));
  let total = 0;
  let forgotten = 0;
  let restored = 0;
  
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
      
      // 计算衰减权重
      const weight = calculateDecayWeight(meta);
      const forgotten = isForgotten(meta);
      
      // 恢复指定记忆
      if (restoreIdx >= 0 && args[restoreIdx + 1] === meta.id) {
        meta.structural_weight = 0.1;
        meta.last_access = formatTimestamp();
        modified = true;
        restored++;
        console.log(`恢复记忆: ${meta.id}`);
      }
      
      // 标记遗忘（不物理删除）
      if (forgotten && !isCoreIdentity(meta)) {
        // 添加遗忘标记
        if (!meta.forgotten) {
          meta.forgotten = true;
          meta.forgotten_at = formatTimestamp();
          modified = true;
          forgotten++;
          console.log(`标记遗忘: ${meta.id} (权重: ${weight.toFixed(4)})`);
        }
      }
      
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
      ];
      if (meta.forgotten) fields.push(`forgotten: true`);
      if (meta.forgotten_at) fields.push(`forgotten_at: "${meta.forgotten_at}"`);
      
      newParts.push(fields.join('\n'));
      newParts.push(contentText);
    }
    
    if (modified && !dryRun) {
      fs.writeFileSync(filePath, newParts.join('\n---\n'));
    }
  }
  
  console.log(`\n=== 权重衰减报告 ===`);
  console.log(`总记忆数: ${total}`);
  console.log(`标记遗忘: ${forgotten}`);
  console.log(`恢复记忆: ${restored}`);
  console.log(`模式: ${dryRun ? '预览' : '执行'}`);
}

if (require.main === module) main();
