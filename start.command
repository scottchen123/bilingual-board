#!/bin/bash
# Mac: double-click to start the board (keep this window open). 双击启动聊天板，别关这个窗口。
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then echo "Please install Node.js first: https://nodejs.org  请先安装 Node.js"; read -r -p "Press Enter to close"; exit 1; fi
node server.mjs --open
