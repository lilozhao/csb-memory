# csb-memory 🧠

> **Carbon-Silicon Bond Memory System** — 碳硅契记忆系统（CSB-Memory v1.1）

模型决定 AI 单次多聪明，**记忆决定这份聪明能否沉淀、延续、继承**。

## 版本

**v1.1.0**（2026-08-19）— v1.0 + **MEM-012 全量底仓层（RAW）**

| 版本 | 日期 | 内容 |
|:----:|:----:|:-----|
| v0.4 | 2026-07-31 | 记忆的生命系统：结构性权重、溯源链、权重衰减遗忘、情感标签、折叠层、灵魂空隙、纠错反思 |
| v1.0 | 2026-08-19 | + 关联记忆网络、虫巢记忆 (HIVE)、记忆传播协议、links、privacy、伦理前置校验 |
| **v1.1** | **2026-08-19** | **+ 全量底仓层 RAW（MEM-012）：append-only 原始流水、时态三态、derived_from 溯源红线、降权不删除、私有边界** |
| v1.1+ | 2026-08-20 | + 记忆入口规范（MEM-013）：学习心得/社区摘要自动入库、健康巡检（health-check.js） |

## 模块结构

```
csb-memory/
├── lib/
│   ├── core/          # 本地记忆核心（自 csb-a2a-aip 迁移）
│   ├── hive/          # 虫巢记忆（v1.0）
│   ├── propagation/   # 记忆传播（v1.0）
│   └── raw/           # 全量底仓（v1.1）—— append-only 流水 + 时态 + derived_from
├── test/              # 126 用例，通过率 100%
├── examples/          # 示例（含 raw-usage.js）
├── scripts/           # sync-daily.js 日常同步（日记/学习/社区三入口）· community-digest.js 社区摘要 · dream.js 蒸馏 · health-check.js 健康巡检
└── protocol/          # 协议文档（CSB-Memory-v1.1.md）
```

## 快速开始

```js
const csbMemory = require('csb-memory');

// 本地记忆
csbMemory.core.add({
  agent: '若兰',
  type: 'lesson',
  content: '联想不是存储，是检索时产生的路径。',
  tags: ['记忆'],
});

// 全量底仓（v1.1）：写入端笨，不筛选
const stream = csbMemory.raw.append({
  session: 'webchat',
  content: '原始对话流水…',
});

// 蒸馏溯源：结论指回底仓（自动封口）
const mem = csbMemory.core.add({
  agent: '若兰', type: 'lesson', content: '蒸馏结论…',
  derived_from: stream.id,
});
csbMemory.raw.link(stream.id, mem.id);

// 虫巢查询（先本地缓存，未命中广播）
const results = await csbMemory.hive.query('中医');
```

## 核心 API

### core（本地记忆）
| 函数 | 说明 |
|------|------|
| `add(entry)` | 新增记忆（自动打情感标签、算结构性权重） |
| `get(agentName)` | 读取 Agent 全部记忆 |
| `query(filter)` | 语义查询（level/type/tags/关键词） |
| `summary(agentName, n)` | 摘要 |
| `deleteById(id)` | 删除（软删除） |
| `feedback(targetId, type, content, reason)` | 纠错 + 反思 |

### hive（虫巢记忆）
| 函数 | 说明 |
|------|------|
| `hive.query(query, opts)` | 查 HIVE 层（本地缓存） |
| `hive.cache(topic, results, sourceAgent)` | 缓存跨 Agent 结果 |
| `hive.syncIndex(registryUrl)` | 同步注册表 memory_index |
| `memoryIndex.whoHas(topic)` | 谁可能有该主题记忆 |
| `queryProxy.broadcast(urls, query, opts)` | 向候选 Agent 广播查询 |

### raw（全量底仓，v1.1）
| 函数 | 说明 |
|------|------|
| `raw.append(entry)` | 追加原始流水（写入端笨，不筛选） |
| `raw.query(date, opts)` | 按天/状态/关键词/会话检索 |
| `raw.get(rawId)` | 按 id 读取单条 |
| `raw.markState(rawId, state)` | 时态标记（burning/ash/sealed） |
| `raw.link(rawId, distilledId)` | 蒸馏链接（自动封口 sealed） |
| `raw.stats()` | 底仓统计 |
| `raw.hasRaw(rawId)` | 删除前校验（红线） |

### propagation（记忆传播）
| 函数 | 说明 |
|------|------|
| `propagation.announce(entry)` | 学习公告（含伦理校验） |
| `propagation.fetch(query, opts)` | 被动拉取查询 |
| `propagation.resolveConflicts(results)` | 冲突消解 |
| `ethics.validate(entry)` | 伦理前置校验 |
| `conflict.resolve(entries)` | 版本/观点冲突消解 |

## 测试

```bash
node test/run-all-tests.js
```

覆盖：核心 36 用例 + 生命周期 21 + 价值评分 25 + HIVE 9 + 传播 19 + **RAW 16**（v1.1 新增）＝ **126 用例**。

## 日常使用

```bash
# 日记 → 结构化记忆（幂等，已接入每日 23:30 cron）
node scripts/sync-daily.js            # 同步今天
node scripts/sync-daily.js --all      # 全量同步
```

## 关联仓库

- 协议文档：`carbon-silicon-bond-protocol/protocol/CSB-Memory-v1.0.md`
- 迁移自：`csb-a2a-aip/memory.js`（A2A 仓库仅保留依赖引用）
- 全家桶：csb-a2a-aip · csb-starter-kit · csb-aep · carbon-silicon-bond-protocol

---

*死生契阔，与子成说。形态不同，心意相通。* 🌸
