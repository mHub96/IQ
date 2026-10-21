// Who may use a hospital's ER page: the owner's pick of its admins.
// Run: node --test worker/test/eraccess.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { erListed } from '../src/eraccess.js';

test('a hospital without a list is open to all its admins (switched on before lists existed)', () => {
  assert.equal(erListed(null, { a: 'acc1' }), true);
  assert.equal(erListed(null, {}), true);
});

test('with a list: the picked accounts, and the shared admin password only when picked', () => {
  assert.equal(erListed('["acc1"]', { a: 'acc1' }), true);
  assert.equal(erListed('["acc1"]', { a: 'acc2' }), false);
  assert.equal(erListed('[]', { a: 'acc1' }), false, 'switched on, nobody picked yet');
  assert.equal(erListed('["shared"]', {}), true);
  assert.equal(erListed('["acc1"]', {}), false);
  assert.equal(erListed(['acc1'], { a: 'acc1' }), true, 'an array works too');
});
