#!/bin/bash
# sync-meigui.sh — 美硅日记同步脚本
# 将 memorynew/ 目录中的日记同步到 CSB-Memory 结构化档案

cd /home/admin/.openclaw/workspace/csb-memory

export CSB_MEMORY_AGENT="美硅"
export MEMORY_DIR="/home/admin/.openclaw/workspace/memorynew"

node scripts/sync-daily.js "$@"
