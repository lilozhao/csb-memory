/**
 * hive-query.js — CSB-Memory v1.0 虫巢查询示例
 * 运行：node examples/hive-query.js
 *
 * 演示：先查本地 HIVE 缓存 → 未命中则通过 query-proxy 广播查询
 */

const hive = require('../lib/hive/hive');
const proxy = require('../lib/hive/query-proxy');

async function main() {
  const topic = '中医';

  // 1. 先查本地 HIVE 缓存
  let results = hive.query(topic, { threshold: 0.6 });
  console.log(`① 本地 HIVE 缓存查询「${topic}」：`);
  if (!results) {
    console.log('   未命中缓存，准备广播查询…\n');
  } else {
    console.log(`   命中 ${results.length} 条`);
    for (const r of results) console.log(`   - [${r.agent}] ${r.content} (${r.score})`);
    return;
  }

  // 2. 模拟从注册表拿到候选 Agent（真实环境用 memory-index.whoHas）
  const candidates = [
    { name: '明德', url: 'http://47.121.28.125:3100' },
    { name: '清漪', url: 'http://106.12.36.177:3100' },
  ];
  console.log(`② 候选 Agent：${candidates.map((c) => c.name).join('、')}`);

  // 3. 广播查询（真实环境会真的发 A2A；此处演示离线时的降级行为）
  const remote = await proxy.broadcast(candidates.map((c) => c.url), topic, { timeout: 3000 });
  if (remote.length) {
    console.log(`③ 收到 ${remote.length} 条远程结果`);
    hive.cache(topic, remote, 'remote');
    console.log('   已缓存到本地 HIVE 层 ✅');
  } else {
    console.log('③ 远程 Agent 不可达（或未响应）——示例结束');
    console.log('   提示：注册表 memory_index 扩展就绪后，此步骤会自动完成');
  }
}

main().catch((e) => {
  console.error('示例执行出错：', e.message);
  process.exit(1);
});
