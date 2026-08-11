# Sonora

Sonora 是一个本地运行的 YouTube 媒体工具，提供音频提取、视频下载和已有字幕导出。它包含 Web 版本以及 macOS 和 Windows 的桌面版

> 仅下载你拥有版权、已获授权或法律允许保存的内容。使用者有责任遵守 YouTube 服务条款及所在地法律。Sonora 不绕过 DRM、付费、会员或私人内容的访问控制。

## 功能

- 提取 MP3、M4A、OPUS 音频，支持 128–320 kbps
- 下载 720p、1080p 或最佳画质的静音视频流
- 按需下载音频流，并通过 FFmpeg 合并音视频
- 识别并导出视频已有的人工字幕或自动字幕
- 根据字幕时间间隔添加标点和段落，不总结、不改写、不翻译
- 实时任务进度与临时文件自动清理
- 自动跟随系统深浅模式的液态玻璃界面
- 支持本地网页、macOS App 和 Windows Electron App

## Web 版本

### 环境要求

- Node.js 20+
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [FFmpeg](https://ffmpeg.org/)

macOS 可以将运行环境安装在项目内，无需 Homebrew：

```bash
python3 -m venv .venv
.venv/bin/pip install -i https://pypi.tuna.tsinghua.edu.cn/simple yt-dlp imageio-ffmpeg certifi
```

也可以使用系统工具：

```bash
brew install yt-dlp ffmpeg
```

### 启动

```bash
npm start
```

访问 <http://127.0.0.1:3000>。开发时可使用：

```bash
npm run dev
```

如需让可信局域网中的其他设备访问：

```bash
HOST=0.0.0.0 PORT=3000 npm start
```

内网模式没有身份验证，请勿暴露到公网。

## macOS

项目提供原生 AppKit + WKWebView 窗口源码，位于 `packaging/SonoraApp.m`。Release 版将 Universal Node.js、yt-dlp 和 FFmpeg 放在 App 内，无需 Homebrew、Python、Node.js 或项目目录，支持 Intel 与 Apple Silicon，最低系统版本为 macOS 11.3。

也可以在 Finder 中双击：

- `启动 Sonora.command`：仅本机访问
- `启动 Sonora 内网.command`：允许可信局域网访问

生成的 `Sonora.app` 不提交到源码仓库，正式发布时应压缩为 ZIP 并作为 GitHub Release 附件上传。未经 Developer ID 签名和 Apple 公证的版本可能被 Gatekeeper 拦截。

## Windows 10/11 x64

Windows 电脑不需要 VS Code、Codex、Python 或预装 Node.js：

1. 将源码解压到简单路径，例如 `C:\Sonora`。
2. 双击 `build-windows.bat`。
3. 脚本自动下载便携 Node.js、yt-dlp、FFmpeg 和 Electron 构建依赖。
4. 在 `release-windows` 中取得安装版与便携版 EXE。

依赖和下载内容会被缓存，后续构建通常不需要重新下载。完整日志保存在 `windows-build.log`。

未经 Authenticode 签名的 EXE 可能触发 SmartScreen“未知发布者”提示。发布文件应放在 GitHub Releases，不应直接提交到 Git。

## 测试

```bash
npm test
```

## 安全设计

- 只接受受支持 YouTube 域名的 HTTPS URL
- 下载格式、音质、画质和字幕语言使用参数白名单
- 所有外部程序均通过参数数组启动，不使用 Shell 拼接
- 禁止播放列表批量下载
- 临时任务文件会定时清理

若部署到多人或公网环境，应额外添加身份验证、速率限制、任务并发限制和 HTTPS 反向代理。

## 许可证

[MIT](LICENSE)

English documentation: [README.en.md](README.en.md)
