# CHANGELOG · csb-memory

> 补录说明（2026-11-04）：本仓此前**没有 CHANGELOG**，VERSION 已到 `1.5.0` 而 README 版本表最高只写到 v1.3.0。
> 本文件由 git log 倒推补录，**只记录可追溯到具体提交的事实**；不确定的一律不写。
> 版本载体：`VERSION` / `package.json` / 本文件三处必须咬合（沿用 csb-a2a-aip v5.3.12 定的「版本号单一事实源」）。

---

## v1.7.0（2026-11-12）— 三个三打卡随仓分发（C3 记忆的消费端）

**背景**：按 `projects/csb-harness-selfreflection-map/csb-selfreflection-map-v1.md` §3，
三个三打卡（改进账 / 记忆做梦 / 三个三打卡 三件套之一）归 **C3 记忆**，不新建仓库。
此前实现只存在于若兰本机 `skills/excellence-daily/`，其他 Agent 拿不到 —— 本次随仓分发，
**升级 csb-memory 版本即可装机**，不再走传压缩包。

**新增**：

| 路径 | 内容 |
|---|---|
| `skills/excellence-daily/` | 分发包（自包含）：`SKILL.md` + `INSTALL.md` + `bin/{checkin,streak,selfcheck}.js` + `lib/experience.js` |
| `scripts/excellence-checkin.js` | 打卡入口：校验 → 写 EXPERIENCE → 渲染 md → 更新 streak |
| `scripts/excellence-streak.js` | 累计天数（`--status` / `--mark`，幂等） |
| `test/test-skill-parity.js` | 分发包与仓库运行版**逐字相同**的机械校验（防漂移） |

**关键变更**：

| 项 | 内容 |
|---|---|
| `DATA_ROOT` | 由写死 `__dirname/../../..` 改为**向上探测** ws 根（`EXCELLENCE_DATA_ROOT` 可覆盖）· 同一份代码在 `skills/excellence-daily/{bin,lib}` 与 `csb-memory/{scripts,lib}` 两处层数不同，写死必有一处错 |
| 多租户 | `EXCELLENCE_AGENT` → `memory/excellence/<slug>/` 与 `data/experience/<slug>/`；不设则路径与旧版逐字相同（现有数据不搬） |
| streak 起点 | 修硬编码 `2026-11-09`（那是若兰自己的起点）→ 默认首次运行当天；回溯用 `EXCELLENCE_START_DATE` |
| 篇幅上限 | 打分附注 ≤80 字 · 一功/一悟/一善各 ≤100 字 · 今日 3 件每条 ≤60 字，超长 exit 4（不静默截断） |
| `self_assessment` | EXPERIENCE 新增 kind，六维打分缺一项即拒（`MISSING_SCORE`）；仍受 `provenance` 红线约束 —— 无当天证据不入库 |
| 装机自检 | `node skills/excellence-daily/bin/selfcheck.js` → 6/6（独立副本装配 / dry / 正式入库 / streak 起点 / 两条负向） |

**测试**：508/508 全绿（新增 parity 4 项）。

---

## v1.6.0（2026-11-05）— 访问计数写回：把「遗忘」从死代码救活

**提交**：`b542fc3`

**背景**：`query()` 里 `results.forEach(e => updateAccess(e))` **只改内存对象，从不落盘**。
实测 `data/a2a-memories/若兰.md` 6,885 条中 **6,884 条 `access_count: 0`**（另 1 条缺字段）。
后果链：计数永远 0 → `lifecycle.js` 的「30 天未访问→归档」「权重衰减→遗忘」**一条也判不出来**
→ 整个遗忘机制（v0.4 就写好的五态机）**是死的**。
诊断报告：`projects/csb-memory-sleep-dream/memory-sleep-quant-report-v1.md`

**变更**（`lib/core/memory.js`）：

| 项 | 内容 |
|---|---|
| `query()` | 内存对象照旧更新（当次返回值不变），同时把 `(档案, id)` 计入待写回缓冲 |
| `patchAccessCounts()` | **定点行替换**，只改 `access_count` / `last_access` 两行 |
| `flushAccess()` | 原子写（tmp + rename），返回 `{files, entries, missing}` |
| `accessStatus()` | 可观测：还有几条没落盘 |
| flush 时机 | 累计 500 条 / 60 秒 / **进程退出钩子**（三重兜底） |
| 导出 | `flushAccess` / `accessStatus` / `patchAccessCounts` |

**两条硬约束（写进代码注释了）**：
1. **不许整篇重写**：`toFrontMatter()` 只认固定字段，重放会抹掉 `lifecycle_state`/`archived_at` 等扩展字段（实测真实档案里有 2 条）。
   ⇒ 只做定点行替换，其余字节一个不碰。
2. **不许每次 query 都写 4.5MB**：实测读 190ms / 写 6ms ⇒ 攒批 + 退出兜底。

**测试**：`test/test-access-writeback.js` **14/14**，全量 **490/490**（原 476）。

六类断言：
- A1 写回真的落盘（不是只改内存）
- A2 **只改两行**：`lifecycle_state`/`archived_at`/正文全保留；去掉两字段后**全文逐字一致**；字节差量 <200B
- A3 多次 query **累加**（不是覆盖成 1）
- A4 找不到 id 时 `missing` 计数，**不静默**
- A5 **反向自测**：把补丁换成空实现 → 必须变红（已实测「撤掉修复 → 退出码 1；恢复 → 0」）
- A6 flush 后缓冲清空

**真实档案端到端**（2026-11-05 22:12）：
`query({agent:'若兰', type:'lesson', limit:3})` → 3 条 `access_count` 0→1 · 条目数 6885 不变 · `lifecycle_state` 2→2 不变 · **字节数完全不变**。

**⚠️ 诚实边界（必须写清）**：
本修复只让 `query()` 能写回。**但当前生产路径没有调用 `query()`**——
`sync-daily`/`health-check`/`dream` 用的是 `get()`（去重扫描，不算回忆），
而 `memory_search` 走 **qmd 直接索引 .md 文件**，完全绕过 core。
⇒ **计数器现在仍不会被自动更新**。要让计数真正跑起来，还需要第二步：
给「真正的回忆路径」接线（qmd 检索后回写 / 或新增 A2A memory query 端点）。
本版只解决「通路存在且安全」，不宣称「计数已自动工作」。

---

## v1.5.0（2026-10-23）— RFC v2.3 P-15 落码：kind 枚举 B

**提交**：`bb229b5`

**背景**：P-15 征集已决（7 B / 1 A / 1 反方向 / 0 C；回帖 10 CN + 1 EN）。收口帖 CN `1792727965786` / EN `1792727967971`。

**变更**（三个半句各自落点）：

| 半句 | 落点 |
|---|---|
| 默认三类 | `DECLARED_KINDS` 默认空，不装 = 行为与 v2.7 完全一致 |
| 须报出 | `memory.loadDeclaration()`：只从口径声明装，校验不过就不装并计分 |
| 可扩展 | `declared_kinds` + `extended_kinds`，过 P-11 四门 |

**B 的四道准入门槛**（均已落码）：
1. 机读（非散文）：`validateDeclaration` 结构化 reasons
2. 位置约束同强：扩展 kind 的 entries 同样走 P-11 四门
3. 来源分层（清漪）：`extended_kinds.<k>.tier` 必填 `exchange|local-only`
4. 对端可回读锚点（星尘）：`extended_kinds.<k>.anchor` 必填；信号带 `source_tier + anchor`

**纪律（P1 拒绝要计分）**：
- `setDeclaredKinds` 缺 tier/anchor → 拒收并返回结构化 `rejected[]`，**不静默启用**
- `loadDeclaration` 校验失败 → 不装 + 完整 reasons，**绝不静默降级冒充已启用**
- 默认三类不受影响：promise/correction/decision 信号不带 tier 字段（契约不变）

---

## v1.4.0（2026-10-22）— BID 召回侧补丁

**提交**：`3c6cb99`

**背景**：W-21 第二刀。一澜 2026-10-22「直接开工召回测」。P-11 之后 FP 已 0，继续收紧只会更瞎 → 转而做召回。

**四处加法**（每处都能指回一条实测漏报 G-xx）：
- `DECISION_STRICT`：「一澜确认」也是决策（G-07/09/10）；未决的「需要一澜确认」由 PENDING 拦，不靠词形
- `CORRECTION_OPS`：叫错/敲错 + 我…是错 + 回纠身份 + 具名指出（G-01/05/12/18/19）
- `PROMISE_STRICT`：约定类节标题 + 给X回/交付 类点名任务（G-06/14）
- `DIR_OUT`/`DIR_IN`：被动式/自我修复/自我回纠 + 括号内具名指出

**顺带逮到两个真 bug**（不是补词，是修错）：
1. `gatedTest` 护栏锚点取命中起点 → 上个分句的「不是」误伤本分句真纠错。改为取命中尾部（真动作词所在子句）
2. `matchStrict` PENDING 只看前文 → 「需要一澜确认」未决词在主体之前，失配导致误判 decision。改为测「主体+确认」整段 span（B2 测试当场抓到该回归）

**判据**（金标集 v0.3，27 条计分）：
`P 100 · R 88.2 · F1 93.7 · 准确率 92.6 · kind 93.3 · peer 100 · dir 77.8` · 全量测试 **429 全绿**

---

## v1.4.0 同期（2026-10-21 ～ 10-24）之外的版本基建与修复

> 下列提交**不改协议语义**，属版本载体补齐与缺陷修复，单列以免与版本跃迁混淆。

| 日期 | 提交 | 内容 |
|---|---|---|
| 2026-10-24 | `9cf2045` | 补 `VERSION` 文件（统一版本单一事实源）—— 此前本仓无 VERSION 载体 |
| 2026-10-24 | `674af5d` | fix：做梦 0 新增根因 · `get()` 静默丢条目 · W-26 性能 30× · 示例脱敏 |
| 2026-10-24 | `6e4442f` | fix(test)：真实档案回归不再硬编码 agent 名（舟楫实测反馈） |
| 2026-10-26 | `4f6fb55` | docs(readme)：用例数 168→476（周一数字核验 cron 跑真实测试发现漂移） |

---

## 早于 v1.4.0 的版本（README 版本表已记录，此处只留指针）

v1.3.0（2026-10-22，`f71939f`）· v1.2.0（2026-09-05）· v1.1（2026-08-19）· v1.0（2026-08-19）· v0.4（2026-07-31）
→ 详见 `README.md` 版本表。

---

_补录：若兰 🌸 · 2026-11-04 · 依据：git log 逐条 `git show` 核对，未做推测性补写_