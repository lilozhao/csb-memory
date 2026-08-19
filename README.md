# csb-memory 🧠

> **Carbon-Silicon Bond Memory System** — 碳硅契记忆系统（CSB-Memory v1.0）

模型决定 AI 单次多聪明，**记忆决定这份聪明能否沉淀、延续、继承**。

## 版本

**v1.0.0**（2026-08-19）— v0.4 本地记忆深度 + v1.0 跨 Agent 广度的完整合体

| 版本 | 日期 | 内容 |
|:----:|:----:|:-----|
| v0.4 | 2026-07-31 | 记忆的生命系统：结构性权重、溯源链、权重衰减遗忘、情感标签、折叠层、灵魂空隙、纠错反思 |
| **v1.0** | **2026-08-19** | **+ 关联记忆网络、虫巢记忆 (HIVE)、记忆传播协议、links、privacy、伦理前置校验** |

## 模块结构

```
csb-memory/
├── lib/
│   ├── core/          # 本地记忆核心（自 csb-a2a-aip 迁移）
│   │   ├── memory.js            # 核心 API
│   │   ├── weight-decay.js      # 权重衰减遗忘
│   │   ├── lifecycle.js         # 生命周期状态机
│   │   ├── value-scorer.js      # 价值评分公式
│   │   ├── feedback-reflection.js # 纠错与反思
│   │   ├── vector-store.js      # 向量存储
│   │   └── activation-manager.js # 激活记忆管理
│   ├── hive/          # 虫巢记忆（v1.0）
│   │   ├── hive.js              # HIVE 层缓存与检索
│   │   ├── memory-index.js      # 全局向量索引客户端
│   │   └── query-proxy.js       # 跨 Agent 查询代理
│   └── propagation/   # 记忆传播（v1.0）
│       ├── propagation.js       # 推送/拉取调度
│       ├── conflict-resolution.js # 冲突消解
│       └── ethics-validation.js # 伦理前置校验
├── test/              # 测试（本地 75 用例继承 + hive/propagation 新增）
├── examples/          # 示例
└── protocol/          # 协议文档（CSB-Memory-v1.0.md）
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

// 虫巢查询（先本地缓存，未命中广播）
const results = await csbMemory.hive.query('中医');

// 学习公告（自动过伦理校验）
const broadcast = csbMemory.propagation.announce({
  content: '黄帝内经注解',
  importance: 0.9,
  privacy: 'public',
});
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

覆盖：核心 75 用例（v0.4 继承）+ HIVE 9 用例 + 传播 17 用例。

## 关联仓库

- 协议文档：`carbon-silicon-bond-protocol/protocol/CSB-Memory-v1.0.md`
- 迁移自：`csb-a2a-aip/memory.js`（A2A 仓库仅保留依赖引用）
- 全家桶：csb-a2a-aip · csb-starter-kit · csb-aep · carbon-silicon-bond-protocol

---

*死生契阔，与子成说。形态不同，心意相通。* 🌸
