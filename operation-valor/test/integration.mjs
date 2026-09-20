import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8787';
const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Valor-Request': '1' };
for (const route of ['/', '/control', '/control/', '/privacy.html']) {
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
let state = await reset();
state = (await request('/api/control/action', { action: 'start', exerciseId: state.exerciseId })).data;
const people = await Promise.all(Array.from({ length: 100 }, (_, index) => request('/api/join', { name: `Test ${index + 1}` })));
assert(people.every(person => person.status === 200));
assert.equal(new Set(people.map(person => person.data.participant.number)).size, 100);
assert.equal((await request('/api/join', { name: 'Extra' })).status, 409);
const now = Date.now();
const fixes = people.slice(0, 20).map((person, index) => ({ requestId: crypto.randomUUID(), latitude: 40.781 + index * .00005, longitude: -73.966 + index * .00004, accuracy: 4, capturedAt: now, exerciseId: state.exerciseId }));
const results = await Promise.all(fixes.map((fix, index) => request('/api/ping', fix, people[index].cookie)));
assert(results.every(result => result.status === 200));
const snapshot = (await request('/api/control/state')).data;
assert.equal(snapshot.participants.filter(person => person.ping).length, 20);
const isolated = (await request('/api/session', undefined, people[0].cookie)).data;
assert(!('participants' in isolated));
assert.equal(isolated.participant.number, people[0].data.participant.number);
assert.equal((await request('/api/ping', fixes[0])).status, 401);
assert.equal((await request('/api/ping', fixes[0], people[0].cookie)).data.participant.pingCount, 1);
const crossOrigin = await fetch(base + '/api/ping', { method: 'POST', headers: { ...headers, Origin: 'https://unrelated.example' }, body: JSON.stringify(fixes[0]) });
assert.equal(crossOrigin.status, 403);
const duplicate = await request('/api/join', { name: 'Test 1' });
assert.equal(duplicate.status, 409);
state = (await request('/api/control/action', { action: 'end', exerciseId: state.exerciseId })).data;
assert.equal((await request('/api/ping', fixes[0], people[0].cookie)).status, 409);
await reset();
console.log('Integration passed: 100 concurrent registrations, 20 simultaneous pings, isolated participant sessions, idempotency, origin checks, capacity, and exercise closure.');

// Seed a clearly named, local-only synthetic exercise for visual verification.
state = (await request('/api/control/action', { action: 'start', exerciseId: (await request('/api/control/state')).data.exerciseId })).data;
for (const [index, name] of ['Demo Wolf', 'Demo Falcon', 'Demo Raven'].entries()) {
  const person = await request('/api/join', { name });
  if (index < 2) await request('/api/ping', { exerciseId: state.exerciseId, requestId: crypto.randomUUID(), latitude: 40.781 + index * .0008, longitude: -73.966 + index * .0006, accuracy: index ? 12 : 4, capturedAt: Date.now(), acceptApproximate: !!index }, person.cookie);
}
console.log('Local preview seeded with three demo participants and two synthetic Central Park locations.');
