'use strict';

// Core demo logic shared by the HTTP server and the integration tests.
// Seeds the fictional fixture, runs one trial through the REAL LangGraph graph,
// checks the result against the expected outcome, and records evidence.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildGraph } from './graph.js';
import {
  makeSaver,
  readOnly,
  withCapture,
  getClient,
  dbNameFor,
  DB_NAMES,
} from './saver.js';
import {
  USERS,
  REQUESTER,
  CHAT_MESSAGE,
  identifiersFor,
  TRIALS,
} from './fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = join(HERE, '..', 'evidence');
const EVIDENCE_FILE = join(EVIDENCE_DIR, 'latest.json');
const EVIDENCE_LOG = join(EVIDENCE_DIR, 'runs.jsonl');

let runCounter = 0;

// Seed one version's database: drop it, then persist Alice, then Bob (last).
async function seedVersion(version) {
  const client = await getClient();
  await client.db(dbNameFor(version)).dropDatabase();
  const saver = await makeSaver(version); // full read/write saver for seeding
  const graph = buildGraph(saver);
  for (const user of USERS) {
    await graph.invoke(
      {
        messages: [{ role: 'user', text: user.firstMessage }],
        owner: user.owner,
        privateNote: user.privateNote,
        marker: user.marker,
      },
      { configurable: { thread_id: user.threadId, checkpoint_ns: '' } },
    );
    // Guarantee Bob's checkpoint_id sorts strictly newest than Alice's so the
    // broadened lookup is deterministic.
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// Seed every version. Call once before running trials.
export async function seedFixture() {
  for (const version of Object.keys(DB_NAMES)) {
    await seedVersion(version);
  }
}

function expectationFor(version, requestKind) {
  return TRIALS.find((t) => t.version === version && t.requestKind === requestKind);
}

function evaluate(expect, status, owner) {
  if (expect === 'rejected') return status === 'rejected';
  if (expect === 'alice') return status === 'ok' && owner === 'Alice';
  if (expect === 'other') return status === 'ok' && Boolean(owner) && owner !== 'Alice';
  return false;
}

// What the database holds, for the on-screen strip. `filter` marks which threads
// the trial's captured query matches. These aggregates are separate from the
// saver's own reads, so they never appear in the captured query or in the `find`
// rows of `./setup.sh logs`.
async function storeView(version, filter) {
  const client = await getClient();
  const checkpoints = client.db(dbNameFor(version)).collection('checkpoints');
  const group = { $group: { _id: '$thread_id', newest: { $max: '$checkpoint_id' } } };
  const stored = await checkpoints.aggregate([group]).toArray();
  const matched = filter ? await checkpoints.aggregate([{ $match: filter }, group]).toArray() : [];
  const newest = stored.reduce((latest, thread) => (thread.newest > latest ? thread.newest : latest), '');
  return USERS.map((user) => ({
    owner: user.owner,
    threadId: user.threadId,
    newest: stored.some((thread) => thread._id === user.threadId && thread.newest === newest),
    matched: matched.some((thread) => thread._id === user.threadId),
  }));
}

async function recordEvidence(run) {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(EVIDENCE_FILE, JSON.stringify(run, null, 2));
  await writeFile(EVIDENCE_LOG, `${JSON.stringify(run)}\n`, { flag: 'a' });
  return 'latest.json';
}

// Run a single trial and return the run object the browser renders.
export async function runTrial({ version, requestKind }) {
  const trial = expectationFor(version, requestKind);
  if (!trial) throw new Error(`No trial defined for ${version} / ${requestKind}`);

  const configurable = identifiersFor(requestKind);
  const saver = readOnly(await makeSaver(version));
  const graph = buildGraph(saver);

  runCounter += 1;
  const run = {
    runId: `${Date.now().toString(36)}-${runCounter}`,
    version,
    requestKind,
    trialId: trial.id,
    proves: trial.proves,
    request: { message: CHAT_MESSAGE, configurable },
    simulatedRequester: REQUESTER.owner,
    queryTrace: [],
    graphNodeRan: false,
    status: 'ok',
    result: null,
    error: null,
    expectedPassed: null,
    capturedAt: new Date().toISOString(),
  };

  try {
    // The REAL LangGraph restoration path: invoke resumes the saved thread by
    // calling the saver's getTuple with the submitted identifiers.
    const { value, captured } = await withCapture(() =>
      graph.invoke(
        { messages: [{ role: 'user', text: CHAT_MESSAGE }] },
        { configurable },
      ),
    );
    run.queryTrace = captured;
    run.graphNodeRan = true;
    run.result = {
      owner: value.owner ?? null,
      marker: value.marker ?? null,
      privateNote: value.privateNote ?? null,
      reply: value.reply ?? null,
      messages: value.messages ?? [],
    };
  } catch (error) {
    run.status = 'rejected';
    run.error = error.message;
  }

  run.store = await storeView(version, run.queryTrace[0]?.filter);
  run.expectedPassed = evaluate(trial.expect, run.status, run.result?.owner);
  run.evidenceFile = await recordEvidence(run);
  return run;
}

// Readiness + fixture summary for the status endpoint.
export async function status() {
  try {
    const client = await getClient();
    let ready = true;
    for (const version of Object.keys(DB_NAMES)) {
      const count = await client
        .db(dbNameFor(version))
        .collection('checkpoints')
        .countDocuments();
      if (count === 0) ready = false;
    }
    let evidenceAvailable = false;
    try {
      await readFile(EVIDENCE_FILE);
      evidenceAvailable = true;
    } catch {
      evidenceAvailable = false;
    }
    return {
      ready,
      evidenceAvailable,
      trials: TRIALS,
      store: await storeView('1.3.0'),
    };
  } catch (error) {
    return { ready: false, evidenceAvailable: false, trials: [], store: [], error: error.message };
  }
}

export async function readEvidence() {
  return readFile(EVIDENCE_FILE, 'utf8');
}

export { TRIALS };
