/** Local-only PNG/APNG thumbnail conversion. No external codecs or uploads. */
(function () {
  'use strict';
  const MAX_BYTES = 900000;
  const MAX_INPUT = 50 * 1024 * 1024;
  const MAX_SECONDS = 6;
  const WIDTH = 480;
  const HEIGHT = 270;
  const FPS = 12;
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  function check(signal) {
    if (signal) signal.throwIfAborted();
  }
  function u32(...values) {
    const data = new Uint8Array(values.length * 4);
    const view = new DataView(data.buffer);
    values.forEach((value, i) => view.setUint32(i * 4, value));
    return data;
  }
  function chunk(type, data) {
    const out = new Uint8Array(data.length + 12);
    out.set(u32(data.length));
    out.set(Array.from(type, (c) => c.charCodeAt(0)), 4);
    out.set(data, 8);
    let crc = 0xffffffff;
    for (let i = 4; i < out.length - 4; i++) crc = crcTable[(crc ^ out[i]) & 255] ^ (crc >>> 8);
    out.set(u32((crc ^ 0xffffffff) >>> 0), out.length - 4);
    return out;
  }
  function canvas(width, height) {
    const result = document.createElement('canvas');
    result.width = width;
    result.height = height;
    return result;
  }
  function draw(target, source, width, height) {
    if (!width || !height || width * height > 16777216) {
      throw new Error('원본 해상도가 너무 크거나 잘못되었습니다. 1,600만 화소 이하 파일을 선택하세요.');
    }
    const ctx = target.getContext('2d');
    const scale = Math.min(target.width / width, target.height / height);
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(source, (target.width - width * scale) / 2,
      (target.height - height * scale) / 2, width * scale, height * scale);
  }
  function waitMedia(media, event, signal, start) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('미디어를 읽는 시간이 초과되었습니다. 다른 형식으로 저장해 보세요.')), 15000);
      function finish(error) {
        clearTimeout(timer);
        media.removeEventListener(event, done);
        media.removeEventListener('error', failed);
        if (signal) signal.removeEventListener('abort', aborted);
        if (error) reject(error); else resolve();
      }
      function done() { finish(); }
      function failed() { finish(new Error('Chrome에서 읽을 수 없는 미디어입니다. PNG, GIF 또는 MP4/WebM을 사용하세요.')); }
      function aborted() { finish(signal.reason || new DOMException('취소됨', 'AbortError')); }
      media.addEventListener(event, done, { once: true });
      media.addEventListener('error', failed, { once: true });
      if (signal) signal.addEventListener('abort', aborted, { once: true });
      if (signal && signal.aborted) { aborted(); return; }
      try { start(); } catch (error) { finish(error); }
    });
  }
  async function readVideo(file, signal, progress) {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const frames = [];
    video.muted = true;
    video.preload = 'auto';
    try {
      await waitMedia(video, 'loadeddata', signal, () => { video.src = url; video.load(); });
      // Browser-recorded WebM often omits its duration header. Seeking to the end
      // lets Chromium discover the duration before sampling from the beginning.
      if (video.duration === Infinity) {
        await waitMedia(video, 'seeked', signal, () => { video.currentTime = 1e10; });
      }
      if (!Number.isFinite(video.duration) || video.duration <= 0) throw new Error('영상 길이를 읽을 수 없습니다. MP4로 다시 저장해 주세요.');
      const duration = Math.min(video.duration, MAX_SECONDS);
      const target = canvas(WIDTH, HEIGHT);
      for (let i = 0; i < Math.ceil(duration * FPS); i++) {
        check(signal);
        const time = i / FPS;
        if (Math.abs(video.currentTime - time) > 0.0001) {
          await waitMedia(video, 'seeked', signal, () => { video.currentTime = time; });
        }
        draw(target, video, video.videoWidth, video.videoHeight);
        frames.push({ pixels: target.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT),
          duration: Math.min(1 / FPS, duration - time) * 1000 });
        progress('영상 읽는 중 ' + Math.round((i + 1) / Math.ceil(duration * FPS) * 100) + '%');
      }
      return { frames, truncated: video.duration > MAX_SECONDS, animated: true };
    } finally {
      video.pause();
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    }
  }
  async function readImage(file, type, signal, progress) {
    if (!window.ImageDecoder || !await window.ImageDecoder.isTypeSupported(type)) {
      throw new Error('이 Chrome에서는 해당 이미지 변환을 지원하지 않습니다. Chrome을 업데이트해 주세요.');
    }
    check(signal);
    const decoder = new window.ImageDecoder({ data: await file.arrayBuffer(), type, preferAnimation: true });
    const abort = () => decoder.close();
    if (signal) signal.addEventListener('abort', abort, { once: true });
    const frames = [];
    try {
      check(signal);
      await decoder.tracks.ready;
      const track = decoder.tracks.selectedTrack;
      if (!track || !track.frameCount) throw new Error('이미지 프레임을 읽을 수 없습니다.');
      const target = canvas(WIDTH, HEIGHT);
      let elapsed = 0;
      let nextSample = 0;
      let index = 0;
      // Decode sequentially for GIF disposal/compositing; retain only sampled, resized frames.
      for (; index < track.frameCount && elapsed < MAX_SECONDS * 1000 && index < 600; index++) {
        check(signal);
        const { image } = await decoder.decode({ frameIndex: index });
        try {
          const delay = track.frameCount === 1 ? 100 : Math.max(10, (image.duration || 100000) / 1000);
          const end = Math.min(MAX_SECONDS * 1000, elapsed + delay);
          if (!frames.length || elapsed >= nextSample) {
            draw(target, image, image.displayWidth, image.displayHeight);
            frames.push({ pixels: target.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT), duration: 0 });
            nextSample = elapsed + 1000 / FPS;
          }
          frames[frames.length - 1].duration += end - elapsed;
          elapsed = end;
        } finally { image.close(); }
        progress('이미지 읽는 중 ' + (index + 1) + '프레임');
      }
      return { frames, truncated: index < track.frameCount, animated: track.frameCount > 1 || type === 'image/gif' };
    } finally {
      if (signal) signal.removeEventListener('abort', abort);
      decoder.close();
    }
  }
  async function encode(frames, width, height, stride, animated, signal, progress) {
    const ihdr = new Uint8Array(13);
    ihdr.set(u32(width, height));
    ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, identical format for every frame.
    const count = Math.ceil(frames.length / stride);
    const parts = [signature, chunk('IHDR', ihdr)];
    if (animated) parts.push(chunk('acTL', u32(count, 0)));
    let sequence = 0;
    let size = parts.reduce((sum, part) => sum + part.length, 0);
    const source = canvas(WIDTH, HEIGHT);
    const target = canvas(width, height);
    for (let i = 0; i < frames.length; i += stride) {
      check(signal);
      source.getContext('2d').putImageData(frames[i].pixels, 0, 0);
      draw(target, source, WIDTH, HEIGHT);
      const pixels = target.getContext('2d').getImageData(0, 0, width, height).data;
      const row = width * 4;
      const raw = new Uint8Array((row + 1) * height);
      for (let y = 0; y < height; y++) {
        raw[y * (row + 1)] = 1; // PNG Sub filter improves photographic compression.
        for (let x = 0; x < row; x++) raw[y * (row + 1) + x + 1] =
          pixels[y * row + x] - (x >= 4 ? pixels[y * row + x - 4] : 0);
      }
      const compressed = new Uint8Array(await new Response(
        new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))
      ).arrayBuffer());
      check(signal);
      if (animated) {
        const control = new Uint8Array(26);
        control.set(u32(sequence++, width, height, 0, 0));
        const delay = frames.slice(i, i + stride).reduce((sum, frame) => sum + frame.duration, 0);
        new DataView(control.buffer).setUint16(20, Math.max(1, Math.round(delay)));
        new DataView(control.buffer).setUint16(22, 1000);
        // Full-canvas frames: dispose NONE, blend SOURCE (including transparent pixels).
        parts.push(chunk('fcTL', control));
        size += 38;
      }
      const data = i === 0 ? compressed : new Uint8Array(compressed.length + 4);
      if (i !== 0) { data.set(u32(sequence++)); data.set(compressed, 4); }
      const part = chunk(i === 0 ? 'IDAT' : 'fdAT', data);
      parts.push(part);
      size += part.length;
      if (size + 12 > MAX_BYTES) return null;
      progress('PNG 압축 중 ' + Math.round((i + stride) / frames.length * 100) + '%');
    }
    parts.push(chunk('IEND', new Uint8Array()));
    return new Blob(parts, { type: 'image/png' });
  }
  async function convert(file, { signal, progress = () => {} } = {}) {
    if (!file || !file.size || file.size > MAX_INPUT) throw new Error('비어 있지 않은 50MiB 이하 파일을 선택하세요.');
    check(signal);
    const name = file.name || '';
    const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    let type = file.type;
    if (head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71) type = 'image/png';
    else if (head[0] === 71 && head[1] === 73 && head[2] === 70) type = 'image/gif';
    else if (head[0] === 255 && head[1] === 216) type = 'image/jpeg';
    else if (head[0] === 82 && head[8] === 87 && head[9] === 69) type = 'image/webp';
    let decoded;
    if (/^video\//.test(type) || /\.(mp4|webm|mov|m4v)$/i.test(name)) decoded = await readVideo(file, signal, progress);
    else if (['image/png', 'image/gif', 'image/jpeg', 'image/webp'].includes(type)) decoded = await readImage(file, type, signal, progress);
    else throw new Error('PNG, JPEG, WebP, GIF 또는 Chrome에서 재생 가능한 영상을 선택하세요.');
    const profiles = [[480, 270, 1], [384, 216, 2], [320, 180, 3], [240, 135, 4], [160, 90, 6]];
    try {
      for (const [width, height, stride] of profiles) {
        check(signal);
        const blob = await encode(decoded.frames, width, height, stride, decoded.animated, signal, progress);
        if (blob) return { blob, width, height, frames: Math.ceil(decoded.frames.length / stride),
          duration: decoded.frames.reduce((sum, frame) => sum + frame.duration, 0) / 1000,
          animated: decoded.animated, truncated: decoded.truncated, reduced: width !== WIDTH };
        progress('용량을 줄이기 위해 해상도와 프레임 수를 조정합니다…');
      }
      throw new Error('900KB 이하로 줄이지 못했습니다. 더 짧고 단순한 영상을 선택하세요.');
    } finally { decoded.frames.length = 0; }
  }
  window.EntryDebuggerThumbnailMedia = Object.freeze({ convert, MAX_BYTES });
})();
