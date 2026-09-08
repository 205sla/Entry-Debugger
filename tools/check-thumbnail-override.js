'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const listeners = {};
const replies = [];
const original = function (arg) { return 'original:' + arg; };
const prototype = { toDataURL: original };
const owner = Object.create(prototype);
const window = {
  Entry: { canvas_: owner },
  location: { pathname: '/ws/project-a', origin: 'https://playentry.org' },
  addEventListener: (type, listener) => { (listeners[type] ||= []).push(listener); },
  postMessage: (message) => replies.push(message)
};
const code = fs.readFileSync(path.join(__dirname, '../entry-debugger-extension/thumbnail-override.js'), 'utf8');
const context = vm.createContext({ window });
vm.runInContext(code, context);
vm.runInContext(code, context);
assert.strictEqual(listeners.message.length, 1);
const png = 'data:image/png;base64,iVBORw0KGgoAAA==';
function send(type, data, source = window, origin = window.location.origin) {
  listeners.message[0]({ source, origin, data: { channel: '__ENTRY_DEBUGGER_THUMBNAIL__', type, data, id: 'test' } });
  return replies.at(-1);
}
send('APPLY', png, {});
send('APPLY', png, window, 'https://example.com');
assert.strictEqual(replies.length, 0);
assert.strictEqual(send('APPLY', 'data:text/html;base64,xxx').ok, false);
assert.strictEqual(send('APPLY', png + 'A'.repeat(1200022)).ok, false);
assert.strictEqual(owner.toDataURL, original);
assert.strictEqual(send('APPLY', png).ok, true);
assert.strictEqual(owner.toDataURL(), png);
const wrapper = owner.toDataURL;
send('APPLY', png);
assert.strictEqual(owner.toDataURL, wrapper, 'Repeated apply must not stack wrappers');
send('RESET');
assert.strictEqual(owner.toDataURL, original);
assert.strictEqual(Object.hasOwn(owner, 'toDataURL'), false);
Object.defineProperty(owner, 'toDataURL', { configurable: true, writable: true, enumerable: false, value: original });
const descriptor = Object.getOwnPropertyDescriptor(owner, 'toDataURL');
send('APPLY', png);
send('RESET');
assert.deepStrictEqual(Object.getOwnPropertyDescriptor(owner, 'toDataURL'), descriptor);
send('APPLY', png);
const ours = owner.toDataURL;
const other = function (arg) { return ours.call(this, arg); };
owner.toDataURL = other;
send('RESET');
assert.strictEqual(owner.toDataURL, other, 'Do not clobber another extension');
assert.strictEqual(owner.toDataURL('jpeg'), 'original:jpeg');
owner.toDataURL = original;
send('APPLY', png);
window.location.pathname = '/ws/project-b';
assert.strictEqual(owner.toDataURL('png'), 'original:png');
window.location.pathname = '/ws/project-a';
assert.strictEqual(owner.toDataURL('png'), 'original:png', 'A stale project thumbnail must stay cleared');
send('RESET');
window.Entry.canvas_ = null;
assert.strictEqual(send('APPLY', png).ok, false);
window.Entry.canvas_ = owner;
send('APPLY', png);
listeners.pagehide[0]();
assert.strictEqual(owner.toDataURL, original);
console.log('[check-thumbnail-override] OK: restoration, idempotency, project change, invalid input, other wrappers');
