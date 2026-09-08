'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist/entry-debugger-extension-release');
const { chromium } = require(require.resolve('playwright', {
  paths: [rootDir, path.resolve(rootDir, '../../apps/MYentry-game')]
}));
// Generated red (200ms) / blue (300ms) GIF. No downloaded user media.
const gif = 'R0lGODlhEAAJAIEAAP8AAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQIFAAAACwAAAAAEAAJAAAIFgABCBxIsKDBgwgTKlzIsKHDhxARBgQAIfkECB4AAAAsAAAAABAACQCBAAD/AAAAAAAAAAAACBYAAQgcSLCgwYMIEypcyLChw4cQEQYEADs=';
function inspectPng(base64) {
  const bytes = Buffer.from(base64, 'base64');
  assert.strictEqual(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  let sequence = 0;
  let declaredFrames = null;
  let width;
  let height;
  const frames = [];
  const delays = [];
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    let crc = 0xffffffff;
    for (const value of bytes.subarray(offset + 4, offset + 8 + size)) {
      crc ^= value;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    assert.strictEqual((crc ^ 0xffffffff) >>> 0, bytes.readUInt32BE(offset + 8 + size), type + ' CRC');
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'acTL') declaredFrames = data.readUInt32BE(0);
    if (type === 'fcTL') {
      assert.strictEqual(data.readUInt32BE(0), sequence++);
      assert.strictEqual(data.readUInt32BE(4), width);
      assert.strictEqual(data.readUInt32BE(8), height);
      delays.push(data.readUInt16BE(20) / data.readUInt16BE(22));
      frames.push([]);
    }
    if (type === 'IDAT') { if (!frames.length) frames.push([]); frames.at(-1).push(data); }
    if (type === 'fdAT') {
      assert.strictEqual(data.readUInt32BE(0), sequence++);
      frames.at(-1).push(data.subarray(4));
    }
    offset += size + 12;
  }
  assert.strictEqual(offset, bytes.length);
  if (declaredFrames !== null) assert.strictEqual(frames.length, declaredFrames);
  const centers = frames.map((parts) => {
    const raw = zlib.inflateSync(Buffer.concat(parts));
    const row = width * 4;
    assert.strictEqual(raw.length, (row + 1) * height);
    for (let y = 0; y < height; y++) {
      assert.strictEqual(raw[y * (row + 1)], 1);
      for (let x = 4; x < row; x++) {
        const index = y * (row + 1) + 1 + x;
        raw[index] = (raw[index] + raw[index - 4]) & 255;
      }
    }
    const center = Math.floor(height / 2) * (row + 1) + 1 + Math.floor(width / 2) * 4;
    return Array.from(raw.subarray(center, center + 4));
  });
  return { size: bytes.length, width, height, centers, delays, declaredFrames };
}
async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-thumbnail-smoke-'));
  let context;
  try {
    context = await chromium.launchPersistentContext(profile, {
      viewport: { width: 1600, height: 1200 },
      executablePath: process.env.ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE,
      headless: false, ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir]
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const media = await context.newPage();
    await media.route('https://playentry.org/thumbnail-media-fixture', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>Local media fixture</title>'
    }));
    await media.goto('https://playentry.org/thumbnail-media-fixture');
    await media.addScriptTag({ path: path.join(extensionDir, 'thumbnail-media.js') });
    const converted = await media.evaluate(async (gifBase64) => {
      const api = window.EntryDebuggerThumbnailMedia;
      const base64 = (blob) => new Promise((resolve) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.readAsDataURL(blob);
      });
      const summarize = async (value) => ({ ...value, blob: undefined, base64: await base64(value.blob) });
      const gifBytes = Uint8Array.from(atob(gifBase64), (c) => c.charCodeAt(0));
      const gifResult = await api.convert(new File([gifBytes], 'test.gif', { type: 'image/gif' }));
      const pngResult = await api.convert(new File([gifResult.blob], 'test.apng', { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 270;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 480, 270);
      const staticBlob = await new Promise((resolve) => { canvas.toBlob(resolve); });
      const staticResult = await api.convert(new File([staticBlob], 'transparent.png', { type: 'image/png' }));
      const errors = [];
      for (const file of [new File([], 'empty.gif'), new File(['broken'], 'broken.gif', { type: 'image/gif' }),
        new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.png')]) {
        try { await api.convert(file); errors.push(false); } catch (error) { errors.push(true); }
      }
      const abort = new AbortController(); abort.abort();
      try { await api.convert(new File([gifBytes], 'cancel.gif'), { signal: abort.signal }); errors.push(false); }
      catch (error) { errors.push(error.name === 'AbortError'); }
      // Seven seconds of high-entropy WebM exercises video decoding, truncation and budget reduction.
      const stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 5000000 });
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      let seed = 1;
      function noise() {
        const data = ctx.createImageData(480, 270);
        for (let i = 0; i < data.data.length; i += 4) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          data.data[i] = seed & 255; data.data[i + 1] = (seed >>> 8) & 255;
          data.data[i + 2] = (seed >>> 16) & 255; data.data[i + 3] = 255;
        }
        ctx.putImageData(data, 0, 0);
      }
      noise(); recorder.start();
      const timer = setInterval(noise, 80);
      await new Promise((resolve) => { setTimeout(resolve, 7200); });
      await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });
      clearInterval(timer); stream.getTracks().forEach((track) => track.stop());
      const video = new File(chunks, 'noise.webm', { type: 'video/webm' });
      const videoResult = await api.convert(video, { signal: AbortSignal.timeout(90000) });
      return { gif: await summarize(gifResult), apng: await summarize(pngResult),
        static: await summarize(staticResult), video: await summarize(videoResult), errors };
    }, gif);
    const gifPng = inspectPng(converted.gif.base64);
    assert.deepStrictEqual(gifPng.centers, [[255, 0, 0, 255], [0, 0, 255, 255]]);
    assert.deepStrictEqual(gifPng.delays, [0.2, 0.3]);
    assert.deepStrictEqual(inspectPng(converted.apng.base64).centers, gifPng.centers);
    assert.deepStrictEqual(inspectPng(converted.static.base64).centers, [[0, 0, 0, 0]]);
    assert.strictEqual(converted.static.animated, false);
    const videoPng = inspectPng(converted.video.base64);
    assert(videoPng.size <= 900000);
    assert(converted.video.reduced && converted.video.truncated);
    assert(videoPng.declaredFrames > 1);
    assert(Math.abs(videoPng.delays.reduce((sum, value) => sum + value, 0) - 6) < 0.03);
    assert(converted.errors.every(Boolean));
    console.log('[smoke-thumbnail] GIF/APNG pixels and timing, transparency, invalid files, cancellation, video size reduction passed');
    // Real Entry + production content scripts. No project save or network upload is performed.
    const page = await context.newPage();
    await worker.evaluate(() => chrome.storage.local.set({ enabled: true, debuggerTabEnabled: true, labTabEnabled: true }));
    await page.goto(process.env.ENTRY_DEBUGGER_SMOKE_URL || 'https://playentry.org/ws/590e746f150c3963bf86078e', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.propertyTabdebugging', { timeout: 60000 });
    // Entry's first-visit guide overlays the editor in a fresh profile.
    await page.addStyleTag({ content: '.tooltipGuide { display: none !important; }' });
    await page.locator('.propertyTabdebugging').click();
    await page.locator('.ed-subtab[data-tab="others"]').click();
    await page.evaluate(() => { window.__thumbnailOriginal = Entry.canvas_.toDataURL; });
    const input = page.locator('#ed-thumbnail-tool input');
    await input.setInputFiles({ name: 'test.gif', mimeType: 'image/gif', buffer: Buffer.from(gif, 'base64') });
    const apply = page.locator('#ed-thumbnail-tool [data-action="apply"]');
    await page.waitForFunction(() => !document.querySelector('#ed-thumbnail-tool [data-action="apply"]').disabled);
    const artifactDir = path.join(rootDir, 'dist/thumbnail-review');
    fs.mkdirSync(artifactDir, { recursive: true });
    await page.locator('#ed-thumbnail-tool').screenshot({ path: path.join(artifactDir, 'thumbnail-preview.png') });
    await apply.click();
    await page.waitForFunction(() => document.querySelector('.ed-thumbnail-status').textContent.includes('적용 준비 완료'));
    const applied = await page.evaluate(() => Entry.canvas_.toDataURL().split(',')[1]);
    assert.deepStrictEqual(inspectPng(applied).centers, gifPng.centers);
    await page.locator('#ed-thumbnail-tool [data-action="reset"]').click();
    await page.waitForFunction(() => Entry.canvas_.toDataURL === window.__thumbnailOriginal);
    await input.setInputFiles({ name: 'test.gif', mimeType: 'image/gif', buffer: Buffer.from(gif, 'base64') });
    await page.waitForFunction(() => !document.querySelector('#ed-thumbnail-tool [data-action="apply"]').disabled);
    await apply.click();
    await page.waitForFunction(() => Entry.canvas_.toDataURL !== window.__thumbnailOriginal);
    await page.locator('#ed-settings-tab-btn').click();
    await page.locator('.ed-lab-switch[aria-label="실험실 탭"]').click();
    await page.waitForFunction(() => Entry.canvas_.toDataURL === window.__thumbnailOriginal);
    console.log(JSON.stringify({ gif: { ...gifPng, centers: undefined }, video: { bytes: videoPng.size,
      width: videoPng.width, frames: videoPng.declaredFrames }, malformedAndCancel: true,
      realEntry: 'GIF selection, preview, apply, reset, lab-disable restoration passed; no save' }, null, 2));
  } finally {
    if (context) await context.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
