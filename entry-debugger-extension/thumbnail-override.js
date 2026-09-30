/**
 * Thumbnail capture hook reference: qwert1566/changeThumb, release 1.0.
 * https://github.com/qwert1566/changeThumb/releases/tag/1.0
 * Independently implemented lifecycle/validation. See THIRD_PARTY_NOTICES.txt.
 */
(function () {
  'use strict';
  if (window.__entryDebuggerThumbnailLoaded) return;
  window.__entryDebuggerThumbnailLoaded = true;
  const channel = '__ENTRY_DEBUGGER_THUMBNAIL__';
  const projectPattern = /^[a-f0-9]{24}$/;
  let enabled = false;
  let preserved = new Set();
  let current = null;
  let fetchHook = null;
  let revision = 0;
  const commits = new Map();

  function emit(type, data) {
    window.postMessage(Object.assign({ channel, type }, data), window.location.origin);
  }
  function projectId() {
    const match = /^\/ws\/([a-f0-9]{24})(?:\/|$)/.exec(window.location.pathname);
    return match ? match[1] : null;
  }
  function restoreCapture() {
    if (!current) return;
    const old = current;
    current = null;
    old.data = null;
    // Another extension may have wrapped us. Never overwrite its newer method.
    if (old.owner.toDataURL !== old.wrapper) return;
    if (old.descriptor) Object.defineProperty(old.owner, 'toDataURL', old.descriptor);
    else delete old.owner.toDataURL;
  }
  function reset() {
    revision++;
    restoreCapture();
  }
  function apply(data) {
    if (!enabled) throw new Error('설정에서 썸네일 관리자를 켜 주세요.');
    if (typeof data !== 'string' || data.length > 1200022 ||
        !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new Error('900KB 이하 PNG/APNG만 적용할 수 있습니다.');
    }
    const owner = window.Entry && window.Entry.canvas_;
    if (!owner || typeof owner.toDataURL !== 'function') throw new Error('Entry 캔버스를 찾을 수 없습니다. 편집기가 열린 뒤 다시 시도하세요.');
    if (!/^\/ws\//.test(window.location.pathname)) throw new Error('작품 편집기에서만 적용할 수 있습니다.');
    revision++;
    if (current && current.owner === owner && owner.toDataURL === current.wrapper) {
      current.data = data;
      current.path = window.location.pathname;
      return;
    }
    restoreCapture();
    const state = { owner, original: owner.toDataURL,
      descriptor: Object.getOwnPropertyDescriptor(owner, 'toDataURL'),
      data, path: window.location.pathname, wrapper: null };
    state.wrapper = function () {
      if (enabled && state.data && window.location.pathname === state.path &&
          window.Entry && window.Entry.canvas_ === state.owner) return state.data;
      state.data = null;
      return state.original.apply(this, arguments);
    };
    owner.toDataURL = state.wrapper;
    current = state;
  }
  function commit(project, custom) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        commits.delete(id);
        reject(new Error('썸네일 유지 설정을 저장하지 못했습니다. 관리자를 다시 열어 현재 썸네일 유지를 눌러 주세요.'));
      }, 5000);
      commits.set(id, { resolve, reject, timer });
      // Persist before Entry redirects a newly created work.
      emit('COMMIT', { id, project, custom });
    });
  }
  async function uploaded(response) {
    if (!response.ok) return false;
    try {
      const body = await response.clone().json();
      const errors = body && body.errors;
      return !!body && typeof body === 'object' && !body.error &&
        !(Array.isArray(errors) ? errors.length : errors) && body.success !== false;
    } catch (error) { return false; }
  }
  function requestProject(args) {
    try {
      const [input, init] = args;
      const isRequest = input instanceof Request;
      const method = String((init && init.method) || (isRequest && input.method) || 'GET').toUpperCase();
      if (method !== 'POST') return null;
      const url = new URL(isRequest ? input.url : String(input), window.location.href);
      if (url.origin !== window.location.origin) return null;
      const match = /^\/rest\/picture\/project\/thumbnail\/([a-f0-9]{24})$/.exec(url.pathname);
      return match ? match[1] : null;
    } catch (error) { return null; }
  }
  function installFetchHook() {
    if (fetchHook && window.fetch === fetchHook.wrapper) return;
    if (fetchHook) fetchHook.active = false;
    const hook = { original: window.fetch, active: true, wrapper: null };
    hook.wrapper = async function (...args) {
      const project = hook.active && enabled && /^\/ws\//.test(window.location.pathname) && requestProject(args);
      if (!project) return hook.original.apply(this, args);
      const capture = current && current.data && current.path === window.location.pathname &&
        window.Entry && current.owner === window.Entry.canvas_ ? current : null;
      // Copies/new works need their own first upload, even when the source is preserved.
      if (!capture && project === projectId() && preserved.has(project)) {
        emit('SAVED', { project, custom: true, skipped: true });
        // Entry's WASM uploader awaits Response.json(); its caller ignores the value.
        // Resolve normally so Entry still restores its stage and completes the save.
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (!capture && project !== projectId()) return hook.original.apply(this, args);
      const task = revision;
      emit('SAVING', { project });
      try {
        const response = await hook.original.apply(this, args);
        if (!await uploaded(response)) {
          emit('SAVE_ERROR', { project, error: '썸네일 저장을 확인하지 못했습니다. 잠시 후 작품을 다시 저장해 주세요.' });
          return response;
        }
        if (task !== revision || !enabled) return response;
        const custom = !!capture;
        if (custom) preserved.add(project); else preserved.delete(project);
        try {
          await commit(project, custom);
          if (task === revision && enabled) {
            if (custom) restoreCapture();
            emit('SAVED', { project, custom, skipped: false });
          }
        } catch (error) {
          emit('SAVE_ERROR', { project, error: error.message });
        }
        return response;
      } catch (error) {
        emit('SAVE_ERROR', { project, error: '썸네일 전송에 실패했습니다. 연결을 확인하고 작품을 다시 저장해 주세요.' });
        throw error;
      } finally { emit('SAVE_END', { project }); }
    };
    window.fetch = hook.wrapper;
    fetchHook = hook;
  }
  function disable() {
    enabled = false;
    reset();
    if (!fetchHook) return;
    fetchHook.active = false;
    if (window.fetch === fetchHook.wrapper) window.fetch = fetchHook.original;
    fetchHook = null;
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== window.location.origin ||
        !event.data || event.data.channel !== channel) return;
    const message = event.data;
    if (message.type === 'COMMITTED') {
      const pending = commits.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      commits.delete(message.id);
      if (message.ok) pending.resolve();
      else pending.reject(new Error(message.error || '썸네일 유지 설정 저장 실패. 다시 시도해 주세요.'));
      return;
    }
    if (!['CONFIG', 'APPLY', 'RESET'].includes(message.type)) return;
    try {
      if (message.type === 'CONFIG') {
        const data = message.data || {};
        preserved = new Set(Array.isArray(data.projects) ? data.projects.filter(id => projectPattern.test(id)) : []);
        if (data.enabled) { enabled = true; installFetchHook(); } else disable();
      } else if (message.type === 'RESET') reset();
      else apply(message.data);
      emit('RESULT', { id: message.id, ok: true });
    } catch (error) { emit('RESULT', { id: message.id, ok: false, error: error.message }); }
  });
  window.addEventListener('pagehide', disable);
})();
