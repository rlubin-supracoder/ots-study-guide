import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { TurtleRound, ROUND_MS, TARGET_MS } from '../turtle-crusher-engine.mjs';

const round = new TurtleRound(() => .5);
round.start(0);
const first = round.active;
assert.equal(round.remaining, ROUND_MS);
assert(round.hit(first, 100));
assert.equal(round.score, 10);
assert(!round.hit(first, 101), 'A turtle can only score once');
assert.equal(round.score, 10);
round.tick(600);
assert.notEqual(round.active, first, 'Consecutive turtles use different holes');
const second = round.active;
assert(!round.hit((second + 1) % 9, 700), 'Empty holes never score');
assert(!round.hit(second, 600 + TARGET_MS), 'Expired turtles never score');
assert.equal(round.score, 10);

round.start(1000);
const pausedHole = round.active;
round.pause(1400);
const remaining = round.remaining;
round.tick(50000);
assert.equal(round.remaining, remaining, 'Pausing freezes the round');
assert(!round.hit(pausedHole, 50000), 'No scoring while paused');
round.resume(50000);
assert.equal(round.active, pausedHole);
assert(round.hit(pausedHole, 50001), 'The target lifetime resumes with the round');
round.tick(50000 + remaining);
assert.equal(round.state, 'over');
assert.equal(round.remaining, 0);
assert(!round.hit(0, 50000 + remaining), 'No hits after the deadline');
round.start(100000);
assert.equal(round.score, 0);
assert.equal(round.hits, 0);
assert.equal(round.tosses, 0);
assert.equal(round.state, 'running');
round.tick(100000 + ROUND_MS - 1);
assert.equal(round.state, 'running');
round.tick(100000 + ROUND_MS);
assert.equal(round.state, 'over', 'Round lasts exactly 30 seconds');

// Exercise the real password handler independently of the large question-bank UI.
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const auth = html.split('/* ---- password gate ---- */')[1].split('/* ---- data ---- */')[0];
const elements = new Map();
let submit;
let unlocked = false;
const storage = new Map();
const events = [];
for (const id of ['passwordGate', 'passwordForm', 'passwordInput', 'passwordError']) {
  elements.set(id, {
    value: '', textContent: '', select() {},
    classList: { add() { unlocked = true; } },
    addEventListener(type, fn) { if (type === 'submit') submit = fn; },
  });
}
vm.runInNewContext(auth, {
  document: { getElementById: id => elements.get(id), dispatchEvent: event => events.push(event.type) },
  sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  CustomEvent: class { constructor(type) { this.type = type; } },
});
const input = elements.get('passwordInput');
input.value = 'wrong'; submit({ preventDefault() {} });
assert(elements.get('passwordError').textContent.includes('Incorrect'));
input.value = 'turtles'; submit({ preventDefault() {} });
assert.deepEqual(events, ['turtle-crusher:open']);
assert.equal(unlocked, false, 'Secret game must not unlock the trainer');
assert.equal(storage.size, 0, 'Secret game must not persist a trainer session');
assert.equal(input.value, '');
assert.equal(elements.get('passwordError').textContent, '');
input.value = 'Wolfpack 27-01'; submit({ preventDefault() {} });
assert.equal(unlocked, true, 'The normal trainer password must still work');
assert.equal(storage.get('ots-trainer-unlocked-v2'), '1');
console.log('Turtle Crusher checks passed: scoring, expiry, pause, restart, 30-second deadline, and isolated password entry.');
