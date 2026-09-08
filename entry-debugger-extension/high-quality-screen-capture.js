/**
 * Capture a paused Entry display tree, without ticking the project.
 * Rendering principle reference: muno9748/BetterEntryScreen @ 76265ba7.
 * Independently scoped capture lifecycle; MIT notice in THIRD_PARTY_NOTICES.txt.
 */
(function () {
  'use strict';
  if (window.__ENTRY_DEBUGGER_SCREEN_CAPTURE_INJECTED__) return;
  window.__ENTRY_DEBUGGER_SCREEN_CAPTURE_INJECTED__ = true;
  const Bridge = window.EntryDebuggerPageBridge;
  const Adapter = window.EntryDebuggerEntryAdapter;
  const Patches = window.EntryDebuggerPatchRegistry;
  const MAX_PIXELS = 8294400;
  const MAX_ASSET_PIXELS = 32 * 1024 * 1024;
  const TIMEOUT = 15000;
  const LABEL = '캡처하기';
  const decorations = new Map();
  let enabled = false;
  let timer = null;
  let active = null;
  let style = null;
  const getEntry = () => Adapter.getEntry();
  const inWorkspace = () => /^\/ws\//.test(location.pathname);

  function restoreButton(button, saved) {
    // Keep the native element (and its handlers), including Entry's new resume label.
    if (button.parentNode === saved.group && saved.group.parentNode) saved.group.replaceWith(button);
    saved.capture.remove();
    saved.group.remove();
    decorations.delete(button);
  }

  function syncButtons() {
    const entry = getEntry();
    const engine = entry && entry.engine;
    const buttons = enabled && inWorkspace() && engine && engine.state === 'run'
      ? [engine.pauseButton, engine.pauseButtonFull].filter((b) => b && b.isConnected) : [];
    for (const [button, saved] of decorations) {
      if (!buttons.includes(button) || button.parentNode !== saved.group) restoreButton(button, saved);
    }
    for (const button of buttons) {
      if (decorations.has(button)) continue;
      const group = document.createElement('span');
      group.className = 'ed-screen-controls ' + (button === engine.pauseButtonFull ? 'ed-screen-controls-full' : 'ed-screen-controls-normal');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', '일시정지 및 화면 캡처');
      const captureButton = document.createElement('button');
      captureButton.type = 'button';
      captureButton.className = 'ed-screen-capture';
      captureButton.textContent = LABEL;
      captureButton.title = LABEL;
      captureButton.setAttribute('aria-label', LABEL);
      button.before(group);
      group.append(button, captureButton);
      decorations.set(button, { group, capture: captureButton });
    }
    // Registry wrappers are installed once per engine and inert while OFF.
    // No replacement of another feature's togglePause/toggleRun wrappers.
    if (enabled && engine) {
      Patches.patchMethod(engine, 'setPauseButton', 'screen-capture', (original) => function () {
        const result = original.apply(this, arguments);
        syncButtons();
        return result;
      });
    }
  }

  function notify(ok, message) {
    Bridge.post('SCREEN_CAPTURE_RESULT', { success: ok, message });
  }

  function check(job) {
    if (job.controller.signal.aborted) throw job.controller.signal.reason;
    if (!enabled || !inWorkspace() || location.href !== job.url || getEntry() !== job.entry ||
        job.entry.engine !== job.engine || job.entry.stage !== job.stage ||
        job.stage.canvas !== job.root || job.entry.scene?.selectedScene !== job.scene ||
        job.entry.projectId !== job.project || job.engine.state !== 'pause') {
      throw new Error('화면 또는 실행 상태가 변경되어 캡처를 취소했습니다.');
    }
    if (performance.now() > job.deadline) throw new Error('캡처 제한 시간(15초)을 초과했습니다.');
  }

  function sceneState(entry) {
    const entities = [];
    entry.container.mapEntityIncludeCloneOnScene((entity) => {
      entities.push([entity.id, entity.picture?.id, entity.toJSON(), entity.effect]);
    });
    return JSON.stringify([entities,
      entry.variableContainer.variables_.map((v) => [v.id_, v.getValue()]),
      entry.variableContainer.lists_.map((v) => [v.id_, v.array_])]);
  }

  function checkScene(job) {
    check(job);
    if (sceneState(job.entry) !== job.state) {
      throw new Error('일시정지 후 오브젝트나 변수 값이 변경되어 캡처를 취소했습니다.');
    }
  }

  function wait(job, promise) {
    check(job);
    return new Promise((resolve, reject) => {
      const signal = job.controller.signal;
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  function walk(root) {
    const nodes = [];
    function visit(node) {
      if (!node || node.visible === false || node.alpha === 0) return;
      nodes.push(node);
      if (nodes.length > 20000) throw new Error('화면 요소가 너무 많아 캡처할 수 없습니다.');
      (node.children || []).forEach(visit);
    }
    visit(root);
    return nodes;
  }

  function sizeFor(job) {
    const root = job.root;
    const view = root.canvas;
    const renderer = job.stage._app.renderer;
    const screenWidth = renderer ? renderer.screen.width : view.width;
    const screenHeight = renderer ? renderer.screen.height : view.height;
    const logicalWidth = screenWidth / Math.abs(root.scaleX);
    const logicalHeight = screenHeight / Math.abs(root.scaleY);
    if (![logicalWidth, logicalHeight].every((n) => Number.isFinite(n) && n > 0)) {
      throw new Error('실행화면의 크기와 배율을 확인할 수 없습니다.');
    }
    let limit = 8192;
    if (renderer) {
      if (!renderer.gl || renderer.gl.isContextLost()) throw new Error('WebGL 컨텍스트가 손실되었습니다.');
      const gl = renderer.gl;
      limit = Math.min(limit, gl.getParameter(gl.MAX_TEXTURE_SIZE), gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
    }
    // Preserve the displayed composition, including non-default aspect ratios.
    const factor = Math.min(4 / Math.abs(root.scaleX),
      Math.sqrt(MAX_PIXELS / (screenWidth * screenHeight)), limit / screenWidth, limit / screenHeight);
    const width = Math.floor(screenWidth * factor);
    const height = Math.floor(screenHeight * factor);
    if (width < 1 || height < 1) throw new Error('안전한 캡처 해상도를 만들 수 없습니다.');
    return { width, height, factor, screenWidth, screenHeight, limit };
  }

  function allocate(job, width, height) {
    width = Math.ceil(width); height = Math.ceil(height);
    if (!Number.isFinite(width * height) || width < 1 || height < 1 ||
        width > job.size.limit || height > job.size.limit ||
        job.assetPixels + width * height > MAX_ASSET_PIXELS) {
      throw new Error('원본 이미지 처리에 필요한 메모리가 안전 한도를 넘습니다.');
    }
    job.assetPixels += width * height;
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    job.canvases.push(canvas);
    return canvas;
  }

  async function loadImage(job, url) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    job.images.push(img);
    await wait(job, new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('원본 이미지 로딩 실패: 접근 권한·CORS 또는 파일 주소를 확인하세요.'));
      img.src = url;
    }));
    if (!img.naturalWidth || !img.naturalHeight) throw new Error('원본 이미지가 비어 있습니다.');
    job.assetPixels += img.naturalWidth * img.naturalHeight;
    if (job.assetPixels > MAX_ASSET_PIXELS) throw new Error('원본 이미지가 메모리 한도를 넘습니다.');
    return img;
  }

  async function prepare(job) {
    job.nodes = walk(job.root);
    // FontFaceSet.ready alone does not start faces used only by canvas text.
    const fonts = new Set();
    for (const node of job.nodes) {
      if (typeof node.font === 'string') fonts.add(node.font);
      if (typeof node.style?.toFontString === 'function') fonts.add(node.style.toFontString());
    }
    if (document.fonts) {
      await wait(job, Promise.all([...fonts].map((font) => document.fonts.load(font))));
      await wait(job, document.fonts.ready);
      if ([...fonts].some((font) => !document.fonts.check(font))) throw new Error('글꼴이 준비되지 않았습니다.');
    }
    for (const node of job.nodes) {
      const image = node.image;
      if (image instanceof HTMLImageElement && (!image.complete || !image.naturalWidth)) {
        await wait(job, image.decode());
      }
    }
    const entities = [];
    job.entry.container.mapEntityIncludeCloneOnScene((entity) => { entities.push(entity); });
    job.replacements = [];
    const imageCache = new Map();
    for (const entity of entities) {
      check(job);
      const node = entity.object;
      const pic = entity.picture;
      if (!job.nodes.includes(node) || !pic || entity.type !== 'sprite') continue;
      const texture = node.internal_getOriginalTex?.() || node.texture;
      const image = node.image;
      if (texture && (!texture.valid || !texture.baseTexture?.valid)) {
        throw new Error('모양 텍스처가 아직 준비되지 않았습니다. 잠시 뒤 다시 캡처하세요.');
      }
      const width = texture ? texture.orig.width : image?.width;
      const height = texture ? texture.orig.height : image?.height;
      if (!width || !height) throw new Error('모양 원본의 크기를 확인할 수 없습니다.');
      const svg = pic.imageType === 'svg';
      // Ordinary bitmaps already retain the original source in Canvas2D. In
      // WebGL, use the original asset to avoid atlas downsampling.
      if (!svg && !texture) continue;
      let url = pic.fileurl;
      if (!url && typeof pic.filename === 'string' && /^[\w-]+$/.test(pic.filename)) {
        const id = pic.filename;
        url = (job.entry.defaultPath || '') + '/uploads/' + id.slice(0, 2) + '/' +
          id.slice(2, 4) + '/image/' + id + (svg ? '.svg' : '.png');
      }
      if (!url) throw new Error('모양 원본 주소를 확인할 수 없습니다.');
      const parsed = new URL(url, location.href);
      if (!['https:', 'http:', 'data:', 'blob:'].includes(parsed.protocol)) throw new Error('지원하지 않는 이미지 주소입니다.');
      let source = imageCache.get(parsed.href);
      if (!source) {
        source = await loadImage(job, parsed.href);
        imageCache.set(parsed.href, source);
      }
      const matrix = node.getConcatenatedMatrix?.();
      const world = matrix || node.worldTransform;
      const scale = world ? Math.max(Math.hypot(world.a, world.b), Math.hypot(world.c, world.d)) : 1;
      const factor = Math.max(1, job.size.factor * scale);
      // Rasterize the SVG at target density. Bitmap detail is still bounded by
      // its natural dimensions; do not spend memory manufacturing extra pixels.
      const density = svg ? factor : Math.min(factor, Math.max(source.naturalWidth / width, source.naturalHeight / height));
      const canvas = allocate(job, width * density, height * density);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('이미지 렌더링 메모리가 부족합니다.');
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      // Fail before touching the live renderer if an asset tainted the canvas.
      ctx.getImageData(0, 0, 1, 1);
      job.replacements.push({ node, canvas, width, height, texture });
    }
    check(job);
  }

  function saveProperties(undo, owner, keys) {
    const saved = keys.map((key) => [key, Object.getOwnPropertyDescriptor(owner, key)]);
    undo.push(() => {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(owner, key, descriptor);
        else delete owner[key];
      }
    });
  }

  function restoreAll(undo) {
    let failure;
    for (const restore of undo.reverse()) {
      try { restore(); } catch (error) { failure = failure || error; }
    }
    if (failure) throw failure;
  }

  function render2D(job, output) {
    const undo = [];
    try {
      for (const { node, canvas, width, height } of job.replacements) {
        saveProperties(undo, node, ['draw']);
        const original = node.draw;
        node.draw = function (ctx, ignoreCache) {
          if (!ignoreCache && this.cacheCanvas) return original.call(this, ctx, ignoreCache);
          ctx.drawImage(canvas, 0, 0, width, height);
          return true;
        };
      }
      // Rebuild effect caches from their source at capture resolution. Do not
      // uncache() existing managers: their canvases belong to the live scene.
      for (const node of [...job.nodes].reverse()) {
        if (!node.cacheCanvas) continue;
        const cache = node.bitmapCache || { x: node._cacheOffsetX, y: node._cacheOffsetY,
          width: node._cacheWidth, height: node._cacheHeight };
        saveProperties(undo, node, ['cacheCanvas', 'bitmapCache', 'cacheID', '_cacheScale',
          '_cacheWidth', '_cacheHeight', '_cacheOffsetX', '_cacheOffsetY', '_cacheDataURLID', '_cacheDataURL']);
        node.cacheCanvas = null;
        node.bitmapCache = null;
        if (node.filters?.length) {
          if (!cache.width || !cache.height) throw new Error('지원하지 않는 효과 캐시 형식입니다.');
          const matrix = node.getConcatenatedMatrix();
          const scale = Math.max(1, job.size.factor * Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)));
          if (cache.width * scale > job.size.limit || cache.height * scale > job.size.limit ||
              cache.width * cache.height * scale * scale + job.assetPixels > MAX_ASSET_PIXELS) {
            throw new Error('효과 캐시가 메모리 한도를 넘습니다.');
          }
          undo.push(() => {
            if (node.bitmapCache) node.bitmapCache.release();
            else if (node.cacheCanvas) node.cacheCanvas.width = node.cacheCanvas.height = 1;
          });
          node.cache(cache.x, cache.y, cache.width, cache.height, scale);
          job.assetPixels += node.cacheCanvas.width * node.cacheCanvas.height;
          if (job.assetPixels > MAX_ASSET_PIXELS) throw new Error('효과 캐시가 메모리 한도를 넘습니다.');
        }
      }
      const ctx = output.getContext('2d');
      if (!ctx) throw new Error('출력 캔버스를 만들 수 없습니다.');
      ctx.scale(output.width / job.size.screenWidth, output.height / job.size.screenHeight);
      job.root.updateContext(ctx);
      job.root.draw(ctx, true); // No Stage.update(), display tick, or engine update.
    } finally {
      restoreAll(undo);
    }
  }

  function renderWebGL(job, output) {
    const renderer = job.stage._app.renderer;
    const undo = [];
    const textures = [];
    const resolution = renderer.resolution;
    const view = renderer.view;
    const css = view.getAttribute('style');
    try {
      const rootX = job.root.x, rootY = job.root.y;
      const rootScaleX = job.root.scale.x, rootScaleY = job.root.scale.y;
      undo.push(() => {
        job.root.x = rootX; job.root.y = rootY;
        job.root.scale.set(rootScaleX, rootScaleY);
      });
      // Render in physical pixel coordinates. PIXI 5's filter bounds round in
      // logical coordinates; resolution-only scaling stretches narrow SVG
      // stripes when a filter's 85.33px frame is rounded to 86px.
      job.root.x *= output.width / job.size.screenWidth;
      job.root.y *= output.height / job.size.screenHeight;
      job.root.scale.set(rootScaleX * output.width / job.size.screenWidth,
        rootScaleY * output.height / job.size.screenHeight);
      const filters = new Set();
      for (const node of job.nodes) {
        if (typeof node.updateText === 'function') {
          const oldResolution = node.resolution;
          const auto = node._autoResolution;
          const ratio = job.size.factor / oldResolution;
          const width = Math.ceil(node.canvas.width * ratio);
          const height = Math.ceil(node.canvas.height * ratio);
          job.assetPixels += width * height;
          if (!Number.isFinite(width * height) || width > job.size.limit || height > job.size.limit ||
              job.assetPixels > MAX_ASSET_PIXELS) throw new Error('글자 렌더링이 메모리 한도를 넘습니다.');
          undo.push(() => {
            node.resolution = oldResolution;
            node._autoResolution = auto;
            node.updateText(false);
          });
          node.resolution = job.size.factor;
        }
        if (node._filterData) {
          saveProperties(undo, node, ['_filterData', 'filters']);
          const original = node.texture;
          const sx = node.scale.x, sy = node.scale.y;
          undo.push(() => { node.texture = original; node.scale.set(sx, sy); });
          node.texture = node._filterData.orgTex;
          node.filters = node._filterData.filters;
          node._filterData = null;
        }
        for (const filter of node.filters || []) {
          if (!filters.has(filter)) {
            filters.add(filter);
            saveProperties(undo, filter, ['resolution']);
            filter.resolution = 1;
          }
        }
      }
      for (const { node, canvas, width, height, texture } of job.replacements) {
        const original = node.texture;
        const sx = node.scale.x, sy = node.scale.y;
        undo.push(() => { node.texture = original; node.scale.set(sx, sy); });
        const fresh = texture.constructor.from(canvas);
        textures.push(fresh);
        // Keep local bounds, anchor and pivot exactly the same as the atlas item.
        fresh.baseTexture.setResolution(canvas.width / width);
        fresh.orig.width = width;
        fresh.orig.height = height;
        fresh.frame.width = width;
        fresh.frame.height = height;
        fresh.updateUvs();
        node.texture = fresh;
        node.scale.set(sx, sy);
      }
      renderer.resolution = 1;
      renderer.resize(output.width, output.height);
      renderer.render(job.root);
      if (renderer.gl.isContextLost()) throw new Error('캡처 중 WebGL 컨텍스트가 손실되었습니다.');
      const ctx = output.getContext('2d');
      if (!ctx) throw new Error('출력 캔버스를 만들 수 없습니다.');
      ctx.drawImage(view, 0, 0, output.width, output.height);
    } finally {
      // Synchronous transaction: no timer or pointer event can observe this size.
      // Even an upstream restore/draw error must not skip the remaining cleanup.
      const cleanup = [() => { for (const texture of textures) texture.destroy(true); },
        () => renderer.render(job.root),
        () => { if (css === null) view.removeAttribute('style'); else view.setAttribute('style', css); },
        () => { renderer.resolution = resolution; renderer.resize(job.size.screenWidth, job.size.screenHeight); },
        () => restoreAll(undo)];
      restoreAll(cleanup);
    }
  }

  async function capture(entry) {
    const engine = entry.engine;
    if (active || engine.state !== 'run') return;
    if (!entry.stage?.canvas || !entry.stage._app) {
      engine.togglePause();
      notify(false, '실행화면 렌더러가 준비되지 않았습니다.');
      return;
    }
    const job = { entry, engine, stage: entry.stage, root: entry.stage.canvas,
      scene: entry.scene?.selectedScene, project: entry.projectId, url: location.href,
      controller: new AbortController(), deadline: performance.now() + TIMEOUT,
      canvases: [], images: [], assetPixels: 0 };
    active = job;
    const disabled = [];
    let watchdog;
    try {
      engine.togglePause();
      check(job);
      job.state = sceneState(entry);
      syncButtons();
      for (const button of [engine.pauseButton, engine.pauseButtonFull, engine.runButton, engine.runButton2]) {
        if (button && !button.disabled) { button.disabled = true; disabled.push(button); }
      }
      watchdog = setInterval(() => {
        try { check(job); } catch (error) { job.controller.abort(error); }
      }, 100);
      job.size = sizeFor(job);
      await prepare(job);
      checkScene(job);
      const output = allocate(job, job.size.width, job.size.height);
      if (job.stage._app.renderer) renderWebGL(job, output);
      else render2D(job, output);
      checkScene(job);
      const ctx = output.getContext('2d');
      const pixels = ctx.getImageData(0, 0, output.width, output.height).data;
      let visible = false;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) { visible = true; break; }
      if (!visible) throw new Error('렌더링 결과가 비어 있어 저장하지 않았습니다.');
      const blob = await wait(job, new Promise((resolve, reject) => {
        // Never call Entry.canvas_.toDataURL (thumbnail override owns it).
        output.toBlob((value) => value ? resolve(value) : reject(new Error('PNG 인코딩에 실패했습니다.')), 'image/png');
      }));
      checkScene(job);
      if (blob.type !== 'image/png' || blob.size < 50) throw new Error('올바른 PNG를 만들지 못했습니다.');
      const decoded = await wait(job, createImageBitmap(blob).then((bitmap) => {
        if (job.controller.signal.aborted) { bitmap.close(); throw job.controller.signal.reason; }
        return bitmap;
      }));
      try {
        if (decoded.width !== output.width || decoded.height !== output.height) {
          throw new Error('PNG의 실제 해상도가 렌더링 결과와 일치하지 않습니다.');
        }
      } finally { decoded.close(); }
      checkScene(job);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Entry-screen-' + output.width + 'x' + output.height + '-' + Date.now() + '.png';
      document.body.appendChild(link);
      try { link.click(); } finally {
        link.remove();
        // Let Chrome consume the URL before releasing it; no project data is saved.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      notify(true, output.width + '×' + output.height + ' PNG를 다운로드했습니다. 작품은 일시정지 상태입니다.');
    } catch (error) {
      const message = error.name === 'SecurityError'
        ? '이미지의 CORS 제한으로 캡처할 수 없습니다.' : error.message || '화면 캡처에 실패했습니다.';
      notify(false, message);
    } finally {
      clearInterval(watchdog);
      job.controller.abort(new Error('캡처가 종료되었습니다.'));
      for (const img of job.images) { img.onload = img.onerror = null; img.removeAttribute('src'); }
      for (const canvas of job.canvases) { canvas.width = canvas.height = 1; }
      for (const button of disabled) button.disabled = false;
      active = null;
      syncButtons();
    }
  }

  function onClick(event) {
    if (!enabled || !inWorkspace()) return;
    const entry = getEntry();
    const engine = entry?.engine;
    const button = event.target?.closest?.('button');
    if (!engine || !button) return;
    // Block synthetic duplicate clicks on disabled native controls during encoding too.
    if (active && [engine.pauseButton, engine.pauseButtonFull].includes(button)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    if (![...decorations.values()].some((saved) => saved.capture === button)) return;
    if (!active && engine.state !== 'run') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!active) void capture(entry);
  }

  function setEnabled(value) {
    enabled = !!value;
    clearInterval(timer);
    timer = null;
    document.removeEventListener('click', onClick, true);
    if (enabled) {
      if (!style) {
        style = document.createElement('style');
        style.textContent = `
          .ed-screen-controls{display:inline-flex;flex:none;vertical-align:middle;box-sizing:border-box}
          .ed-screen-controls-normal{width:50%;height:36px}
          .ed-screen-controls-full{display:none}
          .entryPopupWindow .ed-screen-controls-normal{display:none}
          .entryPopupWindow .ed-screen-controls-full{display:inline-flex;width:200px;height:36px;margin-left:24px}
          .ed-screen-controls>button{display:block!important;flex:none!important;width:50%!important;height:36px!important;margin:0!important;padding:0!important;border:1px solid #4f80ff!important;border-radius:4px 0 0 4px!important;background-color:#fff!important;color:#4f80ff!important;font-size:12px!important;font-weight:600;letter-spacing:-.43px;line-height:34px!important;text-align:center;white-space:nowrap;cursor:pointer}
          .ed-screen-controls>.ed-screen-capture{border-left:0!important;border-radius:0 4px 4px 0!important}
          .ed-screen-controls>button:focus-visible{outline:2px solid #4f80ff;outline-offset:-3px}
          .ed-screen-controls>button:hover{background-color:#eff5ff!important}
          .ed-screen-controls>button:before{display:inline-block!important;width:12px!important;height:12px!important;margin:11px 2px 0 0!important;background-size:12px auto!important;vertical-align:top!important;content:''}
          .ed-screen-controls>.ed-screen-capture:before{background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%234f80ff' d='M8 4h8l2 3h3v14H3V7h3zm4 5a5 5 0 1 0 0 10 5 5 0 0 0 0-10m0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6'/%3E%3C/svg%3E")}
        `;
        (document.head || document.documentElement).appendChild(style);
      }
      document.addEventListener('click', onClick, true);
      timer = setInterval(syncButtons, 200);
    } else {
      active?.controller.abort(new Error('캡처 기능을 꺼서 취소했습니다.'));
      style?.remove(); style = null;
    }
    syncButtons();
  }

  Bridge.onMessage((message, event) => {
    if (event.source !== window || message.type !== 'SET_SCREEN_CAPTURE_ENABLED') return;
    setEnabled(!!message.payload?.enabled);
  });
  window.addEventListener('pagehide', () => setEnabled(false));
  Bridge.ready('SCREEN_CAPTURE_READY');
})();
