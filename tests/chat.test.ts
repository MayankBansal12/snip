import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { applyCommands, normalizeEdits } from '../src/engine/index';
import { defaults, sequenceDuration } from '../src/types';
import { compileAnswer, createPlan, numbersIn, readRequest } from '../server/planner';
import { handleEdit } from '../server/edit';

function fixture(text = 'make it 2x faster') {
  const edits = defaults(12); edits.clips[0].id = 'a';
  return readRequest({ text, requestId: 'test', sessionId: 'session', revision: 3, project: { duration: 12, edits, selectedClip: 'a', time: 3 } });
}
function answer(request: ReturnType<typeof fixture>, overrides: Record<string, unknown> = {}) {
  const plan = createPlan(request);
  const answers = Object.fromEntries(Object.entries(plan.choices).map(([name, options]) => {
    const value = name in overrides ? overrides[name] : name === 'support' ? true : name.endsWith('Scope') ? 'all' : name === 'anchor' ? { x: .5, y: .5 } : null;
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
  raw.answers.support.choice = 'no';
  assert.throws(() => compileAnswer(request, plan, raw), /Try a trim/);
  raw.answers.support.choice = 'yes'; raw.answers.speed.confidence = .1;
  assert.throws(() => compileAnswer(request, plan, raw), /clear enough/);
  raw.answers.speed.confidence = 1; raw.answers.speed.choice = '__proto__';
  assert.throws(() => compileAnswer(request, plan, raw), /unreadable/);
});

test('exact numbers, word numbers, minutes and timecodes become bounded options', () => {
  assert.deepEqual(numbersIn('from 1:02.5 to 2:03, two minutes, half speed'), [62.5, 123, 120, .5]);
  assert.throws(() => readRequest({ ...fixture(), text: 'a'.repeat(1201) }), /incomplete/);
  assert.throws(() => readRequest({ ...fixture(), project: { ...fixture().project, time: Infinity } }), /incomplete/);
  const plan = createPlan(fixture('0 1 2 3 4 5 6 7 8 9 10 11'));
  for (const question of Object.values(plan.questions)) assert(Object.keys(question.criteria).length <= 255);
});

test('HTTP handler protects credentials, validates requests and sends only text and edit metadata', async () => {
  const request = fixture(); let calls = 0;
  const server = createServer((req, res) => void handleEdit(req, res, { apiKey: 'server-only-test-key', fetch: (async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'jev-1.13.0');
    assert.equal(body.state.user_request, request.text);
    assert(!('file' in body.state)); assert(!('name' in body.state));
    assert(!JSON.stringify(body).includes('server-only-test-key'));
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
    assert.equal(JSON.parse(body).batch.commands[0].speed, 2); assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
