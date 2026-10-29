import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp } from 'firebase-admin/firestore';
import { encode, decode, collectionOf } from '../scripts/lib.mjs';

test('backup encoding round-trips timestamps, nested objects, arrays, null and numbers exactly', () => {
  const doc = { start: new Timestamp(1761700000, 123000000), paidUntil: Timestamp.fromMillis(1764300000123), phone: '+260970000001',
    n: [1, 2.5, -3], nested: { t: new Timestamp(5, 6), ok: true, nothing: null }, empty: '' };
  const back = decode(JSON.parse(JSON.stringify(encode(doc))));
  assert.ok(back.start instanceof Timestamp);
  assert.equal(back.start.seconds, 1761700000); assert.equal(back.start.nanoseconds, 123000000);
  assert.equal(back.paidUntil.toMillis(), 1764300000123);
  assert.deepEqual(back.n, [1, 2.5, -3]); assert.equal(back.nested.t.nanoseconds, 6);
  assert.equal(back.nested.nothing, null); assert.equal(back.empty, '');
});

test('collectionOf groups documents by collection path', () => {
  assert.equal(collectionOf('users/abc/sales/s1'), 'users/sales');
  assert.equal(collectionOf('users/abc/meta/account'), 'users/meta');
  assert.equal(collectionOf('trials/p_+260970000001'), 'trials');
});
