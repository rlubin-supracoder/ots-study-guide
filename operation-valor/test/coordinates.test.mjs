import test from 'node:test';
import assert from 'node:assert/strict';
import { mgrsLabel, coordinateDetails } from '../public/coordinates.mjs';

test('known WGS84 reference positions preserve axis order and five digits per axis', () => {
  // Published reference cases: https://github.com/proj4js/mgrs/blob/v2.2.0/test/test.js
  assert.equal(mgrsLabel(36.2361322, -115.0820944), '11S PA 72349 11844');
  assert.equal(mgrsLabel(0, 0), '31N AA 66021 00000');
  assert.equal(mgrsLabel(0.00001, 0), '31N AA 66021 00001');
});

test('single-digit zones are padded and special UTM zones are respected', () => {
  assert.match(mgrsLabel(21.3, -157.8), /^04Q /);
  assert.match(mgrsLabel(60, 6), /^32V /);
  assert.match(mgrsLabel(78, 15), /^33X /);
  assert.match(mgrsLabel(-33.86, 151.2), /^56H /);
  assert.match(mgrsLabel(0, 180), /^60N /);
  assert.match(mgrsLabel(0, -180), /^01N /);
});

test('unsupported or invalid positions never produce a misleading grid', () => {
  for (const [lat, lon] of [[85, 0], [-81, 0], [NaN, 0], [0, Infinity], ['32', -86], [0, 181]]) {
    assert.equal(mgrsLabel(lat, lon), null);
  }
});

const person = {
  number: 7, name: 'Demo Wolf', group: 'Alpha',
  ping: {latitude: 36.2361322, longitude: -115.0820944, accuracy: 12.5,
    capturedAt: Date.parse('2026-09-20T19:21:30.000Z'), receivedAt: Date.parse('2026-09-20T19:21:35.000Z')},
};

test('copied coordinates preserve reported accuracy and the original capture time', () => {
  const before = structuredClone(person);
  const details = coordinateDetails(person);
  assert.equal(details.latLon, '36.236132, -115.082094');
  assert.equal(details.copyText, [
    '07 — Demo Wolf (Alpha)',
    'MGRS (WGS 84): 11S PA 72349 11844 (1 m grid precision)',
    'Latitude, longitude (WGS 84): 36.236132, -115.082094',
    'Reported accuracy: 12.5 m (phone estimate)',
    'Captured: 2026-09-20T19:21:30.000Z',
    'Received: 2026-09-20T19:21:35.000Z',
  ].join('\n'));
  assert.deepEqual(person, before);
});

test('polar check-ins still expose latitude/longitude, reported accuracy and time', () => {
  const details = coordinateDetails({...person, ping: {...person.ping, latitude: 85, longitude: 0}});
  assert.equal(details.mgrs, 'Unavailable at this latitude');
  assert.equal(details.latLon, '85.000000, 0.000000');
  assert.match(details.copyText, /Reported accuracy: 12.5 m/);
  assert.match(details.copyText, /Captured: 2026-09-20T19:21:30.000Z/);
});
