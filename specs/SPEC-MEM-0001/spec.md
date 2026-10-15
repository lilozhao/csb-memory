---
spec_id: SPEC-MEM-0001
title: 记忆条目落 BID 关系信号字段（一期）
status: approved
level: M
version: 1.0
repo: csb-memory
scope: mem
authors: [一澜, 若兰]
agents: [ruolan]
reviewers: [一澜]
base: main
supersedes: null
created: 2026-10-15
updated: 2026-10-15
notes: "一期范围＝只落字段（state 固定 pending），四态回填与存量反抽留二期；需求来源 W-12 BID 概念验证缺口（csb-aep/docs/bid-memory-signal-hook.md）"
---

## 背景与目标

W-12 BID 概念验证（`csb-aep/docs/bid-poc-readout-v1.md`）证伪了「现有落账够用」：
`data/a2a-memories/` 的事件正文里**已含**连接名与承诺/纠错/决策信号（反抽实测 4534 条中 1100 条带连接名），
但生成管线（`lib/core/memory.js#toFrontMatter`）**未把它写成结构化字段**，导致 BID 的
「连接级承诺履约率 / 纠错双向率」无数据可算。

本 spec 补上这一缺口：在记忆生成过程落一个**可选** `bid_signal` front-matter 块，
使 BID 可直接读字段而非事后正则猜（尤其 `direction` 在生成时天然可得，可当场救活"双向率"指标）。

分级依据：单仓（csb-memory）、仅新增可选字段、不触协议/安全/身份/契约、向后兼容 → **M 级**。

**生产者事实核定（2026-10-15）**：`data/a2a-memories/*.md` 这个 YAML 仓由
`core.add()` 写入，调用方＝ `sync-daily.js`（日记）、`sync-session.js`（会话原文）、`dream.js`（蒸馏）。
注：`csb-a2a-aip/a2a-memory.js#processConversation` 写的是**另一个 DB 型仓**（`## 📅` 追加式），
不在本 spec 范围（若要同步覆盖需另开 spec）。

## 需求

- **R1** [WHEN] 记忆条目正文命中 BID 信号词表（承诺 / 纠错 / 决策三类之一）时，系统 SHALL 在该条 front-matter 写入 `bid_signal` 块（含 `kind` / `peer` / `direction` / `state` 四字段）
- **R2** [WHERE] 记忆条目由生产者（`sync-daily.js` / `sync-session.js` / `dream.js`，均经 `core.add`）写入时，`bid_signal.peer` SHALL 优先取调用方显式传入的 `peer`
- **R3** [IF] 调用方未传 `peer` 时，`bid_signal.peer` SHALL 从条目 `tags` 或正文提取连接名
- **R4** [IF] `tags` 与正文均提取不到连接名时，`bid_signal.peer` SHALL 取 `null`
- **R5** [WHEN] 信号为纠错且方向可判时，`bid_signal.direction` SHALL 取 `out`（我方发出更正）或 `in`（对方更正我方）
- **R6** [UBIQUITOUS] 一期 `bid_signal.state` SHALL 固定为 `pending`（承诺四态回填留待二期）
- **R7** [IF] 条目未命中任何 BID 信号词，系统 SHALL 不写入 `bid_signal` 字段
- **R8** [WHERE] 读取既有无 `bid_signal` 字段的条目时，系统 SHALL 不报错
- **R9** [WHEN] 写入 `bid_signal` 时，系统 SHALL 复用 `toFrontMatter` 现有可选字段模式（`if (entry.x) fields.push(...)`），且不得改变其余字段的相对顺序与语义

## 边界（不做什么）

- 不改 `raw.js` / `dream.js` / `health-check.js` 三脚本行为
- 不引入任何 npm 新依赖
- 一期不做四态回填（不关联 ledger / 任务终态），不一次性反抽存量 1100 条
- 不改动 A2A 消息协议、身份链、委托逻辑与安全边界
- 不改变现有词表语义（与 `sync-daily.js#IMPORTANT_PATTERNS` 共用，避免第三张表漂移）

## 验收

- [ ] A1 → R1：`node test/bid-signal.test.js` 断言三类信号词各命中一条，front-matter 含 `bid_signal` 块
- [ ] A2 → R2：调 `core.add({peer:'阿轩',content:'…更正…'})`，断言 front-matter 的 `peer` 等于 `'阿轩'`
- [ ] A3 → R3：条目含连接名（在 tags 与正文各一），断言 `peer` 取到该名
- [ ] A4 → R4：mock 无连接名的条目，断言 `peer` 为 `null`
- [ ] A5 → R5：mock 我方更正与对方更正各一条，断言 `direction` 分别 `out` / `in`
- [ ] A6 → R6：断言一期写入的 `state` 恒为 `pending`
- [ ] A7 → R7：mock 无信号条目，断言无 `bid_signal` 字段
- [ ] A8 → R8：对存量无字段条目 `get()` 不抛错
- [ ] A9 → R9：回归断言既有字段（id/type/timestamp/...）在带与不带 `bid_signal` 两种情况下一致
- [ ] A10 → 背景：`README.md` 与架构文档随提交同步（代码与文档同步规则）

## 待澄清 ⚠️

无（Q1「词表是否与反抽原型同源」已由一澜 2026-10-15 12:04 确认：同源；实现时抽为共享常量 `lib/core/bid-signal.js`）