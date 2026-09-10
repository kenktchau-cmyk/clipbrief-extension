import test from 'node:test';
import assert from 'node:assert/strict';
import { isSupportedVideoUrl, registerVideoButton, REQUEST_PREFIX } from '../video-button-bridge.js';

function setup({ rejectOpen = false } = {}) {
  let listener;
  const order = [], stored = [];
  const api = {
    runtime: { id: 'extension-under-test', onMessage: { addListener: callback => { listener = callback; } } },
    sidePanel: { open(options) { order.push({ kind: 'open', options }); return rejectOpen ? Promise.reject(new Error('No user gesture')) : Promise.resolve(); } },
    storage: { session: { async set(value) { order.push({ kind: 'store' }); stored.push(value); } } }
  };
  registerVideoButton(api);
  const sender = { id: api.runtime.id, frameId: 0, url: 'https://www.youtube.com/watch?v=fixture', tab: { id: 42, windowId: 7 } };
  return { listener, sender, order, stored };
}

test('recognizes only supported desktop video pages, not lookalike hosts or listings', () => {
  for (const url of ['https://www.youtube.com/watch?v=a', 'https://youtube.com/watch?v=b', 'https://www.bilibili.com/video/BVabc/?p=2', 'https://bilibili.com/video/av123']) assert.equal(isSupportedVideoUrl(url), true, url);
  for (const url of ['https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://www.youtube.com.evil.test/watch?v=a', 'http://youtube.com/watch?v=a', 'https://bilibili.com/video/', 'https://other.test/video/BVa', 'not a url']) assert.equal(isSupportedVideoUrl(url), false, url);
});
test('opens synchronously to preserve the click gesture, then records the actual sender tab', async () => {
  const { listener, sender, order, stored } = setup();
  let reply;
  const completed = new Promise(resolve => {
    const keepAlive = listener({ type: 'clipbrief:open-video', tabId: 999, windowId: 999, url: 'https://attacker.example' }, sender, value => { reply = value; resolve(); });
    assert.equal(keepAlive, true);
    assert.deepEqual(order, [{ kind: 'open', options: { windowId: 7 } }]);
  });
  await completed;
  assert.equal(reply.ok, true);
  const request = stored[0][`${REQUEST_PREFIX}7`];
  assert.equal(request.tabId, 42); assert.equal(request.windowId, 7); assert.equal(request.url, sender.url);
  assert.equal(typeof request.id, 'string'); assert.ok(request.createdAt <= Date.now());
  assert.deepEqual(order.map(event => event.kind), ['open', 'store']);
});
test('rejects unsupported senders and iframe requests without opening a panel', () => {
  for (const overrides of [{ frameId: 4 }, { id: 'other-extension' }, { url: 'https://malicious.test/watch?v=a' }, { tab: undefined }]) {
    const { listener, sender, order } = setup(); let response;
    listener({ type: 'clipbrief:open-video' }, { ...sender, ...overrides }, value => { response = value; });
    assert.equal(response.ok, false); assert.equal(order.length, 0);
  }
});
test('failed panel opens never queue a hidden capture', async () => {
  const { listener, sender, stored } = setup({ rejectOpen: true });
  const response = await new Promise(resolve => listener({ type: 'clipbrief:open-video' }, sender, resolve));
  assert.equal(response.ok, false); assert.equal(stored.length, 0);
});
test('unrelated messages do not claim a response channel', () => {
  const { listener, sender, order } = setup();
  assert.equal(listener({ type: 'other' }, sender, () => assert.fail('Unexpected reply')), undefined);
  assert.equal(order.length, 0);
});
