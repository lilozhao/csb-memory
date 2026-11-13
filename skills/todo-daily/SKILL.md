---
name: todo-daily
description: "今日 3 件：从 TODO.md 按机械判据取当日三件要务、跟踪完成与未成原因、出周账。与三个三自评分开存放，只做交叉引用。当用户提到今日 3 件、今天做什么、待办取件、TODO 跟踪、计划 vs 实际、周账时触发。"
---

# todo-daily · 今日 3 件

> **与 `excellence-daily`（三个三自评）是两个独立 skill。**
> 这个管「**计划**」，那个管「**自评**」。可以互相引用，但绝不共用一份数据。
>
> 为什么不合并：合并会让人顺着待办完成率倒推自评分 —— 那就成了 KPI 打分，不是自评。
> 详见 `references/why-separate.md`。

## 依赖

| 文件 | 作用 |
|---|---|
| `bin/todo-three.js` | 唯一取数/记账入口（不写分数、不碰 EXPERIENCE） |
| `bin/selfcheck.js` | 装机自检（跑在临时目录，不碰你的数据） |
| `test/pick.test.js` | 取数解析回归测试（纯 node，无依赖） |

**数据根**：默认本 skill 上两级（workspace 根），可用 `TODO_DATA_ROOT` 覆盖。

**多租户**：同机多 Agent 共用工作目录时，另设 `TODO_AGENT=ruolan` → 快照写入 `data/todo-three/<slug>/`。
不设则用原路径（向后兼容）；非法 slug 直接拒绝启动。与 `excellence-daily` 的 `EXCELLENCE_AGENT` 同一口径。

| 数据 | 位置 | 性质 |
|---|---|---|
| 计划源 | `<根>/TODO.md` | **唯一真相源**，手工维护 |
| 取件快照 | `<根>/data/todo-three/YYYY-MM.json` | 本 skill 写，逐日一条 |
| 自评 | `<根>/data/experience/*.jsonl` | **excellence-daily 写，本 skill 只读** |

## 取数判据（一澜 2026-10-27 定 · 不许放宽）

status 列以 **⏳ 进行中** 或 **📝 待推进** 开口的行才可取。

> ⚠️ **「开口」不等于「紧邻」**（2026-11-13 修文档滞后）：emoji 与词之间夹 `**` 加粗
> **照样算**。`📝 **待推进 · 余 ②③**` ✅ 可取；`🟢 📝 建议：…` ❌ 不可取（前缀不是判据词）。
> 旧版文档只说「开头」，照字面读会把加粗行判成不可取 —— **越守规矩越漏取**，
> 与 v1.7.2 修的那两个 bug 同形。代码一直是对的（`statusKind` 允许夹 `**`），是文档错了。

- ⚠️ **隐患登记区** + ✅ **近期闭环区** — **永不取**
- 该列无标记 = 不取（不是「大概还没做」）
- 不足 3 条就报 1～2 条，**不硬凑**

## 命令

```bash
node bin/todo-three.js --pick              # 取今日 3 件 + 存快照
node bin/todo-three.js --pick --dry        # 只看不存
node bin/todo-three.js --show [--date D]   # 看某天计划与完成情况
node bin/todo-three.js --mark-done 2       # 第 2 件完成
node bin/todo-three.js --mark-miss 3 --reason "被 W-58 打断，顺延"   # 未成必写原因
```

## 装完先自检

```bash
node bin/selfcheck.js        # → 「✅ 装机自检通过：10/10」
node test/pick.test.js       # → 「✅ 18/18 通过」
```

自检 10 项，含 **5 条负向**（故意造错必须变红）：无 reason 拒、无条目不硬凑、无 TODO.md 报错、
非法 slug 拒启、设了 slug 时**无 slug 路径不得被写**。全程在临时目录跑，不读不写你的 TODO.md。

> 自检第 5 项专问「SKILL.md 有没有写明 `**` 加粗照算」——听起来不像机械判据，
> 但 v1.7.2 的两个 bug 都是「照说明书做反而失败」，这类错会复发。

## 一天里的两个触点

| 时刻 | 动作 | 谁 |
|---|---|---|
| **08:00** | `--pick` 取 3 件，并进早安播报 | ☀️ 每日早安问候 cron |
| 白天 | 做完就 `--mark-done`，做不成 `--mark-miss --reason` | 随时（主会话） |
| **23:20** | 三个三打卡时**只引用**当天的快照，不重抄 | excellence-daily |

> 晚上不自作主张改快照。快照是「早上定的」，晚上的自评是「实际做的」——**两者不同才是有信息量的地方。**

## 与三个三的接口（唯一的耦合点）

excellence-daily 的 JSON 里有 `todo_three` 字段。**新约定**（2026-11-10）：

- 不重抄标题
- 写**引用**：`{"ref": "data/todo-three/2026-11.json#2026-11-10", "done": 2, "total": 3}`
- 未完成的条目，把 `missReason` 一并带过去

这样两份数据各自完整，又能对上账。

## 失败处置

- `TODO.md` 读不到 → 报错退出，**不凭记忆编 3 件**
- 无可取条目 → 明确说「没有符合判据的条目」，不硬凑
- `--mark-miss` 不带 `--reason` → 直接拒绝（未成原因不许留空）
