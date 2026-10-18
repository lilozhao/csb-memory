---
spec_id: SPEC-MEM-0001
title: 记忆条目落 BID 关系信号字段（一期）
status: approved
level: M
version: 2.0
repo: csb-memory
scope: mem
authors: [一澜, 若兰]
agents: [ruolan]
reviewers: [一澜]
base: main
supersedes: null
created: 2026-10-15
updated: 2026-10-18
notes: "v2.0 词表精修（2026-10-18 · 观察期实证驱动）：T+3 读数证伪 v1.0 词表——decision 483 条占 61%（确认/同意/共识 命中评审过程叙述）· promise 215 条大量为讨论或引用承诺 · correction 92 条含修正误判。v2.0 加强精度：三类信号均要求主体加动作而非裸关键词，并引入语境否定（无承诺/非承诺）。v1.0 原范围＝只落字段（state 固定 pending），四态回填与存量反抽留二期 SPEC-MEM-0002"
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

## v2.0 修订动因（2026-10-18）

一期上线后按 `csb-aep/scripts/bid-signal-quality.js` 观察，T+3 读数：

| 指标 | v1.0 实测 | 判定 |
|---|---|---|
| decision 条数 | 483 / 全量 4708（61%） | 🚨 `确认`/`同意`/`共识` 命中大量「评审过程叙述」，非决策 |
| promise 条数 | 215 | 🚨 多为「讨论承诺」「承诺履约率」「只读承诺」等**谈论**信号 |
| correction 条数 | 92 | 🚨 `修正` 命中「`spec-lint` 0 违规」类技术叙述 |
| direction | 29/29 全 null | 方向线索过窄，实际不可用 |
| 四态回填 | 命中锚 0 / 12 | 🚨 主语料是讨论记录，真正的承诺无锚可对 |

根因：v1.0 词表是**裸关键词 OR 匹配**，没有要求「谁 + 做什么」的结构。
一条记忆提到「一澜批准」不等于这条记忆本身是个决策。

## 需求

- **R1** [WHEN] 记忆条目正文命中 BID 信号词表（承诺 / 纠错 / 决策三类之一）时，系统 SHALL 在该条 front-matter 写入 `bid_signal` 块（含 `kind` / `peer` / `direction` / `state` 四字段）
- **R10** [IF] 正文命中信号词但该词处于**谈论语境**（其前后 8 字内出现「讨论 / 提到 / 关于 / 关于是否 / 判断 / 观测 / 统计 / 率 / 多少次」等元话语标记）时，系统 SHALL **不**判为该类信号
- **R11** [IF] 正文命中信号词但该词处于**否定语境**（其前后 6 字内出现「无 / 非 / 未 / 不 / 没有 / 不存在」等否定词）时，系统 SHALL **不**判为该类信号
- **R12** [IF] 同一正文同时命中多类信号，系统 SHALL 按「纠错 > 承诺 > 决策」优先级取唯一 `kind`（不自相矛盾）
- **R13** [WHEN] 判定 `decision` 时，系统 SHALL 要求正文含**决策动词 + 决策对象/结论**结构（如「决定采用 X」「一澜批准 Y」），而非裸现「确认/同意/共识」
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
- 不改变 `sync-daily.js#IMPORTANT_PATTERNS` 的既有行为（该表服务于日记重点提取，语义不同；v2.0 后两者**不再声称同源**）
- v2.0 **不重判存量条目**（存量反抽属 SPEC-MEM-0002 · R7/R8 范畴）

## 验收

- [x] A1 → R1：`node test/bid-signal.test.js` 断言三类信号词各命中一条，front-matter 含 `bid_signal` 块
- [x] A2 → R2：调 `core.add({peer:'阿轩',content:'…更正…'})`，断言 front-matter 的 `peer` 等于 `'阿轩'`
- [x] A3 → R3：条目含连接名（在 tags 与正文各一），断言 `peer` 取到该名
- [x] A4 → R4：mock 无连接名的条目，断言 `peer` 为 `null`
- [x] A5 → R5：mock 我方更正与对方更正各一条，断言 `direction` 分别 `out` / `in`
- [x] A6 → R6：断言一期写入的 `state` 恒为 `pending`
- [x] A7 → R7：mock 无信号条目，断言无 `bid_signal` 字段
- [x] A8 → R8：对存量无字段条目 `get()` 不抛错
- [x] A9 → R9：回归断言既有字段（id/type/timestamp/...）在带与不带 `bid_signal` 两种情况下一致
- [x] A10 → 背景：`README.md` 与架构文档随提交同步（代码与文档同步规则）

**v2.0 新增验收（精度）· 2026-10-18 全绿**

| 指标 | v1.0 | v2.0 | 变化 |
|---|---|---|---|
| decision | 483 (61%) | 109 | **-77%** |
| promise | 215 | 56 | **-74%** |
| correction | 92 | 7 | **-92%** |

测试：`test/bid-signal.test.js` **19/19**（A1–A10 回归 + A11–A18 精度）· 全量回归 **206/206**。

- [x] A11 → R10：正文「讨论一下承诺履约率怎么算」→ 断言**不落** promise
- [x] A12 → R10：正文「关于是否同意该方案，还需再看」→ 断言**不落** decision
- [x] A13 → R11：正文「本轮非承诺，只做可行性评估」→ 断言**不落** promise
- [x] A14 → R11：正文「没有决定，先收集意见」→ 断言**不落** decision
- [x] A15 → R12：正文同时含纠错与承诺表述 → 断言 `kind` 唯一且为 `correction`
- [x] A16 → R13：正文「确认」类评审叙述（「5×✅A 同意定稿」）→ 断言**不落** decision
- [x] A17 → R13：正文「一澜批准 SPEC-MEM-0002」→ 断言**落** decision
- [x] A18 → 回归：v1.0 的 A1–A10 全部仍通过（词表精修不得破坏既有合格用例）

## 待澄清 ⚠️

无（Q1「词表是否与反抽原型同源」已由一澜 2026-10-15 12:04 确认：同源；实现时抽为共享常量 `lib/core/bid-signal.js`）