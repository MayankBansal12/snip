import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommands, normalizeEdits } from '../src/engine/index.ts';
import { validateEdits } from '../src/engine/validation.ts';
import { defaults, migrateEdits, sequenceDuration } from '../src/types.ts';
import { blurActive, blurPixels, blurRangeStatus, blurTimecode, fitBlurRange, parseBlurTimecode, retimeBlurs } from '../src/blur.ts';

const blur = { id: 'blur-a', x: .2, y: .3, width: .4, height: .25, start: 2, end: 8, strength: 70 };
const base = () => ({ ...defaults(10), clips: [{ id: 'clip-a', start: 0, end: 10 }], blurs: [blur] });

test('old projects acquire empty blur state without losing their edits', () => {
  const { blurs: _, ...old } = base();
  assert.deepEqual(validateEdits(old, 10).blurs, []);
  assert.deepEqual(normalizeEdits(old, 10).blurs, []);
  assert.deepEqual(migrateEdits(old, 10).blurs, []);
  assert.deepEqual(migrateEdits(old, 10).clips, old.clips);
});

test('independent ranges follow their covered content through splits, speed, reorder and delete', () => {
  const edited = applyCommands(base(), [
    { action: 'splitClip', clipId: 'clip-a', sourceTime: 5, rightClipId: 'clip-b' },
    { action: 'setSpeed', clipId: 'clip-b', speed: 2 },
    { action: 'reorderClips', clipIds: ['clip-b', 'clip-a'] },
    { action: 'deleteClip', clipId: 'clip-a' },
  ], 10);
  assert.equal(sequenceDuration(edited), 2.5);
  assert.deepEqual(edited.blurs, [{ ...blur, start: 0, end: 1.5 }]);
  assert.deepEqual(validateEdits(JSON.parse(JSON.stringify(edited)), 10).blurs, edited.blurs);
});

test('a cutaway separates blur ranges without covering unrelated footage or growing on repeated reorder', () => {
  const original = { ...defaults(12), clips: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 8 }, { id: 'c', start: 8, end: 12 }], blurs: [{ ...blur, start: 2, end: 6 }] };
  const away = applyCommands(original, [{ action: 'reorderClips', clipIds: ['a', 'c', 'b'] }], 12);
  assert.deepEqual(away.blurs.map(b => [b.start, b.end]), [[2, 4], [8, 10]]);
  assert.equal(away.blurs[0].id, blur.id);
  assert.notEqual(away.blurs[1].id, blur.id);
  assert.deepEqual(away, applyCommands(original, [{ action: 'reorderClips', clipIds: ['a', 'c', 'b'] }], 12), 'Split IDs and labels must be deterministic');
  const back = applyCommands(away, [{ action: 'reorderClips', clipIds: ['a', 'b', 'c'] }], 12);
  assert.deepEqual(back.blurs.map(b => [b.start, b.end]), [[2, 4], [4, 6]]);
  const repeated = applyCommands(back, [{ action: 'reorderClips', clipIds: ['a', 'c', 'b'] }], 12);
  assert.deepEqual(repeated.blurs.map(b => [b.start, b.end]), [[2, 4], [8, 10]]);
});

test('generated blur IDs respect length limits and avoid collisions with existing IDs and names', () => {
  const long = 'x'.repeat(128), original = { ...defaults(12), clips: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 8 }, { id: 'c', start: 8, end: 12 }], blurs: [{ ...blur, id: long, name: 'blur 1', start: 2, end: 6 }, { ...blur, id: `${long.slice(0, 110)}~2`, name: 'blur 2', start: 10, end: 11 }] };
  const reordered = applyCommands(original, [{ action: 'reorderClips', clipIds: ['a', 'c', 'b'] }], 12);
  assert.equal(new Set(reordered.blurs.map(b => b.id)).size, 3);
  assert.equal(new Set(reordered.blurs.map(b => b.name)).size, 3);
  assert(reordered.blurs.every(b => b.id.length <= 128));
  assert.deepEqual(validateEdits(reordered, 12).blurs, reordered.blurs);
});

test('upstream trims and speed changes preserve coverage; deleting covered content removes the blur', () => {
  const original = { ...defaults(12), clips: [{ id: 'a', start: 0, end: 4 }, { id: 'b', start: 4, end: 12 }], blurs: [{ ...blur, start: 4, end: 12 }] };
  const trimmed = applyCommands(original, [{ action: 'trimClip', clipId: 'a', sourceStart: 2, sourceEnd: 4 }], 12);
  assert.deepEqual(trimmed.blurs, [{ ...blur, start: 2, end: 10 }]);
  const faster = applyCommands(trimmed, [{ action: 'setSpeed', clipId: 'b', speed: 2 }], 12);
  assert.deepEqual(faster.blurs, [{ ...blur, start: 2, end: 6 }]);
  const deleted = applyCommands(faster, [{ action: 'deleteClip', clipId: 'b' }], 12);
  assert.deepEqual(deleted.blurs, []);
  assert.deepEqual(original.blurs, [{ ...blur, start: 4, end: 12 }], 'Commands must leave undo snapshots intact');
});

test('partial ranges map across mixed speeds, merge and head/tail trims without including removed content', () => {
  const original = { ...defaults(12), clips: [{ id: 'a', start: 0, end: 4, speed: 1 }, { id: 'b', start: 4, end: 12, speed: 2 }], blurs: [{ ...blur, start: 3, end: 6 }] };
  const edited = applyCommands(original, [{ action: 'trimClip', clipId: 'b', sourceStart: 5, sourceEnd: 7 }], 12);
  assert.deepEqual(edited.blurs, [{ ...blur, start: 3, end: 5 }]);
  const merged = applyCommands(base(), [{ action: 'splitClip', clipId: 'clip-a', sourceTime: 5, rightClipId: 'b' }, { action: 'mergeClips', clipId: 'clip-a' }], 10);
  assert.deepEqual(merged.blurs, [blur]);
});

test('trim gestures can recover their initial coverage and outside imported ranges remain accessible', () => {
  const original = base();
  assert.deepEqual(retimeBlurs(original, { ...original, clips: [{ id: 'clip-a', start: 0, end: 1 }] }), []);
  assert.deepEqual(retimeBlurs(original, { ...original, clips: [{ id: 'clip-a', start: 0, end: 9 }] }), [blur]);
  const imported = { ...original, blurs: [{ ...blur, start: 12, end: 15 }] };
  assert.deepEqual(retimeBlurs(imported, { ...imported, clips: [{ id: 'clip-a', start: 0, end: 5 }] }), imported.blurs);
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
