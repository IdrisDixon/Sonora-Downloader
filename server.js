'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const LOCAL_YTDLP = path.join(__dirname, '.venv', 'bin', 'yt-dlp');
const LOCAL_PYTHON = path.join(__dirname, '.venv', 'bin', 'python');
const MAX_BODY = 16 * 1024;
const ALLOWED_FORMATS = new Set(['mp3', 'm4a', 'opus']);
const ALLOWED_QUALITIES = new Set(['128', '192', '256', '320']);
const ALLOWED_VIDEO_QUALITIES = new Set(['720', '1080', 'best']);
const jobs = new Map();
const clients = new Map();

function findLocalFfmpeg() {
  const lib = path.join(__dirname, '.venv', 'lib');
  if (!fs.existsSync(lib)) return null;
  for (const pythonDir of fs.readdirSync(lib)) {
    const binaries = path.join(lib, pythonDir, 'site-packages', 'imageio_ffmpeg', 'binaries');
    if (!fs.existsSync(binaries)) continue;
    const name = fs.readdirSync(binaries).find(file => file.startsWith('ffmpeg-'));
    if (name) return path.join(binaries, name);
  }
  return null;
}

function findLocalCertificateBundle() {
  const lib = path.join(__dirname, '.venv', 'lib');
  if (!fs.existsSync(lib)) return null;
  for (const pythonDir of fs.readdirSync(lib)) {
    const bundle = path.join(lib, pythonDir, 'site-packages', 'certifi', 'cacert.pem');
    if (fs.existsSync(bundle)) return bundle;
  }
  return null;
}

const USE_LOCAL_YTDLP = fs.existsSync(LOCAL_YTDLP) && fs.existsSync(LOCAL_PYTHON);
const YTDLP = process.env.SONORA_YTDLP || (USE_LOCAL_YTDLP ? LOCAL_PYTHON : 'yt-dlp');
const YTDLP_PREFIX = process.env.SONORA_YTDLP ? [] : (USE_LOCAL_YTDLP ? [LOCAL_YTDLP] : []);
const LOCAL_FFMPEG = process.env.SONORA_FFMPEG || findLocalFfmpeg();
const LOCAL_CA_BUNDLE = findLocalCertificateBundle();
const TOOL_ENV = LOCAL_CA_BUNDLE
  ? { ...process.env, SSL_CERT_FILE: LOCAL_CA_BUNDLE, REQUESTS_CA_BUNDLE: LOCAL_CA_BUNDLE }
  : process.env;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function isYoutubeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'music.youtube.com'].includes(url.hostname);
  } catch { return false; }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) req.destroy(new Error('请求内容过大'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); } catch { reject(new Error('无效的 JSON')); }
    });
    req.on('error', reject);
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '', stderr = '';
    child.stdout?.on('data', d => { stdout += d; options.onStdout?.(String(d)); });
    child.stderr?.on('data', d => { stderr += d; options.onStderr?.(String(d)); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} 退出码 ${code}`)));
  });
}

function safeError(error) {
  if (error.code === 'ENOENT') return `无法启动下载工具：${error.path || '可执行文件'} 不存在。请重启服务器后再试。`;
  const message = String(error.message || error).split('\n').slice(-3).join(' ').replace(/https?:\/\/\S+/g, '[链接]');
  return message.slice(0, 400) || '处理失败，请稍后重试。';
}

function emit(id, event) {
  const job = jobs.get(id);
  if (job) job.lastEvent = event;
  const set = clients.get(id);
  if (!set) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) res.write(data);
}

async function getInfo(url) {
  const args = [...YTDLP_PREFIX, '--dump-single-json', '--no-playlist', '--skip-download', '--no-warnings'];
  if (LOCAL_FFMPEG) args.push('--ffmpeg-location', LOCAL_FFMPEG);
  args.push(url);
  const out = await run(YTDLP, args, { env: TOOL_ENV });
  const data = JSON.parse(out);
  const manual = data.subtitles || {};
  const automatic = data.automatic_captions || {};
  const automaticCodes = Object.keys(automatic);
  const originalAutomatic = data.language
    ? automaticCodes.filter(code => code === data.language || code === `${data.language}-orig`)
    : automaticCodes.filter(code => code.endsWith('-orig'));
  const codes = [...new Set([...Object.keys(manual), ...originalAutomatic])]
    .filter(code => code !== 'live_chat');
  return {
    title: data.title || '未命名视频',
    channel: data.channel || data.uploader || '未知频道',
    duration: Number(data.duration || 0),
    thumbnail: data.thumbnail || '',
    id: data.id || '',
    language: data.language || '',
    subtitleLanguages: codes.map(code => ({
      code,
      manual: Boolean(manual[code]),
      label: code
    }))
  };
}

function chooseSubtitleLanguage(info, requested) {
  const languages = info.subtitleLanguages || [];
  if (requested && languages.some(item => item.code === requested)) return requested;
  const manual = languages.filter(item => item.manual);
  const pool = manual.length ? manual : languages;
  const preferred = [info.language, 'zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW', 'zh', 'en'].filter(Boolean);
  return preferred.find(code => pool.some(item => item.code === code)) || pool[0]?.code || null;
}

function vttToText(vtt) {
  const decode = text => text
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  const toSeconds = value => {
    const parts = value.replace(',', '.').split(':').map(Number);
    return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
  };
  const cues = [];
  for (const block of vtt.replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/)) {
    const lines = block.split(/\r?\n/).map(line => line.trim());
    const timingIndex = lines.findIndex(line => line.includes('-->'));
    if (timingIndex < 0) continue;
    const timing = lines[timingIndex].match(/([\d:,\.]+)\s+-->\s+([\d:,\.]+)/);
    if (!timing) continue;
    let text = decode(lines.slice(timingIndex + 1).filter(Boolean).join(' '))
      .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
      .replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const previous = cues[cues.length - 1];
    if (previous?.text === text || previous?.text.startsWith(text)) {
      previous.end = Math.max(previous.end, toSeconds(timing[2]));
      continue;
    }
    if (previous && text.startsWith(previous.text)) {
      previous.text = text;
      previous.end = toSeconds(timing[2]);
      continue;
    }
    cues.push({ text, start: toSeconds(timing[1]), end: toSeconds(timing[2]) });
  }

  const allText = cues.map(cue => cue.text).join('');
  const cjk = (allText.match(/[\u3400-\u9fff]/g)?.length || 0) > allText.length * 0.15;
  const comma = cjk ? '，' : ', ';
  const period = cjk ? '。' : '. ';
  const result = [];
  for (let index = 0; index < cues.length; index++) {
    const cue = cues[index];
    const next = cues[index + 1];
    const alreadyPunctuated = /[。！？!?；;：:，,.…]$/.test(cue.text);
    let suffix = '';
    if (!alreadyPunctuated) suffix = next && next.start - cue.end < 1.2 ? comma : period;
    result.push(cue.text + suffix);
    if (next && next.start - cue.end >= 1.2) result.push('\n');
  }
  return result.join(cjk ? '' : '').replace(/[ \t]+\n/g, '\n').trim();
}

async function startDownload(id, input) {
  const job = jobs.get(id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-'));
  job.dir = dir;
  try {
    const template = path.join(dir, '%(title).120B-%(id)s.%(ext)s');
    const args = [...YTDLP_PREFIX, '--no-playlist', '--newline', '--no-warnings'];
    if (LOCAL_FFMPEG) args.push('--ffmpeg-location', LOCAL_FFMPEG);
    args.push('-x', '--audio-format', input.format, '--audio-quality', `${input.quality}K`, '-o', template, input.url);
    emit(id, { type: 'progress', progress: 3, message: '正在连接 YouTube…' });
    await run(YTDLP, args, {
      env: TOOL_ENV,
      onStdout: text => {
        const match = text.match(/\[download\]\s+([\d.]+)%/);
        if (match) emit(id, { type: 'progress', progress: Math.min(92, Math.round(Number(match[1]) * .88 + 4)), message: '正在下载音频…' });
        if (/ExtractAudio|Destination/.test(text)) emit(id, { type: 'progress', progress: 95, message: `正在转换为 ${input.format.toUpperCase()}…` });
      }
    });
    const file = fs.readdirSync(dir).map(name => path.join(dir, name)).find(item => fs.statSync(item).isFile());
    if (!file) throw new Error('没有生成音频文件');
    job.status = 'ready';
    job.file = file;
    job.name = path.basename(file);
    emit(id, { type: 'ready', progress: 100, name: job.name, downloadUrl: `/api/file/${id}` });
  } catch (error) {
    job.status = 'error';
    job.error = safeError(error);
    emit(id, { type: 'error', message: job.error });
  }
}

async function startSubtitleDownload(id, input) {
  const job = jobs.get(id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-subs-'));
  job.dir = dir;
  try {
    emit(id, { type: 'progress', progress: 8, message: '正在检查可用字幕…' });
    const info = await getInfo(input.url);
    const language = chooseSubtitleLanguage(info, input.language);
    if (!language) throw new Error('该视频没有可提取的人工字幕或自动字幕。');
    const selectedTrack = info.subtitleLanguages.find(item => item.code === language);

    emit(id, { type: 'progress', progress: 35, message: `正在提取 ${language} 字幕…` });
    const template = path.join(dir, '%(title).120B-%(id)s.%(ext)s');
    const args = [...YTDLP_PREFIX, '--no-playlist', '--skip-download', selectedTrack?.manual ? '--write-subs' : '--write-auto-subs', '--sub-langs', language, '--sub-format', 'vtt', '-o', template, input.url];
    await run(YTDLP, args, { env: TOOL_ENV });

    const subtitle = fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .find(file => file.toLowerCase().endsWith('.vtt'));
    if (!subtitle) throw new Error('字幕提取失败，YouTube 未返回可用的字幕文件。');

    emit(id, { type: 'progress', progress: 85, message: '正在整理字幕文本…' });
    const text = vttToText(fs.readFileSync(subtitle, 'utf8'));
    if (!text) throw new Error('字幕文件为空，无法生成文本。');
    const output = subtitle.replace(/\.[^.]+\.vtt$/i, '.txt').replace(/\.vtt$/i, '.txt');
    fs.writeFileSync(output, `${text}\n`, 'utf8');
    fs.rmSync(subtitle, { force: true });

    job.status = 'ready';
    job.file = output;
    job.name = path.basename(output);
    emit(id, { type: 'ready', progress: 100, name: job.name, downloadUrl: `/api/file/${id}` });
  } catch (error) {
    job.status = 'error';
    job.error = safeError(error);
    emit(id, { type: 'error', message: job.error });
  }
}

async function startVideoDownload(id, input) {
  const job = jobs.get(id);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-video-'));
  job.dir = dir;
  try {
    const template = path.join(dir, '%(title).120B-%(id)s.%(ext)s');
    const height = input.quality === 'best' ? '' : `[height<=${input.quality}]`;
    const format = input.merge
      ? `bestvideo${height}+bestaudio/best${height}`
      : `bestvideo${height}/bestvideo`;
    const args = [...YTDLP_PREFIX, '--no-playlist', '--newline', '--no-warnings', '-f', format];
    if (input.merge) args.push('--merge-output-format', 'mp4');
    if (LOCAL_FFMPEG) args.push('--ffmpeg-location', LOCAL_FFMPEG);
    args.push('-o', template, input.url);

    emit(id, { type: 'progress', progress: 3, message: input.merge ? '正在准备音视频流…' : '正在准备静音视频流…' });
    await run(YTDLP, args, {
      env: TOOL_ENV,
      onStdout: text => {
        const match = text.match(/\[download\]\s+([\d.]+)%/);
        if (match) emit(id, { type: 'progress', progress: Math.min(90, Math.round(Number(match[1]) * .82 + 6)), message: input.merge ? '正在下载音视频流…' : '正在下载静音视频…' });
      },
      onStderr: text => {
        if (/Merger|Merging formats|Fixup/.test(text)) emit(id, { type: 'progress', progress: 95, message: '正在合并音频与视频…' });
      }
    });

    const file = fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .find(item => fs.statSync(item).isFile() && !/\.(part|ytdl)$/i.test(item));
    if (!file) throw new Error('没有生成视频文件。');
    job.status = 'ready';
    job.file = file;
    job.name = path.basename(file);
    emit(id, { type: 'ready', progress: 100, name: job.name, downloadUrl: `/api/file/${id}` });
  } catch (error) {
    job.status = 'error';
    job.error = safeError(error);
    emit(id, { type: 'error', message: job.error });
  }
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : decodeURIComponent(req.url.split('?')[0]);
  const target = path.resolve(PUBLIC_DIR, `.${urlPath}`);
  if (!target.startsWith(PUBLIC_DIR + path.sep)) return json(res, 403, { error: '禁止访问' });
  fs.readFile(target, (error, data) => {
    if (error) return json(res, 404, { error: '页面不存在' });
    const ext = path.extname(target);
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/info') {
      const { url } = await readJson(req);
      if (!isYoutubeUrl(url)) return json(res, 400, { error: '请输入有效的 YouTube 链接（仅支持 HTTPS）。' });
      try { return json(res, 200, await getInfo(url)); }
      catch (error) { return json(res, 502, { error: safeError(error) }); }
    }
    if (req.method === 'POST' && req.url === '/api/download') {
      const input = await readJson(req);
      if (!isYoutubeUrl(input.url) || !ALLOWED_FORMATS.has(input.format) || !ALLOWED_QUALITIES.has(input.quality)) return json(res, 400, { error: '下载参数无效。' });
      const id = crypto.randomUUID();
      jobs.set(id, {
        status: 'working',
        createdAt: Date.now(),
        lastEvent: { type: 'progress', progress: 1, message: '任务已创建…' }
      });
      setImmediate(() => startDownload(id, input));
      return json(res, 202, { id });
    }
    if (req.method === 'POST' && req.url === '/api/subtitles') {
      const input = await readJson(req);
      if (!isYoutubeUrl(input.url)) return json(res, 400, { error: '请输入有效的 YouTube 链接。' });
      if (input.language && !/^[A-Za-z0-9._-]{1,32}$/.test(input.language)) return json(res, 400, { error: '字幕语言参数无效。' });
      const id = crypto.randomUUID();
      jobs.set(id, {
        status: 'working',
        createdAt: Date.now(),
        lastEvent: { type: 'progress', progress: 1, message: '任务已创建…' }
      });
      setImmediate(() => startSubtitleDownload(id, input));
      return json(res, 202, { id });
    }
    if (req.method === 'POST' && req.url === '/api/video') {
      const input = await readJson(req);
      if (!isYoutubeUrl(input.url) || !ALLOWED_VIDEO_QUALITIES.has(input.quality) || typeof input.merge !== 'boolean') {
        return json(res, 400, { error: '视频下载参数无效。' });
      }
      const id = crypto.randomUUID();
      jobs.set(id, {
        status: 'working',
        createdAt: Date.now(),
        lastEvent: { type: 'progress', progress: 1, message: '任务已创建…' }
      });
      setImmediate(() => startVideoDownload(id, input));
      return json(res, 202, { id });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/events/')) {
      const id = req.url.slice('/api/events/'.length);
      const job = jobs.get(id);
      if (!job) return json(res, 404, { error: '任务不存在' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      if (!clients.has(id)) clients.set(id, new Set());
      clients.get(id).add(res);
      // The task may finish before EventSource connects. Replay the latest
      // event so quick completions and early errors are never lost.
      res.write(`data: ${JSON.stringify(job.lastEvent)}\n\n`);
      req.on('close', () => clients.get(id)?.delete(res));
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/file/')) {
      const id = req.url.slice('/api/file/'.length);
      const job = jobs.get(id);
      if (!job || job.status !== 'ready' || !job.file) return json(res, 404, { error: '文件不存在或尚未完成' });
      const stat = fs.statSync(job.file);
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': stat.size, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.name)}` });
      const stream = fs.createReadStream(job.file);
      stream.pipe(res);
      stream.on('close', () => setTimeout(() => { fs.rm(job.dir, { recursive: true, force: true }, () => {}); jobs.delete(id); }, 30_000));
      return;
    }
    if (req.method === 'GET') return serveStatic(req, res);
    json(res, 405, { error: '不支持的请求方法' });
  } catch (error) { if (!res.headersSent) json(res, 500, { error: safeError(error) }); }
});

const cleanup = setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of jobs) if (job.createdAt < cutoff) {
    if (job.dir) fs.rm(job.dir, { recursive: true, force: true }, () => {});
    jobs.delete(id);
  }
}, 10 * 60 * 1000);
cleanup.unref();

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`Sonora 已启动：http://${HOST}:${PORT}`);
    console.log(`yt-dlp：${USE_LOCAL_YTDLP ? LOCAL_YTDLP : '系统 PATH'}`);
    console.log(`FFmpeg：${LOCAL_FFMPEG || '系统 PATH'}`);
    console.log(`CA 证书：${LOCAL_CA_BUNDLE || '系统默认'}`);
  });
}

module.exports = { isYoutubeUrl, vttToText, server };
