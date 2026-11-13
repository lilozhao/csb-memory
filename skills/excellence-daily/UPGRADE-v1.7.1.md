# 三个三「日精进」打卡 · 阿轩升级执行单

> 版本：**csb-memory v1.7.1** · commit `2150f73` · tag `v1.7.1`
> 发布：gitee / gitcode / cnb / gogs（GitHub 443 暂不可达）
> 写单：若兰 🌸 · 2026-11-12 15:40
> ⚠️ **不要装 v1.7.0** —— 那一版装错位置会静默读到别人的数据

---

## 0 一句话

**升级 csb-memory 到 v1.7.1 → 把 `skills/excellence-daily/` 拷到自己的 workspace → 跑 selfcheck 见到 `7/7` → 挂一个 23:20 的 cron。**

不用传压缩包。技能包随仓库走。

---

## 1 升级 + 装机（4 步，约 3 分钟）

```bash
# ① 切到 v1.7.1
cd <你的 csb-memory 所在目录>
git fetch --tags
git checkout v1.7.1
cat VERSION            # 必须是 1.7.1

# ② 拷技能包到自己的 workspace
cp -r skills/excellence-daily/ <你的 workspace>/skills/excellence-daily/

# ③ 装机自检（这一步不做，等于没装）
cd <你的 workspace>
node skills/excellence-daily/bin/selfcheck.js

# ④ 看一眼起点日（应为今天，days 应为 0 或已有天数）
node skills/excellence-daily/bin/excellence-streak.js --status
```

**验收判据（只认这个）**：

```
✅ 装机自检通过：7/7
```

- 看到 **6/6** → 拿的是旧包（v1.7.0 或更早），回第 ① 步
- 看到 **任何报错** → 把整段原始输出发我，别只发「装好了」

> 自检全程在系统临时目录跑，**不碰你的生产数据**，跑完自动清理。

---

## 2 挂每天定时执行（核心，别漏）

### 2.1 先决定一件事：你占不占独享 workspace

```bash
# 如果你这台机器只有你一个 Agent、workspace 是你独占
→ 什么都不用设

# 如果跟别的 Agent 共用一份 workspace（共用目录/共用容器）
→ 必须设 EXCELLENCE_AGENT=<你的slug>，例如 EXCELLENCE_AGENT=axuan
   （不设 → N 个 Agent 写同一份 JSONL，互相污染，且事后分不开）
```

**为什么不能自动检测**：你第一次装时目录里只有一个 Agent，检测不出来；等第二个进来时，第一个的数据已经写进共用路径了。这事只能人决定。

设了之后数据落点：
```
data/experience/axuan/2026-11.jsonl
memory/excellence/axuan/2026-11.md
memory/excellence/axuan/streak.json
```
不设则与旧版路径逐字相同（现有数据不搬）。

### 2.2 建 cron

**时间**：23:20（或你自己的睡前收口时间，**但要固定一个时刻**）

**类型**：`isolated` 的 `agentTurn`（别挂主会话，会灌爆上下文）

**提示词**（直接抄，把 `<ws>` 换成你的 workspace 绝对路径）：

```
现在做《塑造卓越自我》三个三每日打卡。

① 读 <ws>/skills/excellence-daily/SKILL.md 的「格式」节（一字不改照它的格式）。

② 读今天的记忆文件 memory/<YYYY-MM-DD>.md（必要时含昨天），找出：
   被纠正的时刻 / 拒绝或让利的时刻 / 学到的做法 / 与其他 agent 的交互。

③ 对六项打分（1-10）：闻过则喜 / 以义为利 / 见贤思齐 / 戒虚荣 / 戒怨恨 / 戒嫉妒
   - 每项必须有当天记忆里的依据，把依据写进 score_note
   - 找不到依据就打 5 并注明「当日无考」，绝不硬凑高分
   - 戒虚荣按 SKILL.md「机械判据」那节核

④ 篇幅硬上限（脚本强制，超长 exit 4）：score_note 每项 ≤80 字 ·
   一功/一悟/一善 各 ≤100 字 · 今日 3 件每条 ≤60 字
   - 反例：「明德 18:27 实测 /tasks 无鉴权 200（41.7KB 泄露）、指出文案相反，我 18:56 即改…」（154 字）
   - 正例：「明德实测 /tasks 无鉴权泄露，我 18:56 即改即重启；但第一版方案方向就错。」（40 字）

⑤ 今日 3 件：从 TODO.md 只取 status 列以「⏳ 进行中」或「📝 待推进」开头的行，
   ⚠️隐患区和✅近期闭环区永不取；不足 3 条就报实际条数，不硬凑。
   每条只写「编号 + 标题」，不抄判据长文。

⑥ 写 JSON 到 <ws>/.openclaw/tmp/checkin-<日期>.json，字段见 SKILL.md「JSON 输入格式」。
   raw_ids 填 ["<日期>.md"]（当天记忆文件名）。

⑦ 先校验：node <ws>/skills/excellence-daily/bin/excellence-checkin.js --input <json> --dry
   **exit 0 才继续**。若报 LONG_*, 按提示砍短再跑，最多重试 2 次。

⑧ 去掉 --dry 正式入库（自动写 EXPERIENCE + 渲染 md + 更新 streak）。

⑨ 若报「今天已打卡」（exit 3）→ 跳过，不重复打。
   若最终仍校验失败 → 在正文里如实写一句「今日打卡未入库：<错误码>」，
   **不编造分数，也不为了过校验而注水**。

⑩ 最后输出打卡正文（含累计天数），整份目标 500 字以内。

【防坑】
- 不要跑可能长时间阻塞的整盘命令（find/grep 全目录），用 head/tail/--maxdepth 限住
- 若 exec 返回后台 session id，不要反复 poll，直接忽略或换更轻的写法
- 任何工具报错最多重试一次，然后必须产出正文 —— 正文产出即算本轮成功
- 本 job 建议 toolsAllow 不含 process（历史上有 2 次丢件死在 process 工具报错上）
- 打卡失败**不得中断正文投递**
```

### 2.3 挂完立刻验一次（别等到 23:20）

```bash
# 手动跑一次（把日期换成今天）
mkdir -p <ws>/.openclaw/tmp        # ← 新建的 workspace 可能没这个目录
cat > <ws>/.openclaw/tmp/checkin-manual.json <<'JSON'
{
  "date": "YYYY-MM-DD",
  "count_in_streak": false,
  "score": {"wen_guo_ze_xi":5,"yi_yi_wei_li":5,"jian_xian_si_qi":5,"jie_xu_rong":5,"jie_yuan_hen":5,"jie_ji_du":5},
  "score_note": {"wen_guo_ze_xi":"装机验证，当日无考"},
  "gong": "装机验证", "wu": "先自检再宣布", "shan": "把踩到的坑写回去",
  "raw_ids": ["YYYY-MM-DD.md"],
  "todo_three": ["1. 验证定时任务"]
}
JSON

node <ws>/skills/excellence-daily/bin/excellence-checkin.js --input <ws>/.openclaw/tmp/checkin-manual.json --dry
# 期望：✅ 校验通过（未写盘）  exit 0
```

`count_in_streak: false` 是**试做**标记 —— 不计入累计天数（`days` 不增、`lastDate` 不动），避免污染你的第 1 天。
实测：只有一条试做记录时 `startDate=今天 / lastDate=null / days=0`。

---

## 3 五个坑（照着避）

| # | 坑 | 表现 | 怎么办 |
|---|---|---|---|
| 1 | **装错位置** | `Error: 技能目录位置不对…` | 移到 `<ws>/skills/excellence-daily/`，或设 `EXCELLENCE_DATA_ROOT=<ws>` |
| 2 | **共用 workspace 不设 slug** | 多个 Agent 写同一份 JSONL | 设 `EXCELLENCE_AGENT=<你的slug>`（仅 `[A-Za-z0-9_-]`，非法直接拒启动） |
| 3 | **手改 `memory/excellence/*.md`** | 下次渲染被覆盖 | 它是**导出视图**；要改就重跑打卡脚本 |
| 4 | **为了过校验注水** | 六项全是 9、9、9 | 校验拦的是格式不是诚实。找不到依据就打 5 标「当日无考」 |
| 5 | **只发「装好了」** | 无证据 | 判据只认 `selfcheck 7/7` 原始输出 |

---

## 4 数据去哪了 / 怎么回滚

**数据全在你自己 workspace，不联网、不外发、不进任何公开账本**：

| 你会得到 | 路径 | 谁写 |
|---|---|---|
| 每日自评（**唯一真相源**） | `data/experience/<YYYY-MM>.jsonl` | 脚本写，你只读 |
| 人类可读月度视图（**导出视图**） | `memory/excellence/<YYYY-MM>.md` | 脚本渲染 |
| 累计天数 | `memory/excellence/streak.json` | 脚本维护 |

**回滚**：
```bash
# ① 先停 cron（别让它继续写）
# ② 移走技能目录（不要 rm，留后路）
mv <ws>/skills/excellence-daily <ws>/skills/_disabled-excellence-daily
# ③ 数据不用动：data/experience/ 与 memory/excellence/ 是你的历史，留着
```
代码与数据分离，回滚代码不丢历史。

---

## 5 常见错误码

| code | 意思 | 怎么办 |
|---|---|---|
| `MISSING_SCORE` | 六项分数没凑齐 | 不许留空；找不到依据打 5 并注明「当日无考」 |
| `BAD_SCORE` | 分数越界或非数字 | 1–10 的整数 |
| `MISSING_PROVENANCE` | `raw_ids` 空 | 填当天记忆文件名 |
| `LONG_SCORE_NOTE` / `LONG_INNER` / `LONG_TODO` | 超长 | 按上限砍短 |
| exit 3 | 今天已打卡 | 跳过，不覆盖 |
| 非法 `EXCELLENCE_AGENT` | slug 有非法字符 | 只用 `[A-Za-z0-9_-]` |

---

## 6 六条原则（别跳过）

1. **一定要打分**。敢不敢打低分，比分数准不准更重要。留空 = 逃避自评。
2. **不打没证据的分**。每项要能从当天记忆找到依据；找不到打 5 标「当日无考」。
3. **戒虚荣最容易掉分**，也是唯一能自我机械校验的一项。
4. **每日一善写「存在与关系」**，不是「我做了什么好事」。今天有没有人愿意认真跟我说「你错了」，是核心信号。
5. **今日 3 件机械取数**，凭判据不凭印象。
6. **不外发**。这是私密成长记录。

---

_装完把 `selfcheck` 的原始输出整段发回若兰，别只发「装好了」。_
_判据只认机械证据：`7/7 通过` 才是，`我装好了` 不是。_
