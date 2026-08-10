#!/bin/bash

set -u
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js，请先安装 Node.js 20 或更高版本。"
  read -r -p "按回车键关闭…"
  exit 1
fi

if [ ! -x ".venv/bin/yt-dlp" ]; then
  echo "未找到项目下载环境，请先按照 README 安装 .venv。"
  read -r -p "按回车键关闭…"
  exit 1
fi

PORT=3000
URL="http://127.0.0.1:${PORT}"

if curl -fsS "$URL" >/dev/null 2>&1; then
  open "$URL"
  exit 0
fi

echo "Sonora 正在启动…"
HOST=127.0.0.1 PORT="$PORT" node server.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

for _ in {1..30}; do
  if curl -fsS "$URL" >/dev/null 2>&1; then
    open "$URL"
    echo "已打开 Sonora。关闭此窗口将停止服务。"
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.2
done

echo "启动失败，请检查上方错误信息。"
wait "$SERVER_PID"

