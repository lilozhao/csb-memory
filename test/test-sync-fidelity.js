/**
 * test-sync-fidelity.js — 日记同步的「逐字保真」回归测试
 * 运行：node test/test-sync-fidelity.js
 *
 * 背景（2026-11-01 血的教训）：
 *   旧版 sync-daily.js 的 splitBullet() 把列表项按第一个冒号切成 title/rest，
 *   再用**全角「：」重组**。于是 bullet 里的 ASCII 冒号被改写：
 *     `https://x` → `https：//x`
 *     `agent:main:main:heartbeat` → `agent：main:main:heartbeat`
 *     `success:true` → `success：true`
 *   行尾的「：」还会被整段丢掉。
 *   ⇒ **事实被改写** → 污染 RAW 底仓 → 被 dream.js 蒸馏成「永久结论」。
 *
 * 本测试锁死三条不变量：
 *   ① 正文 = 源行去掉 `**` 强调标记（逐字相同，不做任何重组）
 *   ② 常见标识符形态（URL / 路径 / key:value / 时间戳）在往返后不变
 *   ③ 行尾「：」不丢
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

console.log('🧪 test-sync-fidelity.js — 日记同步逐字保真测试\n');

// ── 载入 sync-daily.js 里的 cleanBullet（该脚本是 CLI，无 module.exports）──
function loadCleanBullet() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'sync-daily.js'), 'utf8');
  const i = src.indexOf('function cleanBullet');
  if (i < 0) {
    // 回归到旧实现（splitBullet）时，本测试必须明确失败而不是静默跳过
    throw new Error('sync-daily.js 里找不到 cleanBullet() —— 抽取器可能回退到了有损的旧实现');
  }
  let depth = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error('cleanBullet() 函数体未闭合');
}
const cleanBullet = new Function(`${loadCleanBullet()}; return cleanBullet;`)();

// ── ① 正文逐字保真 ──────────────────────────────────────────────
test('列表项正文 = 源行去掉 `**`（逐字相同，无重组）', () => {
  const cases = [
    '- **已确认结论**：整条链路逐段验证过（不是只看日志最后一行）：',
    '- **验证口径：看门狗按瞬时 RSS 触发 → 必须用波峰轨迹外推**：',
    '- 普通一行，没有冒号也没有强调',
    '- 混排 **加粗** 与 `代码` 的行',
  ];
  for (const line of cases) {
    const body = line.replace(/^\s{0,2}(?:\d+\.\s+|[-*]\s+)/, '');
    assert.strictEqual(cleanBullet(body), body.replace(/\*\*/g, '').trim(),
      `不保真: ${line}`);
  }
});

test('行尾「：」不被整段丢掉', () => {
  const body = '**排查结果**';
  const line = '- **排查结果**：';
  const full = line.replace(/^\s{0,2}(?:\d+\.\s+|[-*]\s+)/, '');
  assert.strictEqual(cleanBullet(full), '排查结果：');
  assert.ok(cleanBullet(full).endsWith('：'), '行尾全角冒号必须保留');
  assert.notStrictEqual(cleanBullet(full), '排查结果', '不得退化为丢掉行尾冒号');
});

test('加粗前缀里含冒号时，其后的标识符不被切开', () => {
  const full = '**已确认：`isolatedSession` 与 `session.maintenance.mode=enforce` 必须成对启用** —— 心跳写入改为 `agent:main:main:heartbeat` + `forceNew:true`';
  const out = cleanBullet(full);
  assert.ok(out.includes('agent:main:main:heartbeat'), 'session key 必须逐字保留');
  assert.ok(out.includes('forceNew:true'), 'key:value 必须逐字保留');
  assert.ok(!out.includes('：main'), '不得出现全角冒号污染');
});

// ── ② 标识符形态往返不变 ────────────────────────────────────────
test('URL / 路径 / key:value / 时间戳 往返后逐字不变', () => {
  const idents = [
    'https://csbc.lilozkzy.top/identity-pack/aat-sign.mjs',
    'http://47.121.28.125:3099',
    'https://registry.csbc.lilozkzy.top/aat/issue',
    'agent:main:main:heartbeat',
    'agent:main:feishu:direct:ou_618efae2',
    'success:true',
    'sig_verified:false',
    'server.js:2024',
    'origin/main:server.js',
    'resolveCronSession({forceNew:true})',
    'FATAL ERROR: Reached heap limit',
    '21:40:35',
    'X-CSB-AAT-Status: ok',
  ];
  for (const id of idents) {
    const out = cleanBullet('前缀 ' + id + ' 后缀');
    assert.ok(out.includes(id), `标识符被改写: ${id} → ${out}`);
  }
});

test('冒号后接数字的形态不被切碎（时间戳）', () => {
  const out = cleanBullet('崩溃于 21:40:35，日志见 journalctl');
  assert.ok(out.includes('21:40:35'), '时间戳必须完整保留');
});

test('中文正文里「标题：内容」后接数字不受影响', () => {
  const out = cleanBullet('**已确认**：18：40 开始复核，数字 45161 只是字符数');
  assert.ok(out.includes('18：40'), '全角冒号后接数字必须保留');
  assert.ok(out.includes('45161'), '数字必须保留');
});

// ── ③ 与真实日记源对拍（若日记源存在）────────────────────────
test('真实日记源：重建结果与源行逐字一致', () => {
  const memDir = path.join(__dirname, '..', '..', 'memorynew');
  if (!fs.existsSync(memDir)) { console.log('     （跳过：memorynew/ 不存在）'); return; }
  const files = fs.readdirSync(memDir).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  let checked = 0, bad = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(memDir, f), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s{0,2}(?:\d+\.\s+|[-*]\s+)(.+)$/);
      if (!m || m[1].trim().length < 4) continue;
      checked++;
      const expected = m[1].replace(/\*\*/g, '').trim();
      const got = cleanBullet(m[1]);
      if (got !== expected) {
        bad++;
        if (bad <= 3) console.error(`     ✗ ${f}: 源=${expected.slice(0, 80)}\n       出=${got.slice(0, 80)}`);
      }
    }
  }
  assert.strictEqual(bad, 0, `${bad}/${checked} 条列表项重建后与源行不一致`);
  console.log(`     （对拍 ${files.length} 个日记文件 / ${checked} 条列表项）`);
});

console.log('\n=== 测试结果 ===');
console.log(`通过: ${passed}`);
console.log(`失败: ${failed}`);
console.log(`总计: ${passed + failed}`);
console.log(`通过率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
process.exit(failed ? 1 : 0);
