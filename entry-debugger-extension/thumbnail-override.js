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
  let current = null;
  function restore() {
    if (!current) return;
    const old = current;
    current = null;
    // Another extension may have wrapped us. Never overwrite its newer method.
    old.data = null;
    if (old.owner.toDataURL !== old.wrapper) return;
    if (old.descriptor) Object.defineProperty(old.owner, 'toDataURL', old.descriptor);
    else delete old.owner.toDataURL;
  }
  function apply(data) {
    if (typeof data !== 'string' || data.length > 1200022 ||
        !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data)) {
      throw new Error('900KB 이하 PNG/APNG만 적용할 수 있습니다.');
    }
    const owner = window.Entry && window.Entry.canvas_;
    if (!owner || typeof owner.toDataURL !== 'function') throw new Error('Entry 캔버스를 찾을 수 없습니다. 편집기가 열린 뒤 다시 시도하세요.');
    if (!/^\/ws\//.test(window.location.pathname)) throw new Error('작품 편집기에서만 적용할 수 있습니다.');
    if (current && current.owner === owner && owner.toDataURL === current.wrapper) {
      current.data = data;
      current.path = window.location.pathname;
      return;
    }
    restore();
    const state = { owner, original: owner.toDataURL,
      descriptor: Object.getOwnPropertyDescriptor(owner, 'toDataURL'),
      data, path: window.location.pathname, wrapper: null };
    state.wrapper = function () {
      if (state.data && window.location.pathname === state.path &&
          window.Entry && window.Entry.canvas_ === state.owner) return state.data;
      // Stale wrapper retained by another extension always delegates to the original.
      state.data = null;
      return state.original.apply(this, arguments);
    };
    owner.toDataURL = state.wrapper;
    current = state;
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== window.location.origin ||
        !event.data || event.data.channel !== channel) return;
    const message = event.data;
    if (!['APPLY', 'RESET'].includes(message.type)) return;
    try {
      if (message.type === 'RESET') restore(); else apply(message.data);
      window.postMessage({ channel, type: 'RESULT', id: message.id, ok: true }, window.location.origin);
    } catch (error) {
      window.postMessage({ channel, type: 'RESULT', id: message.id, ok: false, error: error.message }, window.location.origin);
    }
  });
  window.addEventListener('pagehide', restore);
})();
