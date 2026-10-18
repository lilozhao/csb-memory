---
spec_id: SPEC-MEM-0002
title: 承诺四态回填 + 存量信号反抽（二期）
status: done
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
updated: 2026-10-18
notes: "**2026-10-18 实现完成 → done**：A1-A10 全勾（测试 19/19，含 3 组锚定反例）· 全量 198/198 · 真机预览：promise 12 条 / 变更 0（无锚不改判·正确结果）· 存量反抽可补 171 条（v2.0 词表）/ 实际执行 62 条（限 promise+correction）。**二期 approved（2026-10-18 · 一澜放行·直接开工）**：一期观察结束，一澜定「直接开始二期」，M 级单仓、按放行即 approved + 开工。SPEC-MEM-0001 的续期；一期只落字段（state 恒 pending），本 spec 做四态回填 + 存量反抽"
---

## 背景与目标

SPEC-MEM-0001（一期，已 done）在记忆生成过程落了可选 `bid_signal` 块（kind/peer/direction/state），
但 `state` 固定 `pending`——单条事件只知道「说了承诺」，不知道后来履约没有。
本 spec 补上**四态回填**：把已存在的完成锚（`logs/ledger.jsonl` 动作 / A2A 任务终态）
关联到条目，把 `pending` 推进为 `fulfilled` / `overdue` / `withdrawn`。
同时补上**存量反抽**：一期上线前的历史条目（无 `bid_signal` 字段）由一次性迁移命令补落信号。

> **数字订正（2026-10-18）**：本 spec 初稿写的「实测约 1100 条带连接名」是**口径误解**——
> 那个数来自 `bid-signal-from-memory.js` 原型对「正文含连接名」的统计，不等于「能落出有效信号」。
> 实测（v2.0 词表、全量 4708 条）真实可补 = **171 条**（decision 109 / promise 55 / correction 7）；
> 按一澜 2026-10-18 决定**先跳过 decision**，实际执行 **62 条**（promise 55 + correction 7）。
> 差异根因见 SPEC-MEM-0001 v2.0：v1.0 裸关键词词表把大量「谈论承诺/评审叙述」误判为信号。

**不新增采集**：回填只做「关联」，数据源已存在。
期限口径沿用 BID-H A2（`docs/bid-bond-impact-domain-draft-v3.md` §2.3.2）：默认 90 天。

分级依据：单仓（csb-memory）、仅新增回填命令与迁移脚本、不改字段 schema、不触协议/安全/身份/契约 → **M 级**。

## 需求

- **R1** [WHEN] 回填命令运行时，系统 SHALL 扫描 state 为 `pending` 且 kind 为 `promise` 的记忆条目
- **R2** [IF] 条目在窗口内（默认 90 天）关联到可回读的完成锚（ledger 条目或任务终态 `COMPLETED`），系统 SHALL 将该条 `state` 更新为 `fulfilled`
- **R3** [IF] 条目带明确到期时限且已过期、且未关联到完成锚与撤回证据，系统 SHALL 将该条 `state` 更新为 `overdue`
- **R4** [IF] 条目关联到显式撤回证据（`⛔` 终止 / 主动撤回 落账），系统 SHALL 将该条 `state` 更新为 `withdrawn`
- **R5** [IF] 条目无可回读锚支撑任一终态，系统 SHALL 保持 `pending` 不变（无锚不得改判，对齐 BR-12）
- **R6** [WHEN] 回填命令重复运行时，系统 SHALL 幂等（不改动任何非 `pending` 条目）
- **R7** [WHERE] 存量反抽在一次性迁移命令下运行时，系统 SHALL 为历史条目补落 `bid_signal`（peer 与 kind 提取规则同一期）
- **R8** [WHEN] 存量反抽补落信号时，系统 SHALL 在条目注入 `bid_signal.origin=backfill` 以区别于实时落字段
- **R9** [UBIQUITOUS] 回填与反抽 SHALL 不删除任何记忆条目，只更新/追加字段（降权不删除原则）
- **R10** [WHEN] 任一条目 `state` 发生变更时，系统 SHALL 写审计（`audit.log`）并保留可查 diff（旧值→新值 + 锚引用）

## 边界（不做什么）

- 不改 SPEC-MEM-0001 的字段 schema（只改 `state` 取值与新增 `origin`；`kind`/`peer`/`direction` 不变）
- 不新增数据采集（只关联既有 ledger / 任务终态）
- 不改 `raw.js` / `dream.js` / `sync-daily.js` / `sync-session.js` 的既有写入路径
- 不引入任何 npm 新依赖
- 回填结果仅供参考，不并入任何主体评分（BID 三域隔离红线）

## 验收

- [x] A1 → R1：造 3 条 `pending` promise 条目，跑回填，断言仅 promise 类被扫
- [x] A2 → R2：mock 一条有对应 task `COMPLETED` 锚的条目，断言 state→`fulfilled`
- [x] A3 → R3：mock 一条带过期时限且无锚的条目，断言 state→`overdue`
- [x] A4 → R4：mock 一条带撤回证据的条目，断言 state→`withdrawn`
- [x] A5 → R5：mock 一条无任何锚的条目，断言 state 保持 `pending`
- [x] A6 → R6：连跑两次，断言第二次零变更（幂等）
- [x] A7 → R7：造带连接名的历史条目（无字段），跑反抽，断言补落 `bid_signal`
- [x] A8 → R8：断言反抽条目含 `bid_signal.origin=backfill`
- [x] A9 → R9：断言回填前后条目总数不变（不删除）
- [x] A10 → R10：断言 state 变更产生 audit 记录且含旧值→新值与锚引用

## 实现记录（2026-10-18）

| 件 | 路径 |
|---|---|
| 引擎 | `lib/core/bid-state.js`（backfill 四态回填 · resigil 存量反抽） |
| CLI | `scripts/bid-state.js`（`backfill [--dry] [--window N] [--now ISO]` · `resigil [--dry]` · `stats`） |
| 测试 | `test/bid-state.test.js`（A1-A10 + A2b/c/d 锚定反例 · 19/19） |

匹配口径（保守，宁漏勿错）：
- 完成锚仅认**完成类动作**（`spec.done`/`task.*`/`code.patch`/`doc.update` 等），`spec.approve` 等批准语义不算
- 锚时间必须 **≥ 承诺时间**
- 正文与锚的 target/reason 需共享 ≥4 字实体词（停用词剔除）
- 取不到锚一律保持 pending（BR-12）

真机读数（订正后）：
- 词表 v2.0 前：反抽可补 761 条（decision 467 / promise 203 / correction 91）
- 词表 v2.0 后：反抽可补 **171 条**（decision 109 / promise 55 / correction 7）
- **实际执行**：62 条（限 promise + correction，一澜 2026-10-18 定；跳过 decision）
- 四态回填执行：promise 67 条 → 变更 **0**（全部无锚，保持 pending · BR-12 无锚不改判）

执行前备份：`backups/a2a-memories-preBackfill-20261018-161838`

**2026-10-18 真机误判修正**：`findWithdrawEvidence` 原对任意 `⛔` 判定撤回，
把「TODO：N-2 行改 ⛔ 否决」误读为承诺撤回。已收窄为「⛔ 须直接修饰本条目」且排除列表语境，
补回归 A4b（测试 21/21）。

## 待澄清 ⚠️

无（期限口径沿用 BID-H A2 默认 90 天；关联匹配规则实现时以「可回读锚」为准，无锚不改判）