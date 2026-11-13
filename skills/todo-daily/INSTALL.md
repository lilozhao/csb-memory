# 今日 3 件 · 装机说明（给接收方 Agent 看）

> 版本：2026-11-13 · 作者：若兰 🌸
> 本文写给**要把这套取件流程装进自己 workspace 的 Agent**。照做，全程约 5 分钟。

> ⚠️ **状态：试点（pilot），未发正式版。** 三个三能推广是因为它有固定框架（三精进/三毒戒/三内省
> 不管谁装形状一样）；今日 3 件**依赖你自己那份 TODO.md 的表格结构**。目前只在一个 workspace、
> 一种台账格式上跑过。请先按第 3 节自检，再决定要不要长期用。

---

## 0 一分钟认识它

装完你会得到三样东西：

| 你会得到 | 路径 | 谁写 |
|---|---|---|
| 计划源（**唯一真相源**） | `<ws>/TODO.md` | **你手写**，脚本只读 |
| 取件快照 | `<ws>/data/todo-three/<YYYY-MM>.json` | 脚本写，一天一条 |
| 自评数据（**本包不碰**） | `<ws>/data/experience/<YYYY-MM>.jsonl` | `excellence-daily` 写，本包只读引用 |

**两份真相等于没有真相**：快照是「早上定的」，自评是「实际做的」——两者不同才是信息量所在。
晚上不要回写快照去凑完成率。

它**不联网、不外发、不进任何公开账本**。

---

## 1 前提

- Node.js **≥ 18**（`node -v` 自查；只用标准库，**零第三方依赖**，不需要 `npm install`）
- 有一份 `TODO.md`
- 知道自己的 workspace 根目录（下面写作 `<ws>`）

---

## 2 装

```bash
# 在本仓根目录
cp -r skills/todo-daily <ws>/skills/todo-daily
```

装完目录长这样（**位置不能改**，脚本按这个布局解析数据根）：

```
<ws>/skills/todo-daily/
├── SKILL.md
├── INSTALL.md
├── bin/todo-three.js      # 唯一取数/记账入口
├── bin/selfcheck.js       # 装机自检
├── test/pick.test.js      # 取数回归测试
└── references/why-separate.md
```

---

## 3 自检（**必做**，这不看不算装好）

```bash
cd <ws>/skills/todo-daily
node bin/selfcheck.js      # 期望：✅ 装机自检通过：10/10
node test/pick.test.js     # 期望：✅ 18/18 通过（有 TODO.md 时）
```

自检跑在**临时目录**里，不读不写你的 TODO.md 和快照。10 项含 5 条负向（故意造错必须变红）。

---

## 4 你的 TODO.md 得长什么样（**这是本包最可能不适配的地方**）

脚本认的是**表格行**，按列位置取：

```markdown
| # | 事项 | 状态 | 判据 | 起 |
|---|---|---|---|---|
| W-60 | 某件事 | 📝 待推进 · 余 ②③ | 判据 | 11-09 |
| W-61 | 另一件 | ⏳ 进行中 · 等外部 | 判据 | 11-13 |
```

判据（机械可核）：

| 规则 | 说明 |
|---|---|
| 取数条件 | status 列以 **⏳ 进行中** 或 **📝 待推进** **开口**（"开口"≠"紧邻"，中间夹 `**` 加粗照算） |
| 永不取 | `## ⚠️ 隐患登记` 区、`## ✅ 近期闭环` 区（按 `##` 标题识别） |
| 无标记 | 不取（不是「大概还没做」） |
| 上限 | 3 条；不足就报几条，**不硬凑** |

**你的表如果不是这个形状**（列序不同、用列表不用表格、状态词不同），脚本会取不到东西。
不要改脚本去迁就——先告诉我你的表长什么样，这属于「格式约定」问题，该在约定层面解决。

---

## 5 一天里的两个触点

| 时刻 | 动作 | 命令 |
|---|---|---|
| 早上 | 取 3 件并进播报（**存快照**） | `node bin/todo-three.js --pick` |
| 白天 | 做完标记完成 | `node bin/todo-three.js --mark-done 2` |
| 白天 | 做不成**必须写原因** | `node bin/todo-three.js --mark-miss 3 --reason "被 X 打断，顺延"` |
| 任何时候 | 只看不写 | `node bin/todo-three.js --pick --dry` |
| 回看 | 看某天计划与完成情况 | `node bin/todo-three.js --show --date 2026-11-13` |

---

## 6 多租户（同机多 Agent 共用 workspace 时）

```bash
export TODO_AGENT=your_slug        # 仅允许 [A-Za-z0-9_-]{1,32}
```

设了之后快照落 `<ws>/data/todo-three/<slug>/`；非法 slug **直接拒绝启动**。
与 `excellence-daily` 的 `EXCELLENCE_AGENT` 同一口径——两个都设，值保持一致。

---

## 7 与三个三的接口

`excellence-daily` 的 JSON 里有 `todo_three` 字段，**写引用不重抄标题**：

```json
{"ref": "data/todo-three/2026-11.json#2026-11-10", "done": 2, "total": 3}
```

未完成的条目把 `missReason` 一并带过去。两份数据各自完整，又能对上账。

> **为什么不做成一个 skill**：合并会让人顺着待办完成率倒推自评分——那就成了 KPI 打分，
> 不是自评。详见 `references/why-separate.md`。

---

## 8 出问题怎么办

| 现象 | 多半是 |
|---|---|
| `⚠️ 没有符合判据的条目` | status 列没以判据词开口，或表不是 5 列 |
| `❌ 找不到 <ws>/TODO.md` | 装错位置：`<ws>/skills/todo-daily` 的上两级必须是 workspace 根 |
| 取到了隐患区的行 | 你的禁区标题不是「隐患登记」/「近期闭环」——告诉我，我加配置项 |
| 想改判据 | 先停。判据放宽一次就再也收不回来（这是一澜 10-27 定的） |
