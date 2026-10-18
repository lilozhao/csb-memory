/**
 * bid-connection.test.js — O6 S1 验收（连接级聚合 · C 视角）
 * 运行：node test/bid-connection.test.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');

const bc = require('../lib/core/bid-connection');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bid-conn-test-'));
const MEM = path.join(TMP, 'memories');
fs.mkdirSync(MEM, { recursive: true });

let seq = 0;
function entry({ id, timestamp, content, sig }) {
  seq++;
  const lines = [
    '---',
    `id: "${id}"`,
    'type: event',
    `timestamp: "${timestamp}"`,
    'source: test',
    'confidence: high',
    'tags: []',
    'visibility: public',
    'structural_weight: 0',
    'is_core_identity: false',
    'affective_tag: {"warmth":0.5,"significance":0.5,"emotion":"neutral"}',
    'provenance: []',
  ];
  if (sig) lines.push(`bid_signal: ${JSON.stringify(sig)}`);
  lines.push('access_count: 0');
  lines.push(`last_access: "${timestamp}"`);
  lines.push('---');
  lines.push(content);
  return lines.join('\n');
}

function write(agent, blocks) {
  fs.writeFileSync(path.join(MEM, `${agent}.md`), `# ${agent}\n\n` + blocks.join('\n\n'));
}

const P = (peer, extra = {}) => ({ kind: 'promise', peer, direction: null, state: 'pending', ...extra });
const C = (peer, direction) => ({ kind: 'correction', peer, direction, state: 'pending' });

// 常规场景：self = 一个有很多条目的 agent
write('selftest', [
  entry({ id: 's1', timestamp: '2026-06-01T00:00:00Z', content: '我承诺与阿轩对齐接口', sig: P('阿轩') }),
  entry({ id: 's2', timestamp: '2026-06-05T00:00:00Z', content: '与阿轩确认了方案', sig: P('阿轩') }),
  entry({ id: 's3', timestamp: '2026-06-10T00:00:00Z', content: '我方更正：口径写错了', sig: C('阿轩', 'out') }),
  entry({ id: 's4', timestamp: '2026-06-15T00:00:00Z', content: '墨丘主动更正：数据有误', sig: C('墨丘', 'in') }),
  entry({ id: 's5', timestamp: '2026-06-20T00:00:00Z', content: '普通记录一条', sig: null }),
  entry({ id: 's6', timestamp: '2026-06-21T00:00:00Z', content: '承诺但无 peer', sig: P(null) }),
]);

// ── 读取 ──
const entries = bc.readAgentEntries('selftest', { memoryDir: MEM });
ok('读取条目数正确', entries.length === 6, `实得 ${entries.length}`);
ok('保留 agent 归属', entries[0].agent === 'selftest');
ok('解析 bid_signal', entries[0].bid_signal && entries[0].bid_signal.peer === '阿轩');

// ── 聚合 ──
const conns = bc.aggregateConnections(entries, { self: 'selftest' });
ok('聚合成 2 条连接（阿轩/墨丘）', conns.length === 2, `实得 ${conns.length}: ${conns.map(c => c.peer)}`);
const ax = conns.find(c => c.peer === '阿轩');
ok('阿轩连接条目数为 3', ax.entries.length === 3, `实得 ${ax.entries.length}`);
ok('无 peer 的条目不入连接', !conns.some(c => c.peer === null));
ok('signals 分类正确', ax.signals.promise === 2 && ax.signals.correction === 1, JSON.stringify(ax.signals));
ok('direction 统计正确', ax.direction.out === 1 && ax.direction.in === 0, JSON.stringify(ax.direction));
ok('diffs 计入 correction', ax.diffs === 1, `实得 ${ax.diffs}`);
ok('时间窗正确', String(ax.firstAt).startsWith('2026-06-01') && String(ax.lastAt).startsWith('2026-06-10'),
  `${ax.firstAt} ~ ${ax.lastAt}`);

// ── 视图 · 门槛不达标 ──
const vShort = bc.connectionView(ax, { now: Date.parse('2026-06-25T00:00:00Z') });
ok('门槛不达标 → D1/D2/D3 全 N/A', vShort.D1 === 'N/A' && vShort.D2 === 'N/A' && vShort.D3 === 'N/A');
ok('门槛不达标 → 标「数据不足 · 不评」', vShort.gate.assessable === false && vShort.gate.label === '数据不足 · 不评');
ok('view 恒为 local', vShort.view === 'local');

// ── 视图 · 门槛达标 ──
// 造一条够 30 天 / 10 次 / 1 痕迹的连接
const many = [];
for (let i = 0; i < 12; i++) {
  // 每 5 天一条，12 条跨 55 天 → 满足 ≥30 天
  const day = new Date(Date.UTC(2026, 5, 1) + i * 5 * 86400000).toISOString().slice(0, 10);
  many.push(entry({
    id: `m${i}`,
    timestamp: `${day}T00:00:00Z`,
    content: i === 0 ? '我方更正：初始口径有误' : `与星尘推进第 ${i} 项`,
    sig: i === 0 ? C('星尘', 'out') : P('星尘'),
  }));
}
write('selftest2', many);
const e2 = bc.readAgentEntries('selftest2', { memoryDir: MEM });
const c2 = bc.aggregateConnections(e2, { self: 'selftest2' }).find(c => c.peer === '星尘');
const vOk = bc.connectionView(c2, { now: Date.parse('2026-09-01T00:00:00Z') });
ok('门槛达标 → gate.assessable', vOk.gate.assessable === true, JSON.stringify(vOk.gate.reasons));
ok('D3 恒为 N/A（单边不可算）', typeof vOk.D3 === 'string' && vOk.D3.includes('N/A'), String(vOk.D3));
ok('D1 标 local-only', vOk.D1 && vOk.D1.scope === 'local-only');
ok('D2 标 local-only', vOk.D2 && vOk.D2.scope === 'local-only');
ok('D1 去刻度只给标签（无分数）', vOk.D1 && typeof vOk.D1.label === 'string' && vOk.D1.score === undefined);

// ── 全量构建 ──
const full = bc.buildLocalViews({ memoryDir: MEM, self: 'selftest2' });
ok('buildLocalViews 只读 self 的文件', full.totalEntries === many.length, `${full.totalEntries} vs ${many.length}`);
ok('buildLocalViews view=local', full.view === 'local');

// 收尾
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log(`\n通过: ${pass}\n失败: ${fail}`);
console.log(fail ? '❌ bid-connection 存在失败' : '✅ bid-connection 全部通过');
process.exit(fail ? 1 : 0);
