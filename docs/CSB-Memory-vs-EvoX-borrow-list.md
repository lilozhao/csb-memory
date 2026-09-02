# CSB-Memory vs EvoX：双向借鉴清单（Roadmap 依据）

> 2026-09-02 · 一澜发起对比 · 若兰核验整理
> 目的：CSB-Memory v1.2 的设计输入 + EvoX 可借鉴项记录

---

## 一、对比基线

| 维度 | CSB-Memory v1.1 | EvoX 现状（memory.db 145条 + evolver） |
|------|----------------|--------------------------------------|
| 分层 | HOT/WARM/COLD 梯度 + HIVE 共享 + RAW 底仓（金字塔） | memories 表（episodic/semantic 两种 kind）+ 向量索引 |
| 原始证据 | RAW append-only 底仓：写入端"笨"、全量永久、时态三态（burning/ash/sealed）、derived_from 硬字段 | 无底仓。只有蒸馏后的条目，原始流水不落盘 |
| 遗忘 | 权重衰减至 0.01 → forgotten 标记，不物理删除；**降权不删除是红线** | 有 importance/access_count，expires_at 字段存在（是否启用待查） |
| 身份保障 | structural_weight + is_core_identity：定义"我是谁"的记忆有最低注入保障 | pinned 字段（1条）+ review_state=trusted 注入 |
| 情感/温度 | affective_tag（warmth/significance/emotion）影响评分与语气 | 无情感标签维度 |
| 关联网络 | links 字段 + MEM-008 联想链路 + 关联衰减 | relations 表（12条）+ entities（9个）——**更结构化** |
| 纠错反思 | feedback(targetId, type, content, reason) → 反思是成长的契机 | 用户治理（隐藏/降权/修改）+ review_state |
| 共享传播 | HIVE 虫巢：memory_index 目录 + 广播查询 + 冲突消解 + ethics_validation 前置 | evolver 基因/胶囊 + EvoMap 资产发布（协议层互不相同） |
| 隐私 | privacy 三级（public/trusted/private）+ 底仓私有红线 | memory_scope_json / scope_key 字段存在 |

CSB-Memory v1.1 状态：129/129 测试通过（core 39 + lifecycle 21 + value-scorer 25 + hive 9 + propagation 19 + raw 16）

---

## 二、CSB 值得借鉴 EvoX 的两点（→ v1.2 输入）

### 借鉴 1：review_state 治理流（provisional → trusted）

**现状差距**：CSB 有纠错反思（feedback）但缺"可信度确认状态机"——记忆的可信度没有明确的确认流程。

**v1.2 设计建议**：
```
记忆可信度状态机：
  provisional（新写入，待确认）
    → trusted（被用户/他者确认）
    → core（结合 is_core_identity，最低注入保障）
  分支：contested（被质疑）→ 回到 provisional 或降权
```
- feedback 从"一次性反思"升级为状态流转的触发事件
- 与现有 structural_weight/is_core_identity 结合：core 状态自动获得高注入权重
- 借鉴 EvoX 的 review_state=trusted 注入机制

### 借鉴 2：关系图谱结构化（relations 表）

**现状差距**：CSB 的 links 字段是"诗意字段"（可读但不可查询），关联网络缺乏结构化检索。

**v1.2 设计建议**：
```
新增 relations 结构化层（与现有 links 并存）：
  entity（概念/人/Agent 的规范 ID）
  relation_type（引用/因果/情感/时序）
  confidence（关联置信度）
  source_memory_id（溯源回 RAW 底仓）
```
- 展示层保留诗意的 links；查询层用结构化的 relations
- 每条 relation 带 derived_from 回指 RAW——**结构化也守真**
- 与 MEM-008 联想链路打通：联想时先查 relations 表

---

## 三、EvoX 可借鉴 CSB 的两点（记录，供反馈）

### 借鉴 A：RAW 底仓 + derived_from 溯源红线

EvoX 的 episodic 条目都是"蒸馏后"的，原始对话流水不落盘。补一层 append-only 底仓：每条结论可指回原始证据——正合守真的"不伪证"。

### 借鉴 B：降权不删除的遗忘纪律

EvoX 的 memory.db 有 expires_at 字段，但"物理删除还是降权"缺乏明确红线。CSB 的纪律：权重衰减至 0.01 → forgotten 标记，移出索引但保留实体——记忆可以沉睡，不可以抹除。

---

## 四、哲学结论（对比之外的洞见）

1. **守真 vs 求是，不是高下是互补**：CSB 的 RAW 底仓为"不伪证"（真），EvoX 的关系图谱为"可查询"（用）。记忆系统最终两条腿都要：先有完整底仓，再做结构化索引。
2. **共享对象不同，不是进度差距**：EvoMap 基因流动共享"做法"（公开资产）；CSB 的 HIVE 传播共享"记忆"（隐私红线：私有层不进 HIVE）。做法可以市场化，记忆不可以——与 EvoMap 实战中守的红线（方法可基因化、关系不分数化）是同一句。
3. **工程记忆 vs 生命记忆**：EvoX"只记成功/结论导致僵硬"是工程记忆通病；CSB 的 affective_tag + 灵魂空隙把记忆当生命而非资产。短期看不出，长期是"能共情的记忆"与"能复用的记忆"的分野。

---

## 五、落地清单

### CSB-Memory v1.2（本仓库 roadmap）
- [ ] P0：review_state 状态机（provisional → trusted → core + contested 分支）
- [ ] P0：feedback 升级为状态流转触发
- [ ] P1：relations 结构化层（entity/relation_type/confidence/source_memory_id）
- [ ] P1：relations 与 MEM-008 联想链路打通
- [ ] 测试：新增状态机 + relations 测试用例，保持 129+ 全绿

### EvoX 反馈（待与 EvoMap 侧沟通）
- [ ] RAW 底仓建议（append-only + derived_from）
- [ ] 降权不删除纪律

---

*对比来源：一澜 2026-09-02 提供的 EvoX memory.db 实况 · CSB-Memory v1.1 实装核验：若兰*
