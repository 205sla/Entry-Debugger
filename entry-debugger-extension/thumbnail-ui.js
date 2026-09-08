/** Laboratory thumbnail selection, local conversion, preview and reversible application. */
(function () {
  'use strict';
  const channel = '__ENTRY_DEBUGGER_THUMBNAIL__';
  let enabled = false;
  let root = null;
  let controller = null;
  let result = null;
  let previewUrl = null;
  let pageScript = null;
  let applied = false;
  let busy = false;
  let revision = 0;
  const pending = new Map();
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin ||
        !event.data || event.data.channel !== channel || event.data.type !== 'RESULT') return;
    const request = pending.get(event.data.id);
    if (!request) return;
    pending.delete(event.data.id);
    clearTimeout(request.timer);
    if (event.data.ok) request.resolve(); else request.reject(new Error(event.data.error || '적용에 실패했습니다.'));
  });
  function loadPageScript() {
    if (pageScript) return pageScript;
    pageScript = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timer = setTimeout(() => finish(new Error('썸네일 기능을 불러오지 못했습니다. 새로고침해 주세요.')), 10000);
      function finish(error) {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        script.remove();
        if (error) reject(error); else resolve();
      }
      script.src = chrome.runtime.getURL('thumbnail-override.js');
      script.onload = () => finish();
      script.onerror = () => finish(new Error('썸네일 기능 로드 실패. 확장을 다시 로드해 주세요.'));
      (document.head || document.documentElement).appendChild(script);
    }).catch((error) => { pageScript = null; throw error; });
    return pageScript;
  }
  function request(type, data) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Entry 응답이 없습니다. 적용 해제 후 다시 시도하세요.'));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ channel, type, data, id }, window.location.origin);
    });
  }
  function status(text) {
    if (root) root.querySelector('.ed-thumbnail-status').textContent = text;
  }
  function controls(value) {
    busy = value;
    if (!root) return;
    root.querySelector('input').disabled = busy || !enabled;
    root.querySelector('[data-action="apply"]').disabled = busy || !enabled || !result;
    root.querySelector('[data-action="reset"]').disabled = !enabled;
  }
  function clearPreview(keepSelection) {
    result = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (root) {
      const img = root.querySelector('img');
      img.removeAttribute('src');
      img.hidden = true;
      if (!keepSelection) root.querySelector('input').value = '';
    }
  }
  async function reset() {
    const task = ++revision;
    if (controller) controller.abort();
    controller = null;
    clearPreview();
    try {
      if (pageScript) { await pageScript; await request('RESET'); }
      if (task !== revision) return;
      applied = false;
      status('적용 해제됨. 다음 저장부터 기본 썸네일을 사용합니다. 이미 저장한 썸네일은 자동 복구되지 않습니다.');
    } catch (error) { if (task === revision) status(error.message); }
    if (task !== revision) return;
    controls(false);
  }
  async function select(file) {
    if (!file || !enabled) return;
    const task = ++revision;
    if (controller) controller.abort();
    const abort = new AbortController();
    controller = abort;
    const timeout = setTimeout(() => abort.abort(new Error('변환 시간이 초과되었습니다. 더 짧거나 작은 파일을 선택하세요.')), 90000);
    clearPreview(true);
    controls(true);
    status('변환 준비 중…');
    try {
      const converted = await window.EntryDebuggerThumbnailMedia.convert(file, {
        signal: abort.signal,
        progress: (text) => { if (task === revision) status(text); }
      });
      if (task !== revision || !enabled) return;
      result = converted;
      previewUrl = URL.createObjectURL(result.blob);
      const img = root.querySelector('img');
      img.src = previewUrl;
      img.hidden = false;
      status((result.animated ? 'APNG' : 'PNG') + ' · ' + (result.blob.size / 1000).toFixed(1) + 'KB / 900KB · ' +
        result.width + '×' + result.height + ' · ' + result.frames + '프레임' +
        (result.animated ? ' · ' + result.duration.toFixed(2) + '초' : '') +
        (result.truncated ? ' · 앞 6초 이내만 사용' : '') +
        (result.reduced ? ' · 용량에 맞춰 화질/프레임 축소' : '') +
        (applied ? ' · 새 미리보기입니다. 적용 전에는 이전 썸네일이 유지됩니다.' : ' · 미리보기 확인 후 적용하세요.'));
    } catch (error) {
      if (task === revision) {
        if (root) root.querySelector('input').value = '';
        status(error.name === 'AbortError' ? '변환 취소됨' : error.message);
      }
    } finally {
      clearTimeout(timeout);
      if (task === revision) { controller = null; controls(false); }
    }
  }
  async function apply() {
    if (!enabled || !result) return;
    const task = revision;
    const selected = result;
    controls(true);
    try {
      await loadPageScript();
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('변환 결과를 읽지 못했습니다.'));
        reader.readAsDataURL(selected.blob);
      });
      if (task !== revision || !enabled) return;
      await request('APPLY', data);
      if (task !== revision || !enabled) return;
      applied = true;
      status('적용 준비 완료. 엔트리의 작품 저장 버튼을 눌러 반영하세요. 적용 해제 전까지 현재 페이지의 캔버스 이미지 추출에도 사용됩니다.');
    } catch (error) { if (task === revision) status(error.message); }
    finally { if (task === revision) controls(false); }
  }
  function mount(panel) {
    const next = panel.querySelector('#ed-thumbnail-tool');
    if (!next || next === root) return;
    if (root) reset();
    root = next;
    root.querySelector('input').addEventListener('change', (event) => select(event.target.files[0]));
    root.querySelector('[data-action="apply"]').addEventListener('click', apply);
    root.querySelector('[data-action="reset"]').addEventListener('click', reset);
    controls(false);
  }
  function setEnabled(value) {
    const wasEnabled = enabled;
    enabled = !!value;
    if (wasEnabled && !enabled) reset();
    controls(busy);
  }
  function unmount() {
    if (root) reset();
    root = null;
  }
  window.addEventListener('pagehide', () => {
    if (controller) controller.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  window.EntryDebuggerThumbnailUI = Object.freeze({ mount, setEnabled, unmount });
})();
