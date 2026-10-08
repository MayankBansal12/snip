import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands, normalizeEdits } from '../src/engine/index.ts';
import { validateEdits } from '../src/engine/validation.ts';
import { defaults, migrateEdits, sequenceDuration } from '../src/types.ts';
import { blurActive, blurPixels, blurRangeStatus, blurTimecode, fitBlurRange, parseBlurTimecode } from '../src/blur.ts';

const blur = { id: 'blur-a', x: .2, y: .3, width: .4, height: .25, start: 2, end: 8, strength: 70 };
const base = () => ({ ...defaults(10), clips: [{ id: 'clip-a', start: 0, end: 10 }], blurs: [blur] });

test('old projects acquire empty blur state without losing their edits', () => {
  const { blurs: _, ...old } = base();
  assert.deepEqual(validateEdits(old, 10).blurs, []);
  assert.deepEqual(normalizeEdits(old, 10).blurs, []);
  assert.deepEqual(migrateEdits(old, 10).blurs, []);
  assert.deepEqual(migrateEdits(old, 10).clips, old.clips);
});

test('independent ranges survive splits, speed, reorder, delete, and a shorter video', () => {
  const edited = applyCommands(base(), [
    { action: 'splitClip', clipId: 'clip-a', sourceTime: 5, rightClipId: 'clip-b' },
    { action: 'setSpeed', clipId: 'clip-b', speed: 2 },
    { action: 'reorderClips', clipIds: ['clip-b', 'clip-a'] },
    { action: 'deleteClip', clipId: 'clip-a' },
  ], 10);
  assert.equal(sequenceDuration(edited), 2.5);
  assert.deepEqual(edited.blurs, [blur]);
  assert.deepEqual(validateEdits(JSON.parse(JSON.stringify(edited)), 10).blurs, [blur]);
});

test('multiple overlapping blur ranges have independent, exclusive end boundaries', () => {
  const second = { ...blur, id: 'blur-b', start: 5, end: 9, x: .6, width: .3 };
  const edited = normalizeEdits({ ...base(), blurs: [blur, second] }, 10);
  assert.deepEqual(edited.blurs.filter(b => blurActive(b, 6)).map(b => b.id), ['blur-a', 'blur-b']);
  assert.deepEqual(edited.blurs.filter(b => blurActive(b, 8)).map(b => b.id), ['blur-b']);
  assert.equal(blurActive(blur, 1.999), false);
  assert.equal(blurActive(blur, 2), true);
});

test('damaged geometry, timing, IDs and strengths are rejected', () => {
  for (const patch of [{ x: NaN }, { x: .9 }, { width: 0 }, { start: -1 }, { end: 2 }, { end: 41 }, { strength: 0 }, { strength: Infinity }]) {
    assert.throws(() => validateEdits({ ...base(), blurs: [{ ...blur, ...patch }] }, 10));
  }
  assert.throws(() => normalizeEdits({ ...base(), blurs: [blur, blur] }, 10));
  assert.throws(() => normalizeEdits({ ...base(), blurs: [{ ...blur, typo: true }] }, 10));
  assert.throws(() => validateEdits({ ...base(), blurs: null }, 10));
  assert.deepEqual(blurPixels({ ...blur, x: .999, y: .999, width: .001, height: .001 }, 320, 180), { x: 319, y: 179, width: 1, height: 1 });
});

test('trimmed videos expose clipped and outside ranges without discarding saved timing', () => {
  const partial = { ...blur, start: 4, end: 8 }, outside = { ...blur, start: 7, end: 9 };
  assert.equal(blurRangeStatus(partial, 6), 'clipped');
  assert.equal(blurRangeStatus(outside, 6), 'outside');
  assert.deepEqual(fitBlurRange(partial, 6), { start: 4, end: 6 });
  assert.deepEqual(fitBlurRange(outside, 6), { start: 4, end: 6 });
  assert.deepEqual(fitBlurRange({ ...outside, end: 20 }, 6), { start: 0, end: 6 });
  assert.equal(partial.end, 8); assert.equal(outside.start, 7);
});

test('precise timecodes support minutes and retain millisecond boundaries', () => {
  for (const time of [0, .01, 1.234, 59.999, 60, 125.67]) assert.equal(parseBlurTimecode(blurTimecode(time)), time);
  assert.equal(parseBlurTimecode('2:05.67'), 125.67);
  assert.equal(parseBlurTimecode('0:5'), 5);
  assert.equal(parseBlurTimecode(' 5.5 '), 5.5);
  for (const value of ['', '-1', '1:60', 'NaN', '1e3', '1:20.1234', '1:02:03']) assert.equal(parseBlurTimecode(value), null);
});

test('blur names survive project validation and migration keeps their identity after removal', () => {
  const named = { ...blur, name: 'email' };
  assert.deepEqual(validateEdits({ ...base(), blurs: [named] }, 10).blurs, [named]);
  const migrated = migrateEdits({ ...base(), blurs: [blur, { ...blur, id: 'second' }] }, 10);
  assert.equal(migrated.blurs[1].name, 'blur 2');
  assert.equal(normalizeEdits({ ...migrated, blurs: migrated.blurs.slice(1) }, 10).blurs[0].name, 'blur 2');
  assert.throws(() => validateEdits({ ...base(), blurs: [{ ...named, name: 'x'.repeat(81) }] }, 10));
});
