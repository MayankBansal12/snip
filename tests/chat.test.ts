import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { applyCommands, normalizeEdits } from '../src/engine/index';
import { defaults, sequenceDuration } from '../src/types';
import { compileAnswer, createPlan, controlText, numbersIn, readRequest } from '../server/planner';
import { intentQuestions, readIntent } from '../server/intent';
import type { Control } from '../server/intent';
import { handleEdit } from '../server/edit';

function intentAnswer(requested: Control[]) {
  const answers: Record<string, { type: string; noul?: number; choice?: string; confidence?: number }> = Object.fromEntries(Object.keys(intentQuestions()).map(name => [name, { type: 'noul', noul: requested.includes(name as Control) ? .99 : .01 }]));
  answers.timing = { type:'choice', choice:requested.includes('split') ? (requested.includes('trim') ? 'both' : 'split') : requested.includes('trim') ? 'trim' : 'none', confidence:1 };
  return { answers };
}

function fixture(text = 'make it 2x faster') {
  const edits = defaults(12); edits.clips[0].id = 'a';
  return readRequest({ text, requestId: 'test', sessionId: 'session', revision: 3, project: { duration: 12, edits, selectedClip: 'a', time: 3 } });
}
function answer(request: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  const dependencies = new Set(['speedScope', 'zoomScope', 'anchor']);
  const requested = Object.keys(overrides).filter(name => !dependencies.has(name)) as Control[];
  const plan = createPlan(request, requested);
  const answers = Object.fromEntries(Object.entries(plan.choices).map(([name, options]) => {
    const value = name in overrides ? overrides[name] : name.endsWith('Scope') ? 'all' : name === 'anchor' ? { x: .5, y: .5 } : null;
    const choice = Object.entries(options).find(([, option]) => JSON.stringify(option.value) === JSON.stringify(value))?.[0];
    assert(choice, `Missing ${name} option ${JSON.stringify(value)}`);
    return [name, { type: 'choice', choice, confidence: 1 }];
  }));
  return { plan, raw: { answers } };
}

test('a split plus speed and zoom produces one revision-bound, deterministic batch', () => {
  const request = fixture('split at 4 seconds and make the second clip 2x faster');
  const { plan, raw } = answer(request, { split: 4, speed: 2, speedScope: 1, zoom: 1.5, zoomScope: 1 });
  const result = compileAnswer(request, plan, raw);
  assert.deepEqual(result, compileAnswer(request, plan, raw));
  assert.equal(result.batch.revision, 3); assert.equal(result.batch.sessionId, 'session');
  const edited = applyCommands(request.project.edits, result.batch.commands, 12);
  assert.equal(edited.clips.length, 2); assert.equal(sequenceDuration(edited), 8);
  assert.equal(edited.clips[0].speed, 1); assert.equal(edited.clips[1].speed, 2); assert.equal(edited.clips[1].zoom?.scale, 1.5);
});

test('timeline trims convert through speed and preserve original source ranges after reordering', () => {
  const request = fixture('keep only 1 to 5 seconds');
  request.project.edits = normalizeEdits({ ...request.project.edits, clips: [{ id: 'a', start: 6, end: 12, speed: 2 }, { id: 'b', start: 0, end: 6, speed: 1 }] }, 12);
  const { plan, raw } = answer(request, { trim: { start: 1, end: 5, remove: false } });
  const result = applyCommands(request.project.edits, compileAnswer(request, plan, raw).batch.commands, 12);
  assert.deepEqual(result.clips.map(c => [c.start, c.end, c.speed]), [[8, 12, 2], [0, 2, 1]]);
  assert.equal(sequenceDuration(result), 4);
});

test('removing a middle interval retains both sides with inherited effects', () => {
  const request = fixture('remove 2 to 4 seconds');
  const { plan, raw } = answer(request, { trim: { start: 2, end: 4, remove: true } });
  const result = applyCommands(request.project.edits, compileAnswer(request, plan, raw).batch.commands, 12);
  assert.deepEqual(result.clips.map(c => [c.start, c.end]), [[0, 2], [4, 12]]);
  assert.equal(sequenceDuration(result), 10);
});

test('unsupported, low-confidence, forged and invalid multi-edit answers never mutate the project', () => {
  const request = fixture(), before = structuredClone(request);
  const { plan, raw } = answer(request, { speed: 2, delete: 'selected' });
  assert.throws(() => compileAnswer(request, plan, raw), /current timeline/);
  assert.deepEqual(request, before);
  raw.answers.speed.confidence = .1;
  assert.throws(() => compileAnswer(request, plan, raw), /clear enough/);
  raw.answers.speed.confidence = 1; raw.answers.speed.choice = '__proto__';
  assert.throws(() => compileAnswer(request, plan, raw), /unreadable/);
});

test('exact numbers, word numbers, minutes and timecodes become bounded options', () => {
  assert.deepEqual(numbersIn('from 1:02.5 to 2:03, two minutes, half speed'), [62.5, 123, 120, .5]);
  assert.throws(() => readRequest({ ...fixture(), text: 'a'.repeat(1201) }), /incomplete/);
  assert.throws(() => readRequest({ ...fixture(), project: { ...fixture().project, time: Infinity } }), /incomplete/);
  const plan = createPlan(fixture('0 1 2 3 4 5 6 7 8 9 10 11'), ['trim']);
  for (const question of Object.values(plan.questions)) assert(Object.keys(question.criteria).length <= 255);
});

test('HTTP handler protects credentials, validates requests and sends only text and edit metadata', async () => {
  const request = fixture(); let calls = 0;
  const server = createServer((req, res) => void handleEdit(req, res, { apiKey: 'server-only-test-key', fetch: (async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'jev-1.13.0');
    if (calls === 1) assert.equal(body.state.user_request, request.text);
    else assert.equal(body.questions.speed.instructions.user_request, request.text);
    assert(!('file' in body.state)); assert(!('name' in body.state));
    assert(!JSON.stringify(body).includes('server-only-test-key'));
    if (calls === 1) return new Response(JSON.stringify(intentAnswer(['speed'])));
    assert.deepEqual(Object.keys(body.questions).sort(), ['speed', 'speedScope']);
    const { raw } = answer(request, { speed: 2 });
    return new Response(JSON.stringify(raw));
  }) as typeof fetch }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/edit`;
  try {
    assert.equal((await fetch(url)).status, 405);
    const forbidden = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site' }, body: JSON.stringify(request) });
    assert.equal(forbidden.status, 403);
    const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400); assert.equal(calls, 0);
    const result = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
    const body = await result.text(); assert(!body.includes('server-only-test-key'));
    assert.equal(JSON.parse(body).batch.commands[0].speed, 2); assert.equal(calls, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('irrelevant speculative answers cannot block a split or add unwanted changes', () => {
  const request = fixture('split at 4 seconds');
  const { plan, raw } = answer(request, { split: 4 });
  assert.deepEqual(Object.keys(plan.questions), ['split']);
  raw.answers.trim = { type: 'choice', choice: 'unsupported', confidence: 1 };
  raw.answers.muted = { type: 'choice', choice: 'v0', confidence: 1 };
  const result = compileAnswer(request, plan, raw);
  assert.deepEqual(result.batch.commands.map(c => c.action), ['splitClip']);
});

test('position-only zoom keeps magnification, preserves clip scope and names the focus', () => {
  const request = fixture('zoom needs to be in top left side');
  request.project.edits.clips[0].zoom = { scale: 2, x: .5, y: .5 };
  const { plan, raw } = answer(request, { zoom: 'keep', zoomScope: 'selected', anchor: { x: 0, y: 0 } });
  const result = compileAnswer(request, plan, raw);
  assert.deepEqual(result.batch.commands, [{ action: 'setZoom', clipId: 'a', zoom: { scale: 2, x: 0, y: 0 } }]);
  assert.match(result.summary, /clip 1: zoom 2× · top left/);
  request.project.edits.clips[0].zoom.scale = 1;
  const firstZoom = compileAnswer(request, plan, raw).batch.commands[0];
  assert.equal(firstZoom.action === 'setZoom' && firstZoom.zoom.scale, 1.5);
});

test('changing zoom scale preserves an existing focus and bare faster is relative', () => {
  const request = fixture('make it faster and zoom in');
  request.project.edits.clips[0].speed = 2;
  request.project.edits.clips[0].zoom = { scale: 2, x: 0, y: 0 };
  const { plan, raw } = answer(request, { speed: 'faster', zoom: 'in', anchor: null });
  const result = applyCommands(request.project.edits, compileAnswer(request, plan, raw).batch.commands, 12);
  assert.equal(result.clips[0].speed, 4);
  assert.deepEqual(result.clips[0].zoom, { scale: 3, x: 0, y: 0 });
});

test('the intent gate rejects unsupported clauses and malformed answers', () => {
  const raw = intentAnswer(['split']);
  raw.answers.speed.noul = .5; // An undecided, unrelated control must not veto or mutate a split.
  assert.deepEqual(readIntent(raw), ['split']);
  raw.answers.unsupported.noul = .95;
  assert.throws(() => readIntent(raw), /can’t inspect/);
  raw.answers.unsupported.noul = .01; raw.answers.timing.confidence = NaN;
  assert.throws(() => readIntent(raw), /unreadable/);
});


test('compound clauses keep trim seconds out of zoom scope and preserve numeric ranges', () => {
  const text = 'trim 5 seconds and apply 2x zoom in middle';
  assert.equal(controlText(text, 'trim'), 'trim 5 seconds');
  assert.equal(controlText(text, 'zoom'), 'apply 2x zoom in middle');
  assert.equal(controlText('keep between 2 and 5 seconds and zoom 2x', 'trim'), 'keep between 2 and 5 seconds');
  const plan = createPlan(fixture(text), ['trim', 'zoom']);
  assert.equal(plan.questions.zoomScope.instructions.user_request, 'apply 2x zoom in middle');
  assert(!('user_request' in plan.state));
});

test('a bare five-second trim plus centered zoom compiles against the screenshot timeline', () => {
  const request = fixture('trim 5 seconds and apply 2x zoom in middle');
  request.project.duration = 50.2;
  request.project.edits = normalizeEdits({ ...request.project.edits, clips: [{id:'a', start:0, end:4}, {id:'b', start:6, end:50.2}] }, 50.2);
  const { plan, raw } = answer(request, { trim: { start:5, end:48.2, remove:false }, zoom:2, anchor:{x:.5,y:.5} });
  const result = compileAnswer(request, plan, raw);
  const edited = applyCommands(request.project.edits, result.batch.commands, 50.2);
  assert.deepEqual(edited.clips.map(c=>[c.start,c.end,c.zoom]), [[7,50.2,{scale:2,x:.5,y:.5}]]);
  assert.match(result.summary, /removed first 5s/);
  assert.match(result.summary, /zoom 2× · center/);
});


test('relative splits resolve from the playhead in edited timeline seconds across reordered, sped-up clips', () => {
  const request = fixture('split 3 seconds after');
  request.project.edits = normalizeEdits({ ...request.project.edits, clips: [{ id: 'a', start: 6, end: 12, speed: 2 }, { id: 'b', start: 0, end: 6, speed: 1 }] }, 12);
  request.project.time = 2;
  const { plan, raw } = answer(request, { split: { offset: 3 } });
  const result = compileAnswer(request, plan, raw);
  const edited = applyCommands(request.project.edits, result.batch.commands, 12);
  assert.deepEqual(edited.clips.map(c => [c.start, c.end, c.speed]), [[6, 12, 2], [0, 2, 1], [2, 6, 1]]);
  assert.equal(sequenceDuration(edited), 9);
  assert.match(result.summary, /split at 5s \(3s after the playhead\)/);
});

test('relative before, absolute timestamps and the playhead remain distinct split choices', () => {
  const request = fixture('split 3 seconds before');
  request.project.time = 7.6;
  for (const [split, expected] of [[{ offset: -3 }, 4.6], [3, 3], [7.6, 7.6]] as const) {
    const { plan, raw } = answer(request, { split });
    const result = compileAnswer(request, plan, raw);
    const edited = applyCommands(request.project.edits, result.batch.commands, 12);
    assert.equal(edited.clips[0].end, expected);
    assert.equal(edited.clips[1].start, expected);
  }
});

test('relative split boundaries never clamp to another timestamp or mutate the original project', () => {
  for (const [time, offset, position] of [[10, 3, 13], [9, 3, 12], [2, -3, -1], [3, -3, 0]]) {
    const request = fixture(`split 3 seconds ${offset > 0 ? 'after' : 'before'}`);
    request.project.time = time;
    const before = structuredClone(request);
    const { plan, raw } = answer(request, { split: { offset } });
    assert.throws(() => compileAnswer(request, plan, raw), new RegExp(`lands at ${position}s, outside`));
    assert.deepEqual(request, before);
  }
  const request = fixture('split 3 seconds after');
  request.project.edits = normalizeEdits({ ...request.project.edits, clips: [{ id:'a', start:0, end:4 }, { id:'b', start:4, end:12 }] }, 12);
  request.project.time = 1;
  const { plan, raw } = answer(request, { split: { offset:3 } });
  assert.throws(() => compileAnswer(request, plan, raw), /already a split at 4s/);
});


test('timing intent distinguishes a split, a trim, and an explicitly requested combination', () => {
  for (const requested of [['split'], ['trim'], ['split', 'trim'], ['zoom']] as Control[][]) {
    assert.deepEqual(readIntent(intentAnswer(requested)), requested);
  }
  const raw = intentAnswer(['split']);
  raw.answers.trim = { type:'noul', noul:1 }; // Ignore unrelated/legacy independent answers.
  assert.deepEqual(readIntent(raw), ['split']);
  raw.answers.timing.choice = '__proto__';
  assert.throws(() => readIntent(raw), /unreadable/);
});
