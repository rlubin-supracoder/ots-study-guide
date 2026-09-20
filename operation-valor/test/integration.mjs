import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
const base = 'http://127.0.0.1:8787';
const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Valor-Request': '1' };
for (const route of ['/', '/map', '/map/', '/control', '/control/', '/privacy.html']) {
  const response = await fetch(base + route, { redirect: 'error' });
  assert.equal(response.status, 200, `Page ${route} loads without redirect loops`);
  assert.match(response.headers.get('Content-Type'), /text\/html/);
}
assert.equal((await fetch(base + '/control.html')).status, 404);
async function request(path, body, cookie) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('Set-Cookie')?.split(';')[0] };
}
async function reset() {
  let state = (await request('/api/control/state')).data;
  if (state.status === 'active') state = (await request('/api/control/action', { action: 'end', exerciseId: state.exerciseId })).data;
  return (await request('/api/control/action', { action: 'clear', exerciseId: state.exerciseId })).data;
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for a live map update');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function openMap(cookie) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/team/live', { headers: { Origin: base, Cookie: cookie } });
  const updates = [];
  socket.on('message', message => { if (String(message) !== 'pong') updates.push(JSON.parse(String(message))); });
  const closed = once(socket, 'close');
  await once(socket, 'open');
  await until(() => updates.length > 0);
  return { socket, updates, closed };
}
let state = await reset();
state = (await request('/api/control/action', { action: 'start', exerciseId: state.exerciseId })).data;
const people = await Promise.all(Array.from({ length: 100 }, (_, index) => request('/api/join', { name: `Test ${index + 1}` })));
assert(people.every(person => person.status === 200));
assert.equal(new Set(people.map(person => person.data.participant.number)).size, 100);
assert.equal((await request('/api/join', { name: 'Extra' })).status, 409);
assert.equal((await request('/api/team/state')).status, 401, 'Anonymous visitors cannot read the shared roster');
assert.equal((await request('/api/team/state', undefined, 'valor-dev=invalid')).status, 401);
const maps = await Promise.all(people.slice(0, 25).map(person => openMap(person.cookie)));
assert(maps.every(map => map.updates[0].participants.length === 100));
const now = Date.now();
const fixes = people.slice(0, 20).map((person, index) => ({ requestId: crypto.randomUUID(), latitude: 40.781 + index * .00005, longitude: -73.966 + index * .00004, accuracy: 4, capturedAt: now, exerciseId: state.exerciseId }));
const results = await Promise.all(fixes.map((fix, index) => request('/api/ping', fix, people[index].cookie)));
assert(results.every(result => result.status === 200));
const snapshot = (await request('/api/control/state')).data;
assert.equal(snapshot.participants.filter(person => person.ping).length, 20);
await until(() => maps.every(map => map.updates.at(-1).participants.filter(person => person.ping).length === 20));
const shared = await request('/api/team/state', undefined, people[0].cookie);
assert.equal(shared.data.participants.length, 100);
assert.equal(shared.data.participants.filter(person => person.ping).length, 20);
assert(shared.data.participants.every(person => !('tokenHash' in person)));
// localhost is deliberately outside the 127.0.0.1-only controller preview bypass.
const protectedBase = base.replace('127.0.0.1', 'localhost');
const participantCookie = people[0].cookie.replace('valor-dev=', '__Host-valor=');
assert.equal((await fetch(protectedBase + '/api/team/state', { headers: { Cookie: participantCookie } })).status, 200);
const forgedAdmin = await fetch(protectedBase + '/api/control/remove', {
  method: 'POST', headers: { ...headers, Cookie: participantCookie, 'X-Controller': 'verified' },
  body: JSON.stringify({ exerciseId: state.exerciseId, number: people[1].data.participant.number }),
});
assert([401, 503].includes(forgedAdmin.status), 'Participant cookie and forged headers cannot grant admin access');
assert.equal((await request('/api/team/remove', { exerciseId: state.exerciseId, number: 2 }, people[0].cookie)).status, 404);
const isolated = (await request('/api/session', undefined, people[0].cookie)).data;
assert(!('participants' in isolated));
assert.equal(isolated.participant.number, people[0].data.participant.number);
assert.equal((await request('/api/ping', fixes[0])).status, 401);
assert.equal((await request('/api/ping', fixes[0], people[0].cookie)).data.participant.pingCount, 1);
const crossOrigin = await fetch(base + '/api/ping', { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: JSON.stringify(fixes[0]) });
assert.equal(crossOrigin.status, 403);
const duplicate = await request('/api/join', { name: 'Test 1' });
assert.equal(duplicate.status, 409);
const removedNumber = people[0].data.participant.number;
assert.equal((await request('/api/control/remove', { exerciseId: 'old-exercise', number: removedNumber })).status, 409);
assert.equal((await request('/api/control/remove', { exerciseId: state.exerciseId, number: removedNumber })).status, 200);
assert.equal((await maps[0].closed)[0], 4001, 'Removal revokes the open participant map');
assert.equal((await request('/api/team/state', undefined, people[0].cookie)).status, 401);
assert.equal((await request('/api/ping', fixes[0], people[0].cookie)).status, 401);
await until(() => maps.slice(1).every(map => !map.updates.at(-1).participants.some(person => person.number === removedNumber)));
assert.equal((await request('/api/session', undefined, people[1].cookie)).data.participant.number, people[1].data.participant.number);
const rejoined = await request('/api/join', { name: 'Test 1' }, people[0].cookie);
assert.equal(rejoined.data.participant.number, 101, 'Removed numbers are not reused');
state = (await request('/api/control/action', { action: 'end', exerciseId: state.exerciseId })).data;
assert.equal((await request('/api/ping', fixes[0], people[0].cookie)).status, 409);
await reset();
assert((await Promise.all(maps.slice(1).map(map => map.closed))).every(([code]) => code === 4001), 'Clearing revokes all participant map connections');
assert.equal((await request('/api/team/state', undefined, people[1].cookie)).status, 401);
console.log('Integration passed: 100 registrations, 20 simultaneous pings, 25 live participant maps, shared visibility, admin-only removal, revocation, stable numbers, origin checks, and exercise closure.');

// Seed a clearly named, local-only synthetic exercise for visual verification.
state = (await request('/api/control/action', { action: 'start', exerciseId: (await request('/api/control/state')).data.exerciseId })).data;
for (const [index, name] of ['Demo Wolf', 'Demo Falcon', 'Demo Raven'].entries()) {
  const person = await request('/api/join', { name });
  if (index < 2) await request('/api/ping', { exerciseId: state.exerciseId, requestId: crypto.randomUUID(), latitude: 40.781 + index * .0008, longitude: -73.966 + index * .0006, accuracy: index ? 12 : 4, capturedAt: Date.now(), acceptApproximate: !!index }, person.cookie);
}
console.log('Local preview seeded with three demo participants and two synthetic Central Park locations.');
