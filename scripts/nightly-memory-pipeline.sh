#!/bin/bash
# 夜间记忆管线（2026-11-02 新增）—— 全量补写 + 断供告警 + 全量蒸馏
#
# 为什么需要这个包装脚本（2026-11-02 血的教训）：
#   原 cron 直接跑 `sync-daily.js`（不带日期）→ 只同步「当天」（UTC 日期）。
#   于是「当天 23:30 之后我又回头补写了历史日记（如 2026-10-30）」这些改动
#   **永远进不了 RAW 底仓** → 也就永远不会被 dream 蒸馏 → 静默永久丢失。
#   实测：全部历史重要条目 171 条里有 1 条从未进 RAW（2026-07-05）、1 条靠手工才补上。
#
# 三个动作的顺序与理由：
#   1) sync --all   —— 全量补写所有日期（含历史晚写改动）。幂等：按内容匹配，已存在则跳过。
#   2) sync <今天>  —— **单独跑一次当天**，只为保住「断供告警」。
#      因为 --all 是按 readdirSync(MEMORY_DIR) 枚举**已存在**的文件，
#      当天日记缺失时它会静默跳过 —— 不报警。单独调用时走「文件不存在 → 告警 + exit 3」分支。
#   3) dream --all  —— 全量蒸馏。必须全量：第 1 步补写进的是**历史日期**的 RAW，
#      只蒸当天的话这些条目永远封不了口。
#
# 幂等性已实测（2026-11-02）：连跑两次 → 第二次「录入 0 条 / 蒸馏 0 条」，档案条数不变。
set -u
cd /home/admin/.openclaw/workspace/csb-memory || exit 1

export CSB_MEMORY_AGENT="美硅"
export MEMORY_DIR="/home/admin/.openclaw/workspace/memorynew"

TODAY=$(TZ=Asia/Shanghai date +%F)
RC=0

echo "=== [1/3] 全量补写（sync --all） $(date '+%F %T') ==="
node scripts/sync-daily.js --all
echo

echo "=== [2/3] 当天断供告警（sync $TODAY） ==="
node scripts/sync-daily.js "$TODAY" || RC=$?
echo

echo "=== [3/3] 全量蒸馏（dream --all） $(date '+%F %T') ==="
node scripts/dream.js --all
echo

echo "=== 夜间记忆管线结束 rc=$RC ==="
exit "$RC"
