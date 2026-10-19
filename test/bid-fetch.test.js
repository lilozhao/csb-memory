#!/usr/bin/env node
/**
 * bid-fetch.test.js — S4 跨实例取数（安全闸优先）
 * 重点不是「能取到」，而是「不该取的取不到」：
 *   未同意不发请求 / 越界字段被滤 / at 收日粒度 / 频率闸 / 注册表无此人不认
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const f = require('../lib/core/bid-fetch');
const consent = require('../lib/core/bid-consent');

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.log('  ❌ ' + name, extra === undefined ? '' : extra); }
};
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bidfetch-')), 'consent.json');

(async () => {
  // ── 1 白名单过滤 ──
  {
    const { kept, dropped } = f.filterSignals([
      { kind: 'promise', peer: '若兰', direction: 'out', state: 'fulfilled', origin: 'realtime', at: '2026-10-16T09:33:21Z', content: '不该出现', id: 'x' },
      { kind: 'decision', at: '2026-10-17' },
      null,
    ]);
    ok('只留六字段（content/id 被剔除）', kept[0].content === undefined && kept[0].id === undefined && Object.keys(kept[0]).sort().join() === 'at,direction,kind,origin,peer,state');
    ok('at 收窄到日（Q-S4-1）', kept[0].at === '2026-10-16', kept[0].at);
    ok('越界字段如实计数（不静默）', dropped.length >= 2 && dropped.some(d => (d.fields || []).includes('content')), JSON.stringify(dropped));
    ok('非对象元素丢弃且留痕', dropped.some(d => d.reason === 'not-object'));
    ok('整条不因越界而被丢弃', kept.length === 2);
  }

  // ── 2 未同意 → 连请求都不发 ──
  {
    const file = tmp();
    let called = false;
    const origFetch = global.fetch;
    global.fetch = async () => { called = true; return { ok: true, json: async () => ({ agents: [] }), text: async () => '{}' }; };
    const r = await f.fetchFrom('若琢', { consentOpts: { file }, registry: 'http://127.0.0.1:1' });
    global.fetch = origFetch;
    ok('未同意 → stage=consent', r.ok === false && r.stage === 'consent', JSON.stringify(r));
    ok('未同意 → 一个网络请求都没发（沉默不采）', called === false);
  }

  // ── 3 已同意但注册表无此人 → 不认 ──
  {
    const file = tmp();
    consent.grant('若琢', ['若兰', '若琢'], { file });
    const origFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ agents: [{ name: '别的', host: 'x', port: 1 }] }), text: async () => '{}' });
    const r = await f.fetchFrom('若琢', { consentOpts: { file }, registry: 'http://127.0.0.1:1' });
    global.fetch = origFetch;
    ok('注册表无此人 → 拒绝（Q-S4-4）', r.ok === false && r.stage === 'resolve', JSON.stringify(r.reasons));
  }

  // ── 4 端到端：发送 → 过滤 → 落盘 → 登记副本位置 ──
  {
    const file = tmp();
    const storeDir = path.dirname(file) + '/remote';
    consent.grant('若琢', ['若兰', '若琢'], { file });
    const origFetch = global.fetch;
    global.fetch = async (url) => {
      if (String(url).endsWith('/agents')) {
        return { ok: true, json: async () => ({ agents: [{ name: '若琢', host: '127.0.0.1', port: 3100, version: '5.0.1' }] }), text: async () => '{}' };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({
          result: {
            peer: '若琢', view: 'remote-granted',
            consent: { noticeVersion: 'v1' },
            signals: [{ kind: 'promise', peer: '若兰', direction: 'out', state: 'fulfilled', origin: 'realtime', at: '2026-10-16T09:33:21Z', content: '越界' }],
          },
        }),
      };
    };
    const r = await f.fetchFrom('若琢', { consentOpts: { file }, storeDir, registry: 'http://127.0.0.1:1' });
    global.fetch = origFetch;
    ok('端到端成功', r.ok === true && r.stage === 'done', JSON.stringify(r.reasons || r.stage));
    ok('落盘副本存在', fs.existsSync(r.file));
    const saved = JSON.parse(fs.readFileSync(r.file, 'utf8'));
    ok('落盘不含正文', !JSON.stringify(saved.signals).includes('越界'));
    ok('receipt 带 count + sha256', saved.receipt.count === 1 && saved.receipt.sha256.length === 64);
    const rec = consent.loadAll(file).connections.find(c => c.peer === '若琢');
    ok('副本位置已登记（撤回才删得掉）', (rec.dataLocations || []).includes(r.file), JSON.stringify(rec.dataLocations));

    // ── 5 频率闸：24h 内二次取数被拦 ──
    const r2 = await f.fetchFrom('若琢', { consentOpts: { file }, storeDir, registry: 'http://127.0.0.1:1' });
    ok('24h 内二次取数 → stage=rate（Q-S4-5）', r2.ok === false && r2.stage === 'rate', JSON.stringify(r2.reasons || r2.stage));

    // ── 6 撤回后：立即不准取，且删除计划能列出副本 ──
    consent.withdraw('若琢', '若兰', { file });
    consent.markNotified('若琢', { file, to: '若琢', by: '若兰' });
    const r3 = await f.fetchFrom('若琢', { consentOpts: { file }, storeDir, registry: 'http://127.0.0.1:1' });
    ok('撤回后 → stage=consent', r3.ok === false && r3.stage === 'consent');
    ok('撤回原因含隔离', r3.reasons.some(x => x.includes('隔离')), JSON.stringify(r3.reasons));
    const plan = consent.purgePlan('若琢', { file });
    ok('删除计划列出已登记副本', plan.targets.includes(r.file), JSON.stringify(plan.targets));
  }

  console.log(`\n通过: ${pass}\n失败: ${fail}`);
  console.log(`${fail === 0 ? '✅' : '❌'} bid-fetch: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
