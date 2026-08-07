import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectFrame } from './effectTiming.js';

test('anchors boundary effects to the scene end before transition overlap', () => {
  assert.equal(resolveEffectFrame(0, 150, 22), 128);
  assert.equal(resolveEffectFrame(-10, 150, 22), 115);
  assert.equal(resolveEffectFrame(10, 150, 22), 141);
});

test('preserves existing behavior when there is no transition overlap', () => {
  assert.equal(resolveEffectFrame(0, 150, 0), 150);
  assert.equal(resolveEffectFrame(-10, 150, 0), 135);
});
