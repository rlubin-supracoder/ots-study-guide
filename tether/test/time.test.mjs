import test from 'node:test';import assert from 'node:assert/strict';
import {centralInput,centralToUTC,dateTime} from '../public/time.mjs';
test('Maxwell times use America/Chicago in both DST seasons',()=>{assert.equal(centralToUTC('2026-09-25T21:30'),'2026-09-26T02:30:00.000Z');assert.equal(centralToUTC('2026-12-25T21:30'),'2026-12-26T03:30:00.000Z');assert.equal(centralInput('2026-09-26T02:30:00.000Z'),'2026-09-25T21:30');assert.match(dateTime('2026-09-26T02:30:00.000Z'),/CDT/);});
test('DST gaps, repeated hours and invalid dates cannot silently choose the wrong time',()=>{assert.throws(()=>centralToUTC('2026-03-08T02:30'),/does not exist/);assert.throws(()=>centralToUTC('2026-11-01T01:30'),/occurs twice/);assert.throws(()=>centralToUTC('2026-02-30T21:00'));});
