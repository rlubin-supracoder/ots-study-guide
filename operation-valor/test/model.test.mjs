import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, changeExercise, register, recordPing, publicParticipant, validatePing, removeParticipant, RETENTION_MS } from '../src/model.mjs';
import { controllerIdentity, requireSameOrigin, readBody } from '../src/auth.mjs';
const start = () => changeExercise(initialState(), 'start', Date.now());
const fix = (overrides = {}) => ({ latitude: 32.38, longitude: -86.36, accuracy: 4, capturedAt: Date.now(), requestId: crypto.randomUUID(), ...overrides });

test('joining requires one of the three groups and shares it without exposing the token', () => {
  const state = start();
  for (const group of [undefined, null, '', 'alpha', 'Delta', '<script>', {}, ['Alpha']]) {
    assert.throws(() => register(state, 'Wolf', 'a', Date.now(), group), /Choose Alpha/);
  }
  assert.equal(state.participants.length, 0);
  assert.equal(state.nextNumber, 1);
  for (const group of ['Alpha', 'Bravo', 'Charlie']) {
    const person = register(state, group, group, Date.now(), group);
    assert.equal(publicParticipant(person).group, group);
    assert(!('tokenHash' in publicParticipant(person)));
  }
  assert.equal(register(state, 'Other name', 'Alpha', Date.now(), 'Bravo').group, 'Alpha');
});

test('an existing participant can select a group without losing identity or their latest check-in', () => {
  const state = start();
  const person = register(state, 'Wolf', 'a', Date.now(), 'Alpha');
  recordPing(state, 'a', state.exerciseId, fix(), Date.now());
  delete person.group; // Exercise state saved by the previous deployment.
  const before = structuredClone(person);
  assert.equal(publicParticipant(person).group, null);
  assert.throws(() => register(state, 'Ignored', 'a', Date.now(), 'Delta'), /Choose Alpha/);
  assert.deepEqual(person, before);
  assert.equal(register(state, 'Ignored', 'a', Date.now(), 'Charlie'), person);
  assert.deepEqual(person, { ...before, group: 'Charlie' });
  assert.equal(state.participants.length, 1);
  assert.equal(state.nextNumber, 2);
  assert.equal(register(state, 'Ignored', 'a', Date.now()).group, 'Charlie');
});

test('100 unique participants retain stable numbers; collisions and over-capacity joins fail', () => {
  const state = start();
  for (let i = 1; i <= 100; i++) assert.equal(register(state, `Wolf ${i}`, `token-${i}`, Date.now(), 'Alpha').number, i);
  assert.equal(register(state, 'Different name', 'token-7', Date.now(), 'Alpha').number, 7);
  assert.throws(() => register(state, 'Wolf 101', 'token-101', Date.now(), 'Alpha'), /limit/);
  assert.throws(() => register(start(), '<script>bad</script>', 'token', Date.now(), 'Alpha'), /letters/);
  const duplicate = start(); register(duplicate, 'Wolf', 'a', Date.now(), 'Alpha');
  assert.throws(() => register(duplicate, 'wolf', 'b', Date.now(), 'Alpha'), /already assigned/);
});
test('participant tokens isolate locations; retries are idempotent and stale fixes cannot overwrite', () => {
  const state = start(); register(state, 'Wolf', 'a', Date.now(), 'Alpha'); register(state, 'Falcon', 'b', Date.now(), 'Alpha');
  const ping = fix(); const now = Date.now();
  recordPing(state, 'a', state.exerciseId, ping, now);
  recordPing(state, 'a', state.exerciseId, ping, now + 5000);
  assert.equal(state.participants[0].pingCount, 1);
  assert.equal(state.participants[1].ping, null);
  assert.throws(() => recordPing(state, 'unknown', state.exerciseId, fix(), now), /Join/);
  assert.throws(() => recordPing(state, 'a', 'old-exercise', fix(), now), /new exercise/);
  assert.throws(() => recordPing(state, 'a', state.exerciseId, fix({ capturedAt: ping.capturedAt - 1 }), now + 5000), /newer location/);
  assert(!('tokenHash' in publicParticipant(state.participants[0])));
});
test('invalid coordinates, stale readings, and unconfirmed approximate fixes fail', () => {
  const now = Date.now();
  for (const change of [{ latitude: 91 }, { longitude: -181 }, { accuracy: 0 }, { accuracy: NaN }, { capturedAt: now - 600001 }, { capturedAt: now + 60001 }, { latitude: '32' }, { requestId: 'bad' }]) {
    assert.throws(() => validatePing(fix(change), now));
  }
  assert.throws(() => validatePing(fix({ accuracy: 12 }), now), /explicitly/);
  assert.equal(validatePing(fix({ accuracy: 12, acceptApproximate: true }), now).quality, 'approximate');
  assert.equal(validatePing(fix({ accuracy: 5 }), now).quality, 'target-met');
});
test('end blocks joins and pings; clear resets exercise and numbering', () => {
  const state = start(), originalId = state.exerciseId;
  register(state, 'Wolf', 'a', Date.now(), 'Alpha');
  assert.throws(() => changeExercise(state, 'clear', Date.now()), /End/);
  assert.equal(state.expiresAt - state.startedAt, RETENTION_MS);
  changeExercise(state, 'end', Date.now());
  assert.throws(() => recordPing(state, 'a', originalId, fix(), Date.now()), /closed/);
  assert.throws(() => register(state, 'Falcon', 'b', Date.now(), 'Alpha'), /not opened/);
  assert.throws(() => changeExercise(state, 'start', Date.now()), /Clear/);
  changeExercise(state, 'clear', Date.now());
  assert.equal(state.participants.length, 0); assert.equal(state.nextNumber, 1); assert.notEqual(state.exerciseId, originalId);
});

test('removing a participant erases their position without renumbering others', () => {
  const state = start();
  register(state, 'Wolf', 'a', Date.now(), 'Alpha'); register(state, 'Falcon', 'b', Date.now(), 'Alpha');
  recordPing(state, 'a', state.exerciseId, fix(), Date.now());
  removeParticipant(state, 1);
  assert.deepEqual(state.participants.map(person => person.number), [2]);
  assert.throws(() => recordPing(state, 'a', state.exerciseId, fix(), Date.now()), /Join/);
  assert.throws(() => removeParticipant(state, 1), /already been removed/);
  assert.throws(() => removeParticipant(state, '2'), /Invalid/);
  assert.equal(register(state, 'Wolf', 'a', Date.now(), 'Alpha').number, 3);
});
test('controller authentication fails closed, including forged identity headers', async () => {
  const request = new Request('https://valor.russelllubinski.us/api/control/state', { headers: { 'Cf-Access-Authenticated-User-Email': 'someone@example.com', 'X-Controller': 'verified' } });
  await assert.rejects(controllerIdentity(request, {}), /not configured/);
  await assert.rejects(controllerIdentity(request, { ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'aud' }), /Sign in/);
  await assert.rejects(controllerIdentity(request, { LOCAL_PREVIEW: 'true' }), /not configured/);
});
test('mutations reject other origins and oversized bodies', async () => {
  const env = { APP_ORIGIN: 'https://valor.russelllubinski.us' };
  const req = origin => new Request(env.APP_ORIGIN + '/api/ping', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Valor-Request': '1' }, body: '{}' });
  assert.doesNotThrow(() => requireSameOrigin(req(env.APP_ORIGIN), env));
  assert.throws(() => requireSameOrigin(req('https://unrelated.example'), env), /origin/);
  await assert.rejects(readBody(new Request(env.APP_ORIGIN, { method: 'POST', body: 'x'.repeat(2049) })), /too large/);
});
