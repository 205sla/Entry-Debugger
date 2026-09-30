'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname, '../entry-debugger-extension/thumbnail-override.js'), 'utf8');
const a = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const b = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const png = 'data:image/png;base64,iVBORw0KGgoAAA==';
const endpoint = id => '/rest/picture/project/thumbnail/' + id;
function fixture(disk = new Set(), pathname = '/ws/' + a) {
  const listeners = {};
  const messages = [];
  const calls = [];
  const original = function (arg) { return 'original:' + arg; };
  const owner = Object.create({ toDataURL: original });
  let response = () => Promise.resolve(new Response('{}'));
  let storageFailure = false;
  const nativeFetch = function (...args) { calls.push({ receiver: this, args }); return response(); };
  const window = {
    Entry: { canvas_: owner },
    location: new URL('https://playentry.org' + pathname), fetch: nativeFetch,
    addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); },
    postMessage: message => {
      messages.push(message);
      if (message.type === 'COMMIT') queueMicrotask(() => {
        if (!storageFailure) {
          if (message.custom) disk.add(message.project); else disk.delete(message.project);
        }
        send('COMMITTED', undefined, window, window.location.origin,
          { id: message.id, ok: !storageFailure, error: storageFailure ? 'storage failed' : undefined });
      });
    }
  };
  function send(type, data, source = window, origin = window.location.origin, extra = {}) {
    listeners.message[0]({ source, origin, data: { channel: '__ENTRY_DEBUGGER_THUMBNAIL__', type, data, id: 'test', ...extra } });
    return messages.filter(item => item.type === 'RESULT').at(-1);
  }
  const context = vm.createContext({ window, Request, Response, URL, crypto, setTimeout, clearTimeout });
  vm.runInContext(code, context);
  vm.runInContext(code, context);
  assert.equal(listeners.message.length, 1);
  const configure = (enabled = true) => send('CONFIG', { enabled, projects: Array.from(disk) });
  async function save(id = a) {
    const data = owner.toDataURL('png');
    const reply = await window.fetch(endpoint(id), { method: 'POST', body: data });
    // Mirrors the current native uploader contract and post-thumbnail cleanup.
    await reply.json();
    return { restoredStage: true, completedSave: true };
  }
  return { window, owner, original, nativeFetch, messages, calls, listeners, disk, send, configure, save,
    respond: fn => { response = fn; }, failStorage: () => { storageFailure = true; } };
}
async function main() {
  const f = fixture();
  f.send('APPLY', png, {});
  f.send('APPLY', png, f.window, 'https://example.com');
  assert.equal(f.messages.length, 0);
  assert.equal(f.send('APPLY', png).ok, false, 'Disabled manager cannot capture');
  f.configure();
  assert.equal(f.send('APPLY', 'data:text/html;base64,xxx').ok, false);
  assert.equal(f.send('APPLY', png + 'A'.repeat(1200022)).ok, false);
  assert.equal(f.owner.toDataURL, f.original);
  assert.equal(f.send('APPLY', png).ok, true);
  assert.equal(f.owner.toDataURL(), png);
  const wrapper = f.owner.toDataURL;
  f.send('APPLY', png);
  assert.equal(f.owner.toDataURL, wrapper, 'Repeated apply must not stack wrappers');
  f.send('RESET');
  assert.equal(f.owner.toDataURL, f.original);
  assert.equal(Object.hasOwn(f.owner, 'toDataURL'), false);
  Object.defineProperty(f.owner, 'toDataURL', { configurable: true, writable: true, enumerable: false, value: f.original });
  const descriptor = Object.getOwnPropertyDescriptor(f.owner, 'toDataURL');
  f.send('APPLY', png);
  f.send('RESET');
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.owner, 'toDataURL'), descriptor);
  f.send('APPLY', png);
  const ours = f.owner.toDataURL;
  const other = function (arg) { return ours.call(this, arg); };
  f.owner.toDataURL = other;
  f.send('RESET');
  assert.equal(f.owner.toDataURL, other, 'Never clobber another extension');
  assert.equal(f.owner.toDataURL('jpeg'), 'original:jpeg');
  f.owner.toDataURL = f.original;
  f.send('APPLY', png);
  f.window.location.pathname = '/ws/' + b;
  assert.equal(f.owner.toDataURL('png'), 'original:png');
  f.window.location.pathname = '/ws/' + a;
  assert.equal(f.owner.toDataURL('png'), 'original:png', 'A stale project capture stays cleared');
  f.send('RESET');
  f.window.Entry.canvas_ = null;
  assert.equal(f.send('APPLY', png).ok, false);
  f.window.Entry.canvas_ = f.owner;
  f.send('APPLY', png);
  assert.deepEqual(await f.save(), { restoredStage: true, completedSave: true });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args[1].body, png);
  assert(f.disk.has(a), 'Only a successful upload persists retention');
  assert.equal(f.owner.toDataURL, f.original, 'Successful upload releases the canvas hook');
  await f.save();
  assert.equal(f.calls.length, 1, 'Subsequent save skips uploading');

  // A fresh page starts without image data; the saved project flag is sufficient.
  const reload = fixture(f.disk);
  reload.configure();
  assert.deepEqual(await reload.save(), { restoredStage: true, completedSave: true });
  assert.equal(reload.calls.length, 0);
  assert.equal(reload.owner.toDataURL, reload.original);
  await reload.save(b);
  assert.equal(reload.calls.length, 1, 'A copied/new project must upload its first thumbnail');
  assert(!reload.disk.has(b));
  for (const args of [
    ['/graphql', { method: 'POST', body: 'project-content' }],
    [endpoint(a)],
    [endpoint(a), { method: 'DELETE' }],
    ['https://example.com' + endpoint(a), { method: 'POST' }],
    [endpoint(a) + '/other', { method: 'POST' }]
  ]) await reload.window.fetch(...args);
  assert.equal(reload.calls.length, 6, 'Other requests are passed through unchanged');
  const req = new Request('https://playentry.org' + endpoint(a), { method: 'POST', body: 'ignored' });
  assert.deepEqual(await (await reload.window.fetch(req)).json(), {});
  assert.equal(reload.calls.length, 6, 'Request objects also work');

  reload.disk.delete(a);
  reload.send('RESET');
  reload.configure();
  await reload.save();
  assert.equal(reload.calls.length, 7, 'Remove switches back to automatic uploads');
  assert.equal(reload.calls.at(-1).args[1].body, 'original:png');
  reload.disk.add(a);
  reload.configure(false);
  assert.equal(reload.window.fetch, reload.nativeFetch);
  await reload.save();
  assert.equal(reload.calls.length, 8, 'Feature OFF restores native saving');

  for (const reply of [new Response('{"error":"rejected"}'), new Response('{}', {status: 500}), new Response('<html>login</html>')]) {
    const failure = fixture();
    failure.configure(); failure.send('APPLY', png);
    failure.respond(() => Promise.resolve(reply));
    const returned = await failure.window.fetch(endpoint(a), {method:'POST'});
    assert.equal(returned, reply, 'Native response is not consumed or replaced');
    assert(!failure.disk.has(a));
    assert.equal(failure.owner.toDataURL(), png, 'Failed uploads keep the selection for retry');
    assert(failure.messages.some(m => m.type === 'SAVE_ERROR'));
  }
  const denied = fixture();
  denied.configure(); denied.send('APPLY', png); denied.failStorage();
  await denied.save();
  assert(!denied.disk.has(a));
  assert(denied.messages.some(m => m.type === 'SAVE_ERROR'));
  assert(!denied.messages.some(m => m.type === 'SAVED'), 'Storage failure must not claim durable retention');

  const fresh = fixture(new Set(), '/ws/new');
  fresh.configure(); fresh.send('APPLY', png);
  await fresh.save(b);
  assert(fresh.disk.has(b), 'First save persists the server-assigned project ID before redirect');
  const abort = fixture();
  abort.configure(); abort.send('APPLY', png);
  let resolve;
  abort.respond(() => new Promise(r => { resolve = r; }));
  const inFlight = abort.save();
  abort.send('RESET');
  resolve(new Response('{}'));
  await inFlight;
  assert(!abort.disk.has(a), 'A late upload cannot undo remove/cancel');

  const layered = fixture(new Set([a]));
  layered.configure();
  const previous = layered.window.fetch;
  const later = (...args) => previous(...args);
  layered.window.fetch = later;
  layered.configure(false);
  assert.equal(layered.window.fetch, later);
  await layered.save();
  assert.equal(layered.calls.length, 1, 'Retired fetch wrapper delegates');
  layered.configure();
  await layered.save();
  assert.equal(layered.calls.length, 1, 'Re-enable does not stack active wrappers');
  layered.listeners.pagehide[0]();
  await layered.save();
  assert.equal(layered.calls.length, 2);
  console.log('[check-thumbnail-override] OK: persistence, reload/save, removal, new/copy, failures, response integrity, lifecycle and scope');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
