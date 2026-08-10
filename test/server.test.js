const test = require('node:test');
const assert = require('node:assert/strict');
const { isYoutubeUrl, vttToText } = require('../server');

test('accepts supported YouTube HTTPS URLs', () => {
  assert.equal(isYoutubeUrl('https://youtu.be/abc'), true);
  assert.equal(isYoutubeUrl('https://music.youtube.com/watch?v=abc'), true);
});

test('rejects unsafe or unrelated URLs', () => {
  assert.equal(isYoutubeUrl('http://youtube.com/watch?v=abc'), false);
  assert.equal(isYoutubeUrl('https://youtube.com.example.org/video'), false);
  assert.equal(isYoutubeUrl('not a url'), false);
});

test('converts WebVTT captions to readable text', () => {
  const input = 'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c>你好 &amp; welcome</c>\n\n00:00:03.000 --> 00:00:05.000\n你好 &amp; welcome\n下一句';
  assert.equal(vttToText(input), '你好 & welcome 下一句。');
});

test('adds paragraphs from subtitle timing without changing words', () => {
  const input = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n这是第一句\n\n00:00:02.200 --> 00:00:03.000\n这是第二句\n\n00:00:05.000 --> 00:00:06.000\n这是新段落';
  assert.equal(vttToText(input), '这是第一句，这是第二句。\n这是新段落。');
});
