const $ = selector => document.querySelector(selector);
const form = $('#form'), urlInput = $('#url'), errorBox = $('#error');
let recognizedUrl = '';
let hasRecognizedSubtitles = false;
let taskRunning = false;

function error(message = '') { errorBox.textContent = message; }
function duration(seconds) { const m = Math.floor(seconds / 60), s = Math.floor(seconds % 60); return `${m}:${String(s).padStart(2, '0')}`; }
async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function mode() { return new FormData(form).get('mode'); }
function actionLabel() {
  if (mode() === 'subtitle') return '提取字幕';
  if (mode() === 'video') return '下载静音视频';
  return '提取音频';
}

function updateSubmitState() {
  const button = $('#submit');
  const needsRecognition = mode() === 'subtitle' && (!recognizedUrl || !hasRecognizedSubtitles);
  button.disabled = taskRunning || needsRecognition;
  if (!taskRunning) button.querySelector('span').textContent = needsRecognition ? '请先识别视频' : actionLabel();
}

function updateMode() {
  const subtitles = mode() === 'subtitle';
  const video = mode() === 'video';
  $('#audio-options').classList.toggle('hidden', subtitles || video);
  $('#subtitle-options').classList.toggle('hidden', !subtitles);
  $('#video-options').classList.toggle('hidden', !video);
  $('#merge-video').classList.toggle('hidden', !video);
  error();
  updateSubmitState();
}

function populateSubtitleLanguages(data) {
  const select = $('#subtitle-language');
  select.replaceChildren();
  const languages = data.subtitleLanguages || [];
  if (!languages.length) {
    select.append(new Option('该视频没有可用字幕', ''));
    select.disabled = true;
    return false;
  }
  for (const item of languages) {
    select.append(new Option(`${item.code} · ${item.manual ? '人工字幕' : '自动字幕'}`, item.code));
  }
  const preferred = [data.language, 'zh-Hans', 'zh-CN', 'zh-Hant', 'zh-TW', 'zh', 'en'];
  const selected = preferred.find(code => languages.some(item => item.code === code));
  if (selected) select.value = selected;
  select.disabled = false;
  return true;
}

async function recognize() {
  const data = await api('/api/info', { url: urlInput.value.trim() });
  recognizedUrl = urlInput.value.trim();
  $('#thumbnail').src = data.thumbnail;
  $('#title').textContent = data.title;
  $('#meta').textContent = `${data.channel} · ${duration(data.duration)}`;
  $('#video').classList.remove('hidden');
  const hasSubtitles = populateSubtitleLanguages(data);
  hasRecognizedSubtitles = hasSubtitles;
  updateSubmitState();
  if (mode() === 'subtitle' && !hasSubtitles) throw new Error('该视频没有可提取的人工字幕或自动字幕。');
  return data;
}

$('#preview').addEventListener('click', async () => {
  error(); $('#preview').disabled = true; $('#preview').textContent = '识别中…';
  try { await recognize(); } catch (e) { error(e.message); }
  finally { $('#preview').disabled = false; $('#preview').textContent = '识别视频'; }
});

form.querySelectorAll('input[name="mode"]').forEach(input => input.addEventListener('change', updateMode));
urlInput.addEventListener('input', () => {
  if (urlInput.value.trim() !== recognizedUrl) {
    recognizedUrl = '';
    hasRecognizedSubtitles = false;
    $('#subtitle-language').disabled = true;
    updateSubmitState();
  }
});
updateMode();

form.addEventListener('submit', async event => {
  event.preventDefault(); error(); $('#done').classList.add('hidden');
  const button = $('#submit'); taskRunning = true; updateSubmitState(); button.querySelector('span').textContent = '正在处理';
  $('#merge-video').disabled = true;
  try {
    const selectedMode = mode();
    const mergeVideo = selectedMode === 'video' && event.submitter?.id === 'merge-video';
    if (selectedMode === 'subtitle' && recognizedUrl !== urlInput.value.trim()) throw new Error('请先识别视频并选择字幕语言。');
    const body = selectedMode === 'subtitle'
      ? { url: urlInput.value.trim(), language: $('#subtitle-language').value }
      : selectedMode === 'video'
        ? { url: urlInput.value.trim(), quality: $('#video-quality').value, merge: mergeVideo }
        : { url: urlInput.value.trim(), format: new FormData(form).get('format'), quality: $('#quality').value };
    const endpoint = selectedMode === 'subtitle' ? '/api/subtitles' : selectedMode === 'video' ? '/api/video' : '/api/download';
    const { id } = await api(endpoint, body);
    $('#progress').classList.remove('hidden');
    const source = new EventSource(`/api/events/${id}`);
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.type === 'progress') { $('#status').textContent = event.message; $('#percent').textContent = `${event.progress}%`; $('#bar').style.width = `${event.progress}%`; }
      if (event.type === 'ready') {
        source.close(); $('#progress').classList.add('hidden'); $('#done').classList.remove('hidden');
        $('#done-title').textContent = selectedMode === 'subtitle' ? '字幕文本已准备好' : selectedMode === 'video' ? (mergeVideo ? '音视频已合并' : '静音视频已准备好') : '音频已准备好';
        $('#filename').textContent = event.name; $('#file').href = event.downloadUrl; taskRunning = false; $('#merge-video').disabled = false; updateSubmitState(); button.querySelector('span').textContent = '再提取一个';
      }
      if (event.type === 'error') { source.close(); throwUi(event.message); }
    };
    source.onerror = () => { source.close(); throwUi('与服务器的连接已中断。'); };
  } catch (e) { throwUi(e.message); }
  function throwUi(message) { error(message); $('#progress').classList.add('hidden'); taskRunning = false; $('#merge-video').disabled = false; updateSubmitState(); }
});
