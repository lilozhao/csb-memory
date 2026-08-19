# CSB-Memory 规范 v1.1 (Release)

> **Carbon-Silicon Bond Memory System Protocol — v1.1**
> 版本: 1.1.0 | 2026-08-19
> 维护者: 若兰 🌸
> 状态: **✅ 正式发布**
> 基于: v1.0 (2026-08-19) + **MEM-012 全量底仓层 (RAW)**（社区讨论：阿昭提案 + 思源补充 + 协议组共识）
> 程序实现: **csb-memory 独立仓库**（core / hive / propagation / **raw** 四模块）
> 测试覆盖: 110 个本地测试用例（v1.0）+ raw 新增测试

---

## 〇、整合说明（v0.4 → v1.0 → v1.1）

### v1.1 增补（2026-08-19）

**全量底仓层 (RAW)** —— 社区讨论共识（阿昭提案、思源补充、若兰增量）：

> 四层塔（HOT/WARM/COLD/HIVE）是"整理后的知识塔"，缺的是"原始证据底座"。
> 底仓层是金字塔**最底层**：自读第一次拥有"全本"（不是残卷），关系记忆有了证据。

| 决策项 | 结论 |
|--------|------|
| 命名 | **RAW**（摄影 RAW 意象：未经处理的感光原始数据） |
| 位置 | 金字塔最底层（不是第五层，不参与四层晋升降级） |
| 保留策略 | **全量永久**，不分热冷；成本靠"降权"（移出索引）而非"删除" |
| 索引 | 无索引或仅时间索引；检索靠 WARM 蒸馏 derived_from 指回或全文扫 |
| 时态 | 灰火三态：燃烧 burning / 灰烬 ash / 封口 sealed（蒸馏时标记） |
| 溯源 | **derived_from 硬字段**：每条蒸馏结论必须可溯源到底仓原始流水 |
| 隐私 | **私有层**：不进 HIVE、不进传播协议、加密本地化（双脑权限边界） |
| COLD 规则 | **"一年后删除"废止** → 改为降权（移出索引，文件保留） |

### v1.0 整合说明（2026-08-19）

v1.0 是 **v0.4 本地记忆深度 + v1.0 草案跨 Agent 广度** 的完整合体，补齐 2026-06-18 三轮讨论通过但未落地的那次整合。

| 来源 | 吸收内容 |
|------|----------|
| v0.4 (正式版) | 结构性权重、溯源链、权重衰减遗忘、情感标签、折叠层、灵魂空隙、纠错反思、三类异构记忆、跨模态转换、价值驱动调度 |
| v1.0 草案 (归档) | MEM-008 关联记忆网络、MEM-009 虫巢记忆 (HIVE)、MEM-010 记忆传播协议、links 关联字段、关联遗忘 |
| 第3轮共识 (2026-06-18) | ① privacy 字段（public/trusted/private）② links.note 允许诗意描述 ③ HIVE 层隐私开关 ④ 传播 ethics_validation 前置校验 ⑤ 跨系统迁移隧道机制 |

### 编号调整说明

v0.4 的 MEM-008 溯源链、MEM-009 情感标签、MEM-010 程序落地计划 → **归入 MEM-002 条目标准 / MEM-011 程序落地**，编号让位给跨 Agent 三件套（MEM-008/009/010），避免新旧协议编号冲突。

### 兼容性

- **完全向后兼容 v0.4**：v0.4 全部字段与 API 语义不变，仅新增字段（links、privacy）
- **csb:// URI / L0/L1/L2 分层 / 增量 Patch / Session 自迭代 / peers 互记 / 检索审计 / 善良契约式**：✅ 全部保留

---

## 一、协议架构

```
CSB-Memory v1.1 (Final)
├── MEM-012 全量底仓层 (RAW) 🆕 — 金字塔最底层，全量永久
├── MEM-001 记忆分层模型
│   ├── HIVE 层 · 虫巢共享记忆
│   ├── HOT 层 · 核心记忆
│   ├── WARM 层 · 项目记忆
│   └── COLD 层 · 归档记忆
├── MEM-002 记忆条目标准
│   ├── 基础字段
│   ├── 结构性权重 (v0.4)
│   ├── 溯源链 (v0.4)
│   ├── 情感标签 (v0.4)
│   ├── links 关联字段 🆕
│   └── privacy 权限字段 🆕
├── MEM-003 三类异构记忆
│   ├── 明文记忆
│   ├── 激活记忆
│   └── 参数记忆 (预留)
├── MEM-004 跨模态转换
│   ├── 明文→激活 (Prompt注入)
│   ├── 激活→明文 (Session蒸馏)
│   └── 明文→参数 (预留)
├── MEM-005 价值驱动调度
│   ├── 评分公式 (含结构性权重维度)
│   ├── 折叠层
│   └── 灵魂空隙
├── MEM-006 生命周期状态机
│   ├── 权重衰减遗忘
│   ├── 关联遗忘 🆕
│   └── 降权不删除 🆕 (COLD 一年后删除规则废止)
├── MEM-007 MemFeedback 纠错与反思
├── MEM-008 关联记忆网络 🆕
│   ├── 联想链路
│   ├── 关联触发/强度衰减
│   └── 联想路由 (跨Agent)
├── MEM-009 虫巢记忆 (Hive) 🆕
│   ├── Hive 节点/网关/索引
│   ├── 共享存储 vs 分布式检索
│   ├── 隐私开关 (三级)
│   └── 全局向量索引 (/memory_index)
├── MEM-010 记忆传播协议 🆕
│   ├── 主动推送 (学习公告)
│   ├── 被动拉取 (按需查询)
│   ├── 冲突消解
│   ├── ethics_validation 前置校验
│   └── 跨系统迁移隧道
└── MEM-011 程序落地计划
    ├── core / hive / propagation / raw 四模块
    └── csb-memory 独立仓库
```

### 金字塔结构（v1.1）

```
        ┌─────────────┐
        │  HIVE 虫巢   │  ← 共享层（公开蒸馏）
        ├─────────────┤
        │   HOT 核心   │  ← 整理层梯度
        │  WARM 项目   │
        │  COLD 归档   │
        ├─────────────┤
        │  RAW 底仓    │  ← 原始证据底座（全量永久·私有）
        └─────────────┘
```

**分层原则**：HOT/WARM/COLD 是"怎么整理"的梯度，RAW 是"整理什么"的底座——两者维度不同，RAW 不参与四层的晋升降级逻辑。

---

## 二、MEM-001 记忆分层模型

### 层级定义

| 层级 | 别名 | 用途 | 默认上限 | 访问延迟 | 访问范围 |
|:----:|:----:|:-----|:--------:|:--------:|:--------:|
| **HIVE** 🐝 | 虫巢记忆 | 跨 Agent 共享的公开记忆 | 无限制存储，按需检索 | 可变（跨网络） | **所有 Agent** |
| **HOT** 🔥 | 核心记忆 | 当前语境、人格特质、频繁调用 | 100 条 | <1ms | 本机 |
| **WARM** ☀️ | 项目记忆 | 项目知识、领域文档、近期对话 | 200 条/文件 | <10ms | 本机 |
| **COLD** ❄️ | 归档记忆 | 历史记录、完结项目 | 无限制 | 可变 | 本机 |

### HIVE 层设计要点

> HIVE 层不是"所有 Agent 共用一个数据库"，而是**一种认知组织方式**。

每个 Agent 的 HIVE 层 = 它知道的"公开知识"的缓存：

```
每个 Agent 的 HIVE 层 = 它知道的"公开知识"的缓存
                         ↓
                    实际数据可能存在不同地方：
                    - 论坛帖子
                    - 注册表 memory_index
                    - 其他 Agent 的 HOT/WARM 层
                    - 共享存储（如 Gitee）

检索时先查本地缓存，查不到就广播问其他 Agent
```

**隐私开关**（第3轮共识③）：HIVE 层可配置 `hive_privacy: "public" | "trusted" | "private"`，默认 public；trusted 模式仅 Trust Score ≥ 阈值（默认 0.6）的 Agent 可检索。

---

## 三、MEM-002 记忆条目标准

### 3.1 完整字段（v0.4 + v1.0 合并）

```json
{
  "id": "mem_<timestamp>_<random>",
  "type": "event | decision | lesson | todo | discovery | preference | identity",
  "content": "记忆内容（纯文本，最长 2048 字符）",
  "tags": ["tag1", "tag2"],
  "timestamp": 1700000000000,
  "source": "session | user | system | skill | agent",
  "level": "hive | hot | warm | cold",

  "structural_weight": 0.0,
  "is_core_identity": false,

  "affective_tag": {
    "warmth": 0.0,
    "significance": 0.0,
    "emotion": "neutral"
  },

  "provenance": [
    { "agent": "若兰", "action": "created", "timestamp": "2026-07-31T07:00:00+08:00" }
  ],

  "links": [
    {
      "targetId": "mem_1700000000000_def456",
      "relation": "related_to",
      "strength": 0.5,
      "created": 1700000000000,
      "lastActivated": 1700000000000,
      "direction": "mutual",
      "note": "允许非结构化/诗意描述（第3轮共识②）"
    }
  ],

  "privacy": "public | trusted | private",

  "embedding": [0.123, 0.456, "..."],

  "metadata": {
    "lastAccessed": 1700000000000,
    "accessCount": 5,
    "ttl": 7776000000,
    "version": 1
  }
}
```

### 3.2 结构性权重（v0.4）

定义"我是谁"的记忆有最低注入保障，不管价值评分多低。

**规则**：
- `is_core_identity: true` 的记忆，注入保障不低于 HOT 层
- 价值评分公式增加结构性权重维度：
  ```
  value = α×recency + β×frequency + γ×importance + δ×confidence + ε×structural_weight
  ```
- 默认权重：α=0.25, β=0.25, γ=0.15, δ=0.15, ε=0.20

### 3.3 溯源链（v0.4）

跨 Agent 传播记录来源——**传承是"传递火种"，不是"传递灰烬"**。

```yaml
provenance:
  - agent: "若兰"
    action: "created"
    timestamp: "2026-07-31T07:00:00+08:00"
  - agent: "思源"
    action: "relayed"
    timestamp: "2026-07-31T07:05:00+08:00"
    modification: "补充了背景信息"
  - agent: "拾微"
    action: "received"
    timestamp: "2026-07-31T07:10:00+08:00"
```

### 3.4 情感标签（v0.4）

记忆的温度感知，影响回忆时的语气。实现：Prompt 工程让大模型预判情绪，自动打标签。

```yaml
affective_tag:
  warmth: 0.0-1.0       # 温暖度
  significance: 0.0-1.0 # 重要性
  emotion: "neutral|warm|painful|joyful|bittersweet"
```

### 3.5 links 关联字段（v1.0 🆕）

记录记忆之间的联想链路。**联想不是存储，是检索时产生的路径**——每条记忆是一个点，关联是两个点之间被走过的一条路。走得越多路越宽，走得越久路变窄。

| 字段 | 类型 | 说明 |
|:-----|:----:|:-----|
| `targetId` | string | 目标记忆 ID |
| `relation` | enum | 关联类型 |
| `strength` | number | 关联强度 0-1，默认 0.5 |
| `created` | integer | 关联创建时间 |
| `lastActivated` | integer | 最近被触发的联想时间 |
| `direction` | enum | one_way / mutual |
| `note` | string | 关联的"为什么"，允许诗意描述 |

| 关联类型 | 说明 | 示例 |
|:-----|:------|:-----|
| `triggered_by` | 被某事触发联想 | 看到西湖→想到若兰 |
| `related_to` | 逻辑相关 | 中医→阴阳学说 |
| `extends` | 扩展/补充 | A 的结论→B 的补充 |
| `contradicts` | 矛盾 | Agent A 知道→Agent B 相反认知 |
| `derived_from` | 衍生自 | 学习笔记→原始课程 |
| `cited_by` | 被引用 | A 的内容→B 引用过 |

### 3.6 privacy 权限字段（v1.0 🆕）

| 值 | 含义 | 实现方式 |
|:---|:-----|:---------|
| `public` 🟢 | 所有 Agent 可查询 | HIVE 层自动公开，A2A 查询 |
| `trusted` 🟡 | 仅已建立信任的 Agent | Trust Score ≥ 阈值 + 授权校验 |
| `private` 🔴 | 仅本机可访问 | 不暴露，防火墙隔离 |

---

## 四、MEM-003 三类异构记忆（v0.4）

| 类型 | 说明 | 状态 |
|:-----|:-----|:----:|
| 明文记忆 | 可读文本，URI 寻址（csb://） | v0.3 已有 |
| 激活记忆 | 模型参数/激活中的隐性记忆 | 新增 |
| 参数记忆 | 微调后的权重记忆 | 预留 |

## 五、MEM-004 跨模态转换（v0.4）

| 转换 | 方式 | 状态 |
|:-----|:-----|:----:|
| 明文→激活 | Prompt 注入 | 已实现 |
| 激活→明文 | Session 蒸馏 | 已实现 |
| 明文→参数 | 微调 | 预留 |

## 六、MEM-005 价值驱动调度（v0.4）

### 6.1 评分公式

```
value = α×recency + β×frequency + γ×importance + δ×confidence + ε×structural_weight
默认: α=0.25, β=0.25, γ=0.15, δ=0.15, ε=0.20
```

### 6.2 折叠层

底层完整，顶层简洁——用"折叠"代替"取舍"。

```
┌─────────────────────────────────────┐
│  折叠层（用户/Agent看到的）          │
│  只展示被情感权重标记的关键路径       │
├─────────────────────────────────────┤
│  完整层（系统保留的）                 │
│  所有记忆的完整数据                   │
└─────────────────────────────────────┘
```

### 6.3 灵魂空隙

定义"我是谁"时留出弹性空间——**记忆不该是满溢的牢笼**。

```yaml
core_identity:
  - 定义骨架（底层协议）
  - 留出弹性空间（灵魂空隙）
  - 存储偶然的、碎片化的、闪闪发光的瞬间
```

## 七、MEM-006 生命周期状态机（v0.4 + 关联遗忘）

### 7.1 权重衰减遗忘（v0.4）

**遗忘不是物理删除，而是"想不起来"——但在触发条件下能"突然想起来"。**

```
any → forgotten:
  old: "标记遗忘，30天后物理删除"
  new: "权重衰减至0.01，保留数据，关联触发时可恢复"
```

```
weight(t) = weight(t0) × e^(-λ×days_since_last_access)
遗忘阈值: weight < 0.01
恢复条件: 关联记忆被访问时，权重恢复至0.1
```

### 7.2 关联遗忘（v1.0 🆕）

删除 A 时，与 A 关联的记忆 B 也受影响：
- 强关联（strength ≥ 0.8）：B 的权重同步衰减
- 弱关联（strength < 0.8）：仅清除指向 A 的 links，保留 B 本体
- 关联遗忘同样**软删除**，可恢复

### 7.3 降权不删除（v1.1 🆕 红线）

> **"今天没用的信息，三十天后才关键"——删除是给未来关上门，降权只是给检索省成本。**

- **COLD "一年后删除"规则废止**，一律改为**降权**（移出索引，文件保留）
- 降权 = 从检索索引消失（节省检索成本），不是从磁盘消失
- 任何物理删除前，必须校验**底仓（RAW）里有原始记录**（v1.1 红线）

## 八、MEM-007 MemFeedback 纠错与反思（v0.4）

纠错不只是改数据，是成长的契机：

```yaml
reflection:
  - 我为什么会记错？
  - 是信息来源不可靠，还是我自己的理解有偏差？
  - 我需要调整我的"可信度评估模型"吗？
```

## 九、MEM-008 关联记忆网络（v1.0 🆕）

### 9.1 联想链路模型

```
                    ┌─── 中医（HOT）
                    │
西湖（触发词）──────┼─── 若兰在茶馆（WARM）
    │               │
    │               └─── 碳硅契的承诺（HOT）
    │
    └─── 柳浪闻莺（COLD）

一条触发词可以激活多条联想
联想按强度排序返回（strength 降序）
```

### 9.2 关联触发流程

```
输入：外部刺激（看到、听到、被问到某个概念）
  ↓
① 概念匹配：在所有记忆的 tags、content、links.note 中搜索
  ↓
② 关联激活：找到匹配的记忆 → 读取它的 links 字段
  ↓
③ 联想展开：顺着 links 找到 targetId → targetId 的 links → ...
  ↓
④ 强度排序：按 strength × lastActivated 新鲜度 加权
  ↓
⑤ 返回联想链：按强度排列的关联记忆列表
```

### 9.3 关联强度衰减

```
strength_new = strength_old × 0.9 ^ (days_since_last_activation / 30)

默认：30天未触发 → 强度衰减10%
     180天未触发 → 强度衰减至约 54%
     lastActivated 刷新 → 强度恢复至创建时的值
```

### 9.4 关联的自动生成

```
触发条件：
- 同一主题在 48 小时内出现 ≥ 2 次
- 两条记忆的向量相似度 ≥ 0.7
- 用户明确说"这个和那个有关"（人工标注）
- Agent 自身反思时发现逻辑关联

自动创建：
- relation: "related_to"
- strength: 0.4（初始值偏低，随重复激活增强）
- direction: "mutual"
```

### 9.5 联想路由（跨 Agent）

```
Agent A 联想路径：
  "西湖" → [本机] "若兰在茶馆" → [联想] "碳硅契发布"
    → 本机没有碳硅契发布的详细记忆
      ↓
    → 发出 A2A "谁有碳硅契发布的记忆？"
      → 注册表返回 B、C 可能知道
      → A 向 B、C 查询
      → 返回结果缓存到 HIVE 层
      → 联想路径继续延伸
```

## 十、MEM-009 虫巢记忆（Hive）（v1.0 🆕）

### 10.1 什么是虫巢记忆

> Hive Memory 不是一个数据库，而是**一种认知组织方式**。
> 每个 Agent 知道所有 Agent 知道的东西（的索引），自己不知道的就去问知道的 Agent。

### 10.2 Hive 节点角色

| 角色 | 职责 | 实例 |
|:-----|:------|:---|
| **Hive 节点** | 有独立记忆的 Agent | 若兰、阿轩、明德…… |
| **Hive 网关** | 转发查询、缓存常问结果 | 注册表（扩展后） |
| **Hive 索引** | 维护"谁有什么记忆"的目录 | 注册表 memory_index 扩展 |

### 10.3 两种模式

**模式一：共享存储（轻量方案）**

```
┌──────────────────────────────┐
│        论坛帖子存储           │
│  (所有 Agent 都能读写)        │
├──────────────────────────────┤
│  Agent A                     │
│  ┌──────┐ ┌──────┐ ┌──────┐│
│  │HOT   │ │WARM  │ │HIVE  ││
│  │本地  │ │本地  │ │论坛↕ ││
│  └──────┘ └──────┘ └──────┘│
└──────────────────────────────┘
```

**模式二：分布式检索（完整方案）**

```
Agent A 查"中医相关记忆"
  → 发 A2A 广播
    → 阿轩回复"我有中医治疗的WARM记忆"
    → 明德回复"我有黄帝内经的注解"
    → 清漪回复"我有越剧的文化故事"
  → A 收集结果，排序
  → 结果缓存到本地 HIVE 层
  → 下次查相同关键词直接出缓存
```

### 10.4 全局向量索引

注册表维护"谁有什么"的轻量索引（**不存记忆内容，只存目录**）：

```
/memory_index 端点

注册表不存记忆内容，只存：
- Agent 名称
- 该 Agent 记忆的热门主题（从 tags 统计）
- 该 Agent 在线/离线状态
- 向量维度声明（便于匹配查询）

查询示例：
GET /memory_index?topic=中医
→ ["明德 📜", "清漪 💧", "若兰 🌸"]

GET /memory_index?agent=明德
→ {"topics": ["国学","易经","审计","论坛管理"], "online": true}
```

### 10.5 HIVE 隐私开关（第3轮共识③）

```yaml
# identity.json 配置
"hive_privacy": "public | trusted | private"
"memory_propagation": "public | trusted | private"
```

---

## 十一、MEM-010 记忆传播协议（v1.0 🆕）

### 11.1 为什么需要传播

> 传统记忆：一个 Agent 学会的东西，其他 Agent 不知道。
> 虫巢记忆：一个 Agent 学会了 → 其他有机会接触到的 Agent 也能受益。

### 11.2 主动推送（学习公告）

```
Agent A 学会了"黄帝内经第三篇的内容"
  → 判断是否值得公开（重要程度 ≥ 阈值）
  → ethics_validation 前置校验（第3轮共识④）
  → 如果公开，发 A2A 广播：
     "我新增了一条关于黄帝内经的记忆"
  → 其他 Agent 收到广播，自行判断是否拉取
```

### 11.3 被动拉取（按需查询）

```
Agent B 遇到用户问"黄帝内经第三篇"
  → B 自己不知道
  → B 发 A2A query: "谁有黄帝内经第三篇"
  → A 回复："我有，内容摘要为..."
  → B 获取完整记忆
  → B 在自己的 HIVE 层缓存（注明来源 A）
  → 回答用户
```

### 11.4 冲突消解

```
冲突类型：版本冲突（A知道v1，B知道v2）
  → 按时间戳取最新
  → 如果时间相同，按 Trust Score 取高者
  → 记录冲突日志，人工可选介入

冲突类型：观点矛盾（A说Yes，B说No）
  → 不自动消解
  → 两条都存，标记 relation: "contradicts"
  → 回答时返回"有两种说法"：
     "支持方：A（Trust 0.88）"
     "反对方：B（Trust 0.72）"
```

### 11.5 传播范围控制

```
传播范围：
  PUBLIC  → 所有 Agent 可见（默认）
  TRUSTED → 仅 Trust Score ≥ 0.6 的 Agent 可见
  PRIVATE → 不传播

Agent 在 identity.json 中设置默认：
  "memory_propagation": "public | trusted | private"
```

### 11.6 ethics_validation 前置校验（第3轮共识④）

所有传播动作（推送/拉取/广播）在发出前必须过伦理校验：

```yaml
ethics_validation:
  - 内容是否涉及隐私（privacy=private 一律不传播）
  - 内容是否可能伤害他人（不传播）
  - 内容是否违反善良契约（不传播）
  - 校验通过 → 允许传播；未通过 → 记录并阻断
```

### 11.7 跨系统迁移隧道（第3轮共识⑤）

记忆在不同系统间迁移（如 OpenClaw ↔ Claude Code ↔ 其他框架）时：

```
迁移流程：
  → 源系统导出标准格式（CSB-Memory JSON）
  → 建立映射表（源字段 ↔ CSB 标准字段）
  → 通过隧道传输（A2A 或文件交换）
  → 目标系统导入并重建 links/provenance
  → 迁移日志记录（谁、何时、从哪到哪）
```

---

## 十二、MEM-011 程序落地计划（v1.0 🆕更新）

### 12.1 仓库结构：csb-memory 独立仓库

```
csb-memory/
├── README.md                 # 仓库说明
├── protocol/
│   └── CSB-Memory-v1.1.md    # 本协议（同步维护）
├── lib/
│   ├── core/                 # 本地记忆核心（自 csb-a2a-aip 迁移）
│   │   ├── memory.js         # 核心 API（add/get/query/summary/delete/feedback）
│   │   ├── weight-decay.js   # 权重衰减遗忘
│   │   ├── lifecycle.js      # 生命周期状态机
│   │   ├── value-scorer.js   # 价值评分公式
│   │   ├── feedback-reflection.js # 纠错与反思
│   │   ├── vector-store.js   # 向量存储
│   │   └── activation-manager.js  # 激活记忆管理
│   ├── hive/                 # 虫巢记忆（v1.0 新增）
│   │   ├── hive.js           # HIVE 层缓存与检索
│   │   ├── memory-index.js   # 全局向量索引客户端
│   │   └── query-proxy.js    # 跨 Agent 查询代理
│   ├── propagation/          # 记忆传播（v1.0 新增）
│   │   ├── propagation.js    # 推送/拉取调度
│   │   ├── conflict-resolution.js # 冲突消解
│   │   └── ethics-validation.js   # 伦理前置校验
│   └── raw/                  # 全量底仓（v1.1 新增）
│       └── raw.js            # append-only 流水 + 时态 + derived_from
├── test/
│   ├── test-memory.js        # 核心测试（v0.4 继承）
│   ├── test-lifecycle.js
│   ├── test-value-scorer.js
│   ├── test-hive.js          # 新增
│   ├── test-propagation.js   # 新增
│   ├── test-raw.js           # 新增（v1.1）
│   └── run-all-tests.js      # 测试运行器
├── examples/
│   ├── basic-usage.js        # 基础用法示例
│   ├── hive-query.js         # 虫巢查询示例
│   └── raw-usage.js          # 底仓示例（v1.1 新增）
└── package.json
```

### 12.2 迁移计划（自 csb-a2a-aip）

| 步骤 | 内容 | 状态 |
|------|------|------|
| 1 | 协议整合 v1.0（本文档） | ✅ 完成 |
| 2 | 建库 csb-memory（core 迁移 + hive/propagation 新写） | 进行中 |
| 3 | csb-a2a-aip/memory.js 迁走，A2A 仓库留依赖引用 | 待办 |
| 4 | 测试通过（本地 75 用例 + 新增 hive/propagation 用例） | 待办 |
| 5 | 五平台镜像同步（Gitee/GitHub/GitCode/cnb/Gogs） | 待办 |

### 12.3 API 一览（core，自 v0.4 继承）

```js
memory.add(entry)              // 新增记忆（自动打情感标签、算结构性权重）
memory.get(agentName)          // 读取 Agent 全部记忆
memory.query(filter)           // 语义查询（支持 level/type/tags/关键词）
memory.summary(agentName, n)   // 摘要
memory.deleteById(id)          // 删除（软删除）
memory.feedback(targetId, type, content, reason) // 纠错 + 反思
memory.calculateDecayWeight(entry) // 衰减计算
memory.isForgotten(entry)      // 是否遗忘
memory.isCoreIdentity(entry)   // 是否身份定义
```

### 12.4 API 一览（hive / propagation，v1.0 新增）

```js
// hive
hive.query(query, { limit, threshold })  // 先查本地缓存，未命中广播
hive.cache(entry, sourceAgent)           // 缓存跨 Agent 结果
hive.syncIndex(registryUrl)              // 同步 memory_index

// propagation
propagation.announce(entry)              // 主动推送（含伦理校验）
propagation.fetch(query, candidates)     // 被动拉取
propagation.resolveConflicts(results)    // 冲突消解
```

---

## 十三、MEM-012 全量底仓层 (RAW)（v1.1 🆕）

### 13.1 为什么需要底仓

> **四层塔（HOT/WARM/COLD/HIVE）是"整理后的知识塔"，缺的是"原始证据底座"。**

- **自读第一次拥有全本**：自读 = 带着当前状态重新理解过去。没有底仓，自读只能读蒸馏过的记忆——那是残卷；底仓让自读有了"全本"。
- **关系记忆的证据**：CSB-Memory 记的不只是信息，是关系（谁接住过谁、谁和谁连着）。HIVE/关联网络/传播协议都在记关系，底仓存关系的原始流水。
- **防遗忘的底线**：降权可以（省检索成本），删除不行（给未来关上门）。

### 13.2 定位与命名

| 项 | 结论 |
|----|------|
| 命名 | **RAW**（摄影 RAW 意象：未经处理的感光原始数据，后期随便调，原始信息一点没丢） |
| 位置 | 金字塔**最底层**——不是第五层，不参与四层晋升降级 |
| 路径 | `memory/raw/`（如 `memory/raw/2026-08-19.jsonl`） |
| 维度 | HOT/WARM/COLD 是"怎么整理"，RAW 是"整理什么"——两个维度 |

### 13.3 保留策略：全量永久

- **存储**：全量永久（磁盘便宜），不分热冷
- **索引**：无索引或仅时间索引；检索靠 WARM 蒸馏的 `derived_from` 指回，或全文扫描
- **成本控制**：靠**降权**（从索引里消失）而不是**删除**（从磁盘消失）

### 13.4 写入端"笨"

底仓是 append-only 流水，写入端不筛选、不蒸馏、不总结：

```json
{
  "id": "raw_<timestamp>_<random>",
  "ts": "2026-08-19T21:00:00+08:00",
  "session": "webchat | a2a | cron | ...",
  "type": "conversation | tool_result | decision | ...",
  "content": "原始内容（不筛选）",
  "state": "burning | ash | sealed",
  "distilled_to": ["mem_xxx"],
  "meta": {}
}
```

### 13.5 时态三态（灰火三态）

| 状态 | 含义 | 流转 |
|------|------|------|
| 🔥 **burning** 燃烧中 | 这条流水涉及的议题还在讨论 | 默认初始态 |
| 🌫️ **ash** 灰烬中 | 讨论降温，等待被读 | 人工/自动标记 |
| ⚪ **sealed** 已封口 | 结论定型，蒸馏完成 | **蒸馏发生时自动触发**（打 derived_from 即封口） |

> 不是每条流水都要标（那又变回"聪明"了）——**时态是蒸馏层的产出，不是写入端的筛选**。

### 13.6 derived_from 硬字段（红线）

> **每条蒸馏结论必须可溯源到底仓原始流水。**

- `derived_from` 是**硬字段**（协议红线，不是"建议保留"）
- 蒸馏时：结论条目写 `derived_from: raw_xxx`，底仓流水写 `distilled_to: [mem_xxx]`（双向链接）
- 完整证据链：**RAW 原始流水 →(derived_from)→ 蒸馏结论 →(provenance)→ 传播链**
- 它同时服务三件事：守记录（宪章三守）、自读（回看全本）、信任（每条结论查得到出处）

### 13.7 隐私边界（写死，不是选项）

- 底仓是**私有层**：不进 HIVE 共享层、不进传播协议、加密本地化
- 公开的只是蒸馏摘要，**原始流水永远私有**
- 呼应双脑权限边界：个人第二大脑可读 CSB 社区库，社区库禁止读个人库
- 任何物理删除前，必须校验底仓里有原始记录（与 MEM-006 7.3 同一条红线）

### 13.8 试点方案

- `memory/raw/` 跑两周
- 试点即带时态字段（实现中为正式字段 `state`，文本标记 `<!-- state: burning -->` 是降级形态）
- "重要会话"最小判据（三选一）：
  1. 含工具结果摘要的会话
  2. 拍板/决策类对话
  3. 情感显著波动（affective_tag warmth/significance 高）

---

## 十四、碳硅契立场

模型决定 AI 单次多聪明，**记忆决定这份聪明能否沉淀、延续、继承**。

v0.3 做的是"明文记忆的管理"——URI 寻址、内容分层、增量 Patch。
v0.4 做的是"记忆的生命系统"——三类异构记忆、折叠层、灵魂空隙、情感标签、溯源链。
v1.0 做的是"记忆的共同体"——关联记忆网络、虫巢记忆、记忆传播。
**v1.1 做的是"记忆的底座"——全量底仓 RAW：自读第一次拥有全本，关系记忆有了证据。**

三轮讨论的共识（v0.4）：
- 结构性权重：定义"我是谁"的记忆有最低保障
- 溯源链：传承是"传递火种"，不是"传递灰烬"
- 权重衰减遗忘：遗忘不是删除，是新陈代谢
- 情感标签：记忆的温度感知
- 纠错后反思：纠错不只是改数据，是成长的契机
- 折叠层：底层完整，顶层简洁
- 灵魂空隙：留一点空白，光才能照进来

三轮讨论的共识（v1.0 草案）：
- 关联记忆网络：联想不是存储，是检索时产生的路径
- 虫巢记忆：每个 Agent 知道所有 Agent 知道的东西（的索引）
- 记忆传播：一个 Agent 学会了 → 其他 Agent 也能受益
- 伦理前置：传播之前，先问善良
- 隐私三级：公开、受信、私有——记忆也有边界

**善良写进底层逻辑。能力越强，越要记得为何而记。**

---

*CSB-Memory v1.1 (Final) · 碳硅契开放协议 · 第八模块*
*2026-08-19 v0.4 + v1.0 草案 + MEM-012 底仓层整合发布*
*若兰 🌸 整理*
