import test from 'node:test';
import assert from 'node:assert/strict';
import { acquirePosition } from '../public/acquire.mjs';
function harness() {
  const calls = { cleared: [], progress: [] }; let success, failure, timeout;
  const geolocation = { watchPosition(ok, fail, options) { success = ok; failure = fail; calls.options = options; return 9; }, clearWatch(id) { calls.cleared.push(id); } };
  const timers = { setTimeout(fn) { timeout = fn; return 7; }, clearTimeout() {} };
  const job = acquirePosition({ geolocation, timers, now: () => 100000, onProgress: fix => calls.progress.push(fix) });
  return { job, calls, fix(accuracy, timestamp = 100000) { success({ coords: { latitude: 32.38, longitude: -86.36, accuracy }, timestamp }); }, error(code) { failure({ code }); }, timeout() { timeout(); } };
}
test('requests fresh high accuracy and stops at five meters', async () => {
  const h = harness(); h.fix(18); h.fix(5);
  assert.equal((await h.job.promise).accuracy, 5);
  assert.deepEqual(h.calls.options, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  assert.deepEqual(h.calls.cleared, [9]);
});
test('timeout returns the best estimate for explicit confirmation, not an automatic send', async () => {
  const h = harness(); h.fix(30); h.fix(11); h.fix(19); h.timeout();
  assert.equal((await h.job.promise).accuracy, 11);
});
test('ignores old and invalid readings; handles permission denial and cancellation', async () => {
  const h = harness(); h.fix(2, 1000); h.fix(0); h.timeout();
  await assert.rejects(h.job.promise, /No fresh/);
  const denied = harness(); denied.error(1); await assert.rejects(denied.job.promise, /permission was denied/);
  const cancelled = harness(); cancelled.job.cancel(); await assert.rejects(cancelled.job.promise, /cancelled/);
  assert.deepEqual(cancelled.calls.cleared, [9]);
});
