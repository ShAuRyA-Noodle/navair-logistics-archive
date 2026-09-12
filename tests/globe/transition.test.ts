import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatLocation, transitionAt } from '../../src/components/globe/globe-transition';

test('southern fade preserves continents and softly removes Antarctica', async () => {
  const { flatLandOpacity } = await import('../../src/components/globe/globe-transition');
  assert.equal(flatLandOpacity(-55), 1);
  assert.equal(flatLandOpacity(-44), 1);
  assert.equal(flatLandOpacity(-70), 0);
  assert.ok(flatLandOpacity(-62) > 0 && flatLandOpacity(-62) < 1);
  assert.ok(Math.abs(flatLandOpacity(-62.001) - flatLandOpacity(-62)) < 0.001);
});

test('centres the sphere before unfolding, and unfolds before docking', () => {
  assert.deepEqual(transitionAt(0), { centre: 0, flatten: 0, dock: 0, copy: 0 });
  assert.equal(transitionAt(0.28).centre, 1);
  assert.equal(transitionAt(0.28).flatten, 0);
  assert.equal(transitionAt(0.68).flatten, 1);
  assert.equal(transitionAt(0.68).dock, 0);
  assert.deepEqual(transitionAt(1), { centre: 1, flatten: 1, dock: 1, copy: 1 });
});
test('scroll is reversible, finite, bounded and continuous at stage boundaries', () => {
  for (const p of [0.1, 0.28, 0.3, 0.68, 0.7, 0.96]) {
    const state = transitionAt(p);
    transitionAt(1);
    assert.deepEqual(transitionAt(p), state);
    for (const key of Object.keys(state) as (keyof typeof state)[]) {
      assert.ok(Math.abs(transitionAt(p + 0.00001)[key] - state[key]) < 0.001);
    }
  }
  assert.deepEqual(transitionAt(-1), transitionAt(0));
  assert.deepEqual(transitionAt(2), transitionAt(1));
  assert.deepEqual(transitionAt(NaN), transitionAt(0));
});
test('flat map has correct geographic orientation and shared endpoint coordinates', () => {
  const centre = flatLocation(0, 0);
  assert.deepEqual(centre, [0, 0, 0.04]);
  assert.ok(flatLocation(45, 90)[0] > 0);
  assert.ok(flatLocation(45, 90)[1] > 0);
  assert.equal(flatLocation(0, 180)[0] - flatLocation(0, -180)[0], 2.7);
});
