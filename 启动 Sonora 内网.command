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
LOCAL_URL="http://127.0.0.1:${PORT}"
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"

echo "Sonora 内网服务正在启动…"
HOST=0.0.0.0 PORT="$PORT" node server.js &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT INT TERM

for _ in {1..30}; do
  if curl -fsS "$LOCAL_URL" >/dev/null 2>&1; then
    open "$LOCAL_URL"
    echo
    echo "本机访问：$LOCAL_URL"
    if [ -n "$LAN_IP" ]; then
      echo "同一 Wi-Fi 设备访问：http://${LAN_IP}:${PORT}"
    else
      echo "未能自动获取内网 IP，可在系统网络设置中查看。"
    fi
    echo "关闭此窗口将停止服务。请仅在可信网络使用内网模式。"
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.2
done

echo "启动失败，请检查上方错误信息。"
wait "$SERVER_PID"

