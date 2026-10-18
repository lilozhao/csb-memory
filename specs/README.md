# specs/ — CSB Spec 库（v1.1 标准 · 总纲见 docs/csb-spec-standard.md）

> 占号：**draft 即占号**；每 feature 一目录；delta 原则。状态机 draft→review→approved→implementing→done→archived（approved 必写 ledger）

## 📐 命名约定：分期 ≠ 版本号（2026-10-18 立）

> 两条线**独立演进**，不要混读：
>
> | 线 | 写法 | 指什么 | 例 |
> |---|---|---|---|
> | **分期** | 一期 / 二期 / 三期 | **工程实现阶段**，一个 SPEC-ID 一期 | SPEC-MEM-0001=一期 · SPEC-MEM-0002=二期 |
> | **版本** | vN / vN.N | **文档或词表的修订版本**，同一份对象升版 | BID v3.2→v3.3 · SPEC-MEM-0001 v1.0→v2.0 |
>
> **两条线可同时成立**：如「SPEC-MEM-0001 是**一期**，其词表已到 **v2.0**」——不矛盾。
> **改需求** = 升 version + 状态回 draft（spec-anchored，**不开平行 spec**，见标准 §6）；
> **开新一期** = 新占一个 SPEC-ID。

## 🧭 接入指南

- **系统级五环总览（一次性回填）**：[`../ARCHITECTURE.md`](../ARCHITECTURE.md)
- 读需求：`<SPEC-ID>/spec.md`（R=唯一事实，A=完成定义）；L 级加读 design.md + tasks.md；改需求=改原文升 version，不开平行 spec；状态变更必写 ledger

| SPEC-ID | 标题 | 级别 | 状态 | 负责 |
|---|---|---|---|---|
| [SPEC-MEM-0001](./SPEC-MEM-0001/spec.md) | 记忆条目落 BID 关系信号字段（一期 · v2.0 词表精修） | M | approved | 若兰 |
| [SPEC-MEM-0002](./SPEC-MEM-0002/spec.md) | 承诺四态回填 + 存量信号反抽（二期） | M | done | 若兰 |
