# Sonora

Sonora is a locally hosted YouTube media utility for extracting audio, downloading video streams, and exporting captions that already exist on a video. It includes a lightweight web interface and desktop wrappers for macOS and Windows.

> Download only content you own, are authorized to save, or are otherwise legally permitted to download. Users are responsible for complying with YouTube's Terms of Service and applicable laws. Sonora does not bypass DRM or access controls for paid, members-only, or private content.

## Features

- MP3, M4A, and OPUS audio extraction at 128–320 kbps
- Silent video-stream downloads at up to 720p, 1080p, or best available quality
- Optional audio download and FFmpeg merging
- Manual and auto-caption discovery with user-selectable languages
- Deterministic punctuation and paragraph formatting based on caption timing
- Live progress reporting and temporary-file cleanup
- Light/dark liquid-glass interface
- Local web, native macOS, and Electron-based Windows front ends

## Run the web app

Requirements: Node.js 20+, yt-dlp, and FFmpeg.

On macOS, dependencies can be installed into a project-local Python environment:

```bash
python3 -m venv .venv
.venv/bin/pip install yt-dlp imageio-ffmpeg certifi
npm start
```

Open <http://127.0.0.1:3000>.

## Build for Windows 10/11 x64

Extract the repository to a simple path such as `C:\Sonora`, then double-click `build-windows.bat`. The script downloads a portable Node.js runtime, yt-dlp, FFmpeg, Electron, and the required packaging tools. Installable and portable executables are written to `release-windows`.

No VS Code, Codex, Python, or preinstalled Node.js is required on the Windows build machine.

## Tests

```bash
npm test
```

## License

[MIT](LICENSE)
