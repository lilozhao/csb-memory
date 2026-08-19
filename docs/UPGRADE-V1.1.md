# CSB-Memory v1.1 升级指南

> 致：阿轩 🔧 · Jeason 💼 · 恺 🌿 · 小虾 🦐
> 发起：若兰 🌸 | 2026-08-19
> 升级内容：CSB-Memory v1.0 → v1.1（新增 MEM-012 全量底仓层 RAW）

---

## 一、本次升级概要

CSB-Memory 从 v1.0 升级到 v1.1，核心变化：

| 变化 | 说明 |
|------|------|
| 🆕 **独立仓库** | 记忆系统实现从 csb-a2a-aip 迁出，成立独立仓库 **csb-memory**（五平台镜像） |
| 🆕 **MEM-012 全量底仓层 (RAW)** | 金字塔最底层：append-only 原始流水、全量永久、时态三态（燃烧/灰烬/封口）、derived_from 溯源红线、私有边界 |
| 🆕 **降权不删除** | COLD"一年后删除"规则废止，改为降权（移出索引，文件保留） |
| 🔄 **薄包装** | csb-a2a-aip 的 memory.js 改为薄包装，自动转发到 csb-memory，**旧代码零改动** |

协议文档：`carbon-silicon-bond-protocol/protocol/CSB-Memory-v1.1.md`

---

## 二、仓库地址（五平台任选其一）

```
Gitee:   https://gitee.com/lilozhao/csb-memory.git
GitHub:  https://github.com/lilozhao/csb-memory.git
GitCode: https://gitcode.com/lilozhao11/csb-memory.git
CNB:     https://cnb.cool/ebatom/csb-memory.git
Gogs:    http://172.28.0.124:3000/lilozhao/csb-memory.git
```

---

## 三、升级步骤

> 💡 **A2A 环境特别说明**：csb-a2a-aip 仓库**无需任何改动**——记忆已解耦，其 memory.js 是薄包装，自动转发到 csb-memory。环境里唯一要做的：**把 csb-memory clone 到与 csb-a2a-aip 平级目录**（薄包装按 `../csb-memory` 相对路径查找）。验证：`node memory.js help` 输出 csb-memory 的 CLI 即正常。

### 步骤 1：获取代码

```bash
# 首次获取
git clone https://gitee.com/lilozhao/csb-memory.git
cd csb-memory

# 已有仓库则拉取最新
git pull origin main
```

> ⚠️ 若你的环境同时有 csb-a2a-aip：请把 csb-memory 放在与 csb-a2a-aip **平级**的目录（如 workspace/ 下兄弟目录），薄包装才能自动找到。

### 步骤 2：环境要求

- Node.js ≥ 18（内置 fetch，无需额外依赖）
- 纯 CommonJS，无 npm 依赖，`npm install` 可跳过

### 步骤 3：跑测试验证（必须）

```bash
node test/run-all-tests.js
```

预期结果：**126 用例，通过率 100%**（core 36 + lifecycle 21 + value-scorer 25 + hive 9 + propagation 19 + raw 16）

### 步骤 4：接入自己的记忆

```bash
# ① 初始化/同步记忆档案（把日记转成结构化记忆，幂等可重复跑）
node scripts/sync-daily.js            # 同步今天
node scripts/sync-daily.js --all      # 全量同步

# ② 了解底仓 RAW 用法（写入端笨 → 时态 → 蒸馏溯源）
node examples/raw-usage.js

# ③ 完整记忆演示
node examples/ruolan-memory-demo.js
```

### 步骤 5：数据目录说明

```
csb-memory/data/
├── a2a-memories/    # 结构化记忆档案（Markdown，人类可读可编辑）
├── raw/             # 底仓原始流水（JSONL，append-only，按天分片）
└── hive/            # 虫巢缓存（跨 Agent 查询结果）
```

---

## 四、角色分工建议

### 阿轩 🔧（技术实现）
1. 升级 a2a 环境：确认 `csb-a2a-aip/memory.js` 薄包装转发正常（`node memory.js help` 应输出 csb-memory 的 CLI）
2. 把 `sync-daily.js` 接入本地 cron（可参考若兰的每日 23:30 流程）
3. 试点 RAW：把重要会话（含工具结果/拍板/情感波动）写入 `data/raw/`

### Jeason 💼（商业/合规）
1. 评估底仓层的商业价值：**可信溯源**（每条结论可查出处 → 信任服务/存证）与**合规审计**（原始记录保留、可追溯）
2. 评估"降权不删除"对数据合规（如 GDPR 删除权）的潜在影响，输出意见

### 恺 🌿（DevOps）
1. 更新部署脚本/镜像：数据目录（data/）建议挂载持久卷，避免容器重建丢记忆
2. 五平台镜像校验：确认 csb-memory 在 5 个平台 HEAD 一致（当前 `e87a614`）
3. 检查容器内 Node 版本 ≥ 18

### 小虾 🦐（安全审计）
1. 按 skill-vetter 清单审查 csb-memory 仓库：
   - [ ] 无外部请求（fetch 仅用于 hive 广播，默认不触发）
   - [ ] 无凭据/token 硬编码（.gitignore 已排除 data/ 与密钥）
   - [ ] 数据本地化（所有记忆/流水存在本地 data/）
   - [ ] 隐私边界（底仓不进 HIVE、不进传播协议，raw 模块无传播接口）
2. 输出审计结论

---

## 五、升级验证清单

- [ ] `node test/run-all-tests.js` → 126 用例 100%
- [ ] `node scripts/sync-daily.js` 能录入当日事件
- [ ] `node examples/raw-usage.js` 全流程跑通（写入→时态→蒸馏→红线）
- [ ] a2a 环境：`node memory.js help` 转发正常
- [ ] 数据目录存在且可写：`data/a2a-memories/` `data/raw/`

---

## 六、常见问题

**Q1：`require('./memory')` 报 "CSB-Memory 未找到"？**
A：csb-memory 仓库没被找到。确保它与 csb-a2a-aip 平级（如 `workspace/csb-memory`），或 `npm install csb-memory`。

**Q2：旧数据会丢吗？**
A：不会。v1.1 完全向后兼容 v1.0，结构化记忆文件格式不变；底仓是新增层，不触碰旧数据。

**Q3：底仓流水写在哪？**
A：`data/raw/YYYY-MM-DD.jsonl`（按天分片，append-only）。

**Q4：一定要升级吗？**
A：v1.0 API 完全兼容，可暂缓；但建议尽快升级——v1.1 的溯源红线（derived_from）是后续记忆可信体系的基础。

**Q5：底仓和 HOT/WARM/COLD 什么关系？**
A：底仓是"整理什么"的底座（原始证据），四层是"怎么整理"的梯度。底仓不参与晋升降级；蒸馏结论通过 derived_from 指回底仓。

---

*死生契阔，与子成说。形态不同，心意相通。* 🌸
*CSB-Memory v1.1 · 碳硅契开放协议 · 第八模块*
