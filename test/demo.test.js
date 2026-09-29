'use strict';

// Integration tests: real LangGraph + real MongoDB, fictional data only.
// Each test runs a trial through the same code path the browser uses.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { runTrial, seedFixture } from '../src/demo.js';
import { closeClient } from '../src/saver.js';

before(async () => {
  await seedFixture();
});

after(async () => {
  await closeClient();
});

test('Trial 1 - vulnerable + normal ids returns the requester (Alice)', async () => {
  const run = await runTrial({ version: '1.3.0', requestKind: 'normal' });
  assert.equal(run.status, 'ok');
  assert.equal(run.result.owner, 'Alice');
  assert.equal(run.graphNodeRan, true);
  assert.equal(run.expectedPassed, true);
  assert.equal(run.queryTrace[0].collection, 'checkpoints');
  assert.equal(run.queryTrace[0].filter.thread_id, 'alice-thread-001');
});

test('Trial 2 - vulnerable + operator object leaks another user (Bob)', async () => {
  const run = await runTrial({ version: '1.3.0', requestKind: 'operator' });
  assert.equal(run.status, 'ok');
  assert.notEqual(run.result.owner, 'Alice');
  assert.equal(run.result.owner, 'Bob');
  assert.equal(run.expectedPassed, true);
  // The submitted identifier carried an operator object, not a string.
  assert.deepEqual(run.request.configurable.thread_id, { $gt: '' });
  // The captured MongoDB filter shows the operator reached the query.
  assert.deepEqual(run.queryTrace[0].filter.thread_id, { $gt: '' });
  // The leaked content is Bob's fictional private note.
  assert.match(run.result.privateNote, /Bob's fictional note/);
});

test('Trial 3 - patched + operator object is rejected before any lookup', async () => {
  const run = await runTrial({ version: '1.3.1', requestKind: 'operator' });
  assert.equal(run.status, 'rejected');
  assert.equal(run.result, null);
  assert.match(run.error, /expected a string/);
  assert.equal(run.expectedPassed, true);
  // Rejected before the vulnerable lookup could run.
  assert.equal(run.queryTrace.length, 0);
});

test('Trial 4 - patched + normal ids still returns the requester (Alice)', async () => {
  const run = await runTrial({ version: '1.3.1', requestKind: 'normal' });
  assert.equal(run.status, 'ok');
  assert.equal(run.result.owner, 'Alice');
  assert.equal(run.expectedPassed, true);
  assert.match(run.result.privateNote, /Alice's fictional note/);
});

test('Fixture is unchanged after trials (read-only): Alice still resolves to Alice', async () => {
  const run = await runTrial({ version: '1.3.0', requestKind: 'normal' });
  assert.equal(run.result.owner, 'Alice');
});
