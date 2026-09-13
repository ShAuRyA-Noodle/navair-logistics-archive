import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeMapLabel } from '../../src/components/globe/map-label-layout';

test('edge country labels remain inside narrow phone screens', () => {
  for (const width of [320, 390, 430, 767]) {
    for (const x of [8, width - 8]) {
      const box = placeMapLabel(x, 120, 120, width, []);
      assert.ok(box);
      assert.ok(box.x >= 8);
      assert.ok(box.x + box.width <= width - 8);
    }
  }
});

test('nearby country labels try another side rather than overlapping', () => {
  const first = placeMapLabel(190, 120, 100, 390, [])!;
  const second = placeMapLabel(195, 125, 100, 390, [first]);
  assert.ok(second);
  assert.ok(second.x + second.width <= first.x || second.x >= first.x + first.width || second.y >= first.y + first.height || second.y + second.height <= first.y);
});
