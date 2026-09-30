/** Thumbnail manager: server preview, local conversion and per-project retention. */
(function () {
  'use strict';
  const channel = '__ENTRY_DEBUGGER_THUMBNAIL__';
  const storagePrefix = 'thumbnailManager.project.';
  const projectPattern = /^[a-f0-9]{24}$/;
  let enabled = false;
  let ready = false;
  let root = null;
  let controller = null;
  let result = null;
  let previewUrl = null;
  let pageScript = null;
  let storageReady = null;
  let applied = false;
  let appliedResult = null;
  let automaticPending = false;
  let busy = false;
  let saving = false;
  let hasCurrent = false;
  let revision = 0;
  let message = '';
  const projects = new Set();
  const pending = new Map();

  function html() {
    return '<div class="ed-thumbnail-tool" id="ed-thumbnail-tool">' +
      '<h3>현재 썸네일</h3>' +
      '<p class="ed-thumbnail-mode"></p>' +
      '<div class="ed-thumbnail-preview"><img class="ed-thumbnail-current" alt="서버에 저장된 현재 썸네일" hidden>' +
        '<span class="ed-thumbnail-empty">저장된 썸네일을 불러오는 중…</span></div>' +
      '<div class="ed-thumbnail-actions">' +
        '<button type="button" data-action="keep">현재 썸네일 유지</button>' +
        '<button type="button" data-action="reset">제거</button>' +
        '<button type="button" data-action="refresh">새로 확인</button>' +
      '</div>' +
      '<p class="ed-thumbnail-help">제거하면 다음 작품 저장부터 엔트리가 실행화면으로 썸네일을 만듭니다.</p>' +
      '<hr><h3>새 썸네일 업로드</h3>' +
      '<label class="ed-thumbnail-file-label">이미지·GIF·영상 선택' +
        '<input type="file" accept="image/png,image/apng,image/jpeg,image/webp,image/gif,video/*,.apng"></label>' +
      '<div class="ed-thumbnail-preview ed-thumbnail-selection" hidden>' +
        '<img class="ed-thumbnail-new" alt="새 썸네일 미리보기">' +
      '</div>' +
      '<div class="ed-thumbnail-actions">' +
        '<button type="button" data-action="apply" disabled>새 썸네일 적용</button>' +
        '<button type="button" data-action="cancel" disabled>선택 취소</button>' +
      '</div>' +
      '<p class="ed-thumbnail-status" role="status" aria-live="polite"></p>' +
      '<p class="ed-thumbnail-help">적용 후 엔트리에서 작품을 저장하세요. 저장한 썸네일은 이 브라우저에서 관리자가 켜져 있는 동안 유지됩니다.</p>' +
      '<p class="ed-thumbnail-help">최대 50MiB · GIF/영상 앞 6초 · 최대 480×270/12fps · 결과 900KB 이하로 자동 축소 · 소리 제외</p>' +
    '</div>';
  }
  function projectId() {
    const match = /^\/ws\/([a-f0-9]{24})(?:\/|$)/.exec(location.pathname);
    return match ? match[1] : null;
  }
  function status(text) {
    message = text;
    if (root) root.querySelector('.ed-thumbnail-status').textContent = text;
  }
  function controls(value = busy) {
    busy = value;
    if (!root) return;
    const locked = busy || saving || !enabled || !ready;
    root.querySelector('input').disabled = locked;
    root.querySelector('[data-action="apply"]').disabled = locked || !result || result === appliedResult;
    root.querySelector('[data-action="cancel"]').disabled = saving || !enabled || (!result && !busy && !applied);
    root.querySelector('[data-action="reset"]').disabled = locked;
    root.querySelector('[data-action="keep"]').disabled = locked || !hasCurrent || projects.has(projectId());
    root.querySelector('[data-action="refresh"]').disabled = busy || saving || !enabled;
    root.querySelector('.ed-thumbnail-mode').textContent = applied ? '새 썸네일 · 작품 저장 대기' :
      automaticPending ? '자동 썸네일 · 작품 저장 대기' :
      projects.has(projectId()) ? '현재 이미지 유지' : '작품 저장 시 자동 갱신';
  }
  function clearPreview() {
    result = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    if (!root) return;
    root.querySelector('.ed-thumbnail-new').removeAttribute('src');
    root.querySelector('.ed-thumbnail-selection').hidden = true;
    root.querySelector('input').value = '';
  }
  function cancelConversion() {
    revision++;
    if (controller) controller.abort();
    controller = null;
    clearPreview();
  }
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
  function loadStorage() {
    if (!storageReady) {
      storageReady = chrome.storage.local.get(null).then(data => {
        for (const [key, value] of Object.entries(data)) {
          if (key.startsWith(storagePrefix) && projectPattern.test(key.slice(storagePrefix.length)) && value === true) {
            projects.add(key.slice(storagePrefix.length));
          }
        }
      }).catch(error => { storageReady = null; throw error; });
    }
    return storageReady;
  }
  function request(type, data) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('Entry 응답이 없습니다. 페이지를 새로고침해 주세요.'));
      }, 5000);
      pending.set(id, { resolve, reject, timer });
      window.postMessage({ channel, type, data, id }, window.location.origin);
    });
  }
  async function sync() {
    await loadStorage();
    if (!enabled && !pageScript) return;
    await loadPageScript();
    await request('CONFIG', { enabled, projects: Array.from(projects) });
  }
  async function writeRecord(project, custom) {
    if (!projectPattern.test(project)) throw new Error('작품 번호를 확인하지 못했습니다.');
    const key = storagePrefix + project;
    if (custom) await chrome.storage.local.set({ [key]: true });
    else await chrome.storage.local.remove(key);
    if (custom) projects.add(project); else projects.delete(project);
  }
  window.addEventListener('message', async (event) => {
    if (event.source !== window || event.origin !== window.location.origin ||
        !event.data || event.data.channel !== channel) return;
    const data = event.data;
    if (data.type === 'RESULT') {
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id);
      clearTimeout(item.timer);
      if (data.ok) item.resolve(); else item.reject(new Error(data.error || '적용에 실패했습니다.'));
    } else if (data.type === 'COMMIT') {
      try {
        await writeRecord(data.project, data.custom === true);
        window.postMessage({ channel, type: 'COMMITTED', id: data.id, ok: true }, location.origin);
      } catch (error) {
        window.postMessage({ channel, type: 'COMMITTED', id: data.id, ok: false,
          error: '썸네일 유지 설정을 저장하지 못했습니다. 현재 썸네일 유지를 다시 눌러 주세요.' }, location.origin);
      }
    } else if (data.type === 'SAVING') {
      saving = true;
      controls();
    } else if (data.type === 'SAVE_END') {
      saving = false;
      controls();
    } else if (data.type === 'SAVED') {
      if (result === appliedResult) clearPreview();
      applied = false;
      appliedResult = null;
      automaticPending = false;
      if (data.custom) projects.add(data.project); else projects.delete(data.project);
      status(data.skipped ? '작품 내용을 저장했습니다. 기존 썸네일은 그대로 유지됩니다.' :
        data.custom ? '새 썸네일을 저장했습니다. 새로고침 후에도 유지됩니다.' : '엔트리 자동 썸네일을 저장했습니다.');
      refresh();
    } else if (data.type === 'SAVE_ERROR') {
      status(data.error);
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let changed = false;
    for (const [key, value] of Object.entries(changes)) {
      if (!key.startsWith(storagePrefix)) continue;
      const project = key.slice(storagePrefix.length);
      if (!projectPattern.test(project)) continue;
      if (value.newValue === true) projects.add(project); else projects.delete(project);
      changed = true;
    }
    if (changed) {
      sync().catch(error => status(error.message));
      controls();
    }
  });
  function refresh() {
    if (!root) return;
    const project = projectId();
    const img = root.querySelector('.ed-thumbnail-current');
    const empty = root.querySelector('.ed-thumbnail-empty');
    hasCurrent = false;
    img.hidden = true;
    empty.hidden = false;
    if (project) {
      empty.textContent = '저장된 썸네일을 불러오는 중…';
      img.src = location.origin + '/uploads/thumb/' + project.slice(0, 4) + '/' + project + '.png?c=' + Date.now();
    } else {
      img.removeAttribute('src');
      empty.textContent = '아직 저장된 썸네일이 없습니다. 작품을 처음 저장하면 표시됩니다.';
    }
    controls();
  }
  async function cancel() {
    cancelConversion();
    try {
      if (pageScript) { await pageScript; await request('RESET'); }
      applied = false;
      appliedResult = null;
      status('새 이미지 선택을 취소했습니다.');
    } catch (error) { status(error.message); }
    controls(false);
  }
  async function chooseMode(custom) {
    if (!enabled || busy || saving || !ready) return;
    cancelConversion();
    controls(true);
    try {
      await request('RESET');
      applied = false;
      appliedResult = null;
      const project = projectId();
      if (project) await writeRecord(project, custom);
      await sync();
      automaticPending = !custom;
      status(custom ? '현재 서버 썸네일을 유지합니다. 이후에는 작품 내용만 저장됩니다.' :
        '사용자 썸네일을 제거했습니다. 작품을 저장하면 엔트리 자동 썸네일로 바뀝니다.');
    } catch (error) { status(error.message); }
    finally { controls(false); }
  }
  async function select(file) {
    if (!file || !enabled || !ready || saving) return;
    // Keep an already applied image until a replacement is explicitly applied.
    const task = ++revision;
    if (controller) controller.abort();
    const abort = new AbortController();
    controller = abort;
    const timeout = setTimeout(() => abort.abort(new Error('변환 시간이 초과되었습니다. 더 짧거나 작은 파일을 선택하세요.')), 90000);
    clearPreview();
    controls(true);
    status('변환 준비 중…');
    try {
      const converted = await window.EntryDebuggerThumbnailMedia.convert(file, {
        signal: abort.signal, progress: text => { if (task === revision) status(text); }
      });
      if (task !== revision || !enabled || !root) return;
      result = converted;
      previewUrl = URL.createObjectURL(result.blob);
      root.querySelector('.ed-thumbnail-new').src = previewUrl;
      root.querySelector('.ed-thumbnail-selection').hidden = false;
      // A new selection is not yet the active capture.
      status((result.animated ? 'APNG' : 'PNG') + ' · ' + (result.blob.size / 1000).toFixed(1) + 'KB · ' +
        result.width + '×' + result.height + ' · ' + result.frames + '프레임' +
        (result.animated ? ' · ' + result.duration.toFixed(2) + '초' : '') +
        (result.truncated ? ' · 앞 6초 이내만 사용' : '') +
        (result.reduced ? ' · 용량에 맞춰 화질/프레임 축소' : '') + ' · 적용 후 작품을 저장하세요.' +
        (applied ? ' 적용 전에는 이전에 선택한 썸네일을 사용합니다.' : ''));
    } catch (error) {
      if (task === revision) status(error.name === 'AbortError' ? '변환 취소됨' : error.message);
    } finally {
      clearTimeout(timeout);
      if (task === revision) { controller = null; controls(false); }
    }
  }
  async function apply() {
    if (!enabled || !result || busy || saving) return;
    const task = revision;
    controls(true);
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('변환 결과를 읽지 못했습니다.'));
        reader.readAsDataURL(result.blob);
      });
      if (task !== revision || !enabled) return;
      await request('APPLY', data);
      if (task !== revision || !enabled) return;
      applied = true;
      appliedResult = result;
      automaticPending = false;
      status('적용 준비 완료. 엔트리에서 작품을 저장하면 새 썸네일로 바뀝니다. 저장 전 새로고침하면 선택이 취소됩니다.');
    } catch (error) { if (task === revision) status(error.message); }
    finally { if (task === revision) controls(false); }
  }
  function mount(panel) {
    const next = panel.querySelector('#ed-thumbnail-tool');
    if (!next || next === root) return;
    if (root) unmount();
    root = next;
    root.querySelector('input').addEventListener('change', event => select(event.target.files[0]));
    root.querySelector('[data-action="apply"]').addEventListener('click', apply);
    root.querySelector('[data-action="cancel"]').addEventListener('click', cancel);
    root.querySelector('[data-action="reset"]').addEventListener('click', () => chooseMode(false));
    root.querySelector('[data-action="keep"]').addEventListener('click', () => chooseMode(true));
    root.querySelector('[data-action="refresh"]').addEventListener('click', refresh);
    const img = root.querySelector('.ed-thumbnail-current');
    img.addEventListener('load', () => {
      if (!root || root.querySelector('.ed-thumbnail-current') !== img) return;
      hasCurrent = true;
      img.hidden = false;
      root.querySelector('.ed-thumbnail-empty').hidden = true;
      controls();
    });
    img.addEventListener('error', () => {
      if (!root || root.querySelector('.ed-thumbnail-current') !== img) return;
      hasCurrent = false;
      img.hidden = true;
      root.querySelector('.ed-thumbnail-empty').hidden = false;
      root.querySelector('.ed-thumbnail-empty').textContent = '썸네일을 불러오지 못했습니다. 저장 후 새로 확인을 눌러 주세요.';
      controls();
    });
    status(message || '새 이미지 적용과 제거는 작품을 저장한 뒤 반영됩니다.');
    refresh();
  }
  function setEnabled(value) {
    const wasEnabled = enabled;
    enabled = !!value;
    if (wasEnabled && !enabled) {
      cancelConversion();
      applied = false;
      appliedResult = null;
      automaticPending = false;
      saving = false;
    }
    ready = false;
    controls(false);
    sync().then(() => { ready = enabled; controls(); }).catch(error => status(error.message));
  }
  function unmount() {
    cancelConversion();
    busy = false;
    applied = false;
    appliedResult = null;
    root = null;
    if (pageScript) pageScript.then(() => request('RESET')).catch(() => {});
  }
  window.addEventListener('pagehide', () => {
    if (controller) controller.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && enabled) sync().catch(error => status(error.message));
  });
  window.EntryDebuggerThumbnailUI = Object.freeze({ html, mount, setEnabled, unmount, refresh });
})();
