'use strict';

// MongoDB wiring: one localhost-only client with command monitoring turned on,
// plus factories for the two published saver versions.

import { MongoClient } from 'mongodb';

// Localhost-only. The compose file binds MongoDB to 127.0.0.1:27028.
export const MONGO_URI = process.env.DEMO_MONGO_URI ?? 'mongodb://127.0.0.1:27028';

// Each saver version gets its own isolated database, seeded identically. This
// keeps the vulnerable and patched runs from sharing state.
export const DB_NAMES = { '1.3.0': 'demo_vulnerable', '1.3.1': 'demo_patched' };

// npm aliases declared in package.json point at the real published packages:
//   mongodb-saver-vulnerable -> @langchain/langgraph-checkpoint-mongodb@1.3.0
//   mongodb-saver-patched    -> @langchain/langgraph-checkpoint-mongodb@1.3.1
const PACKAGE_FOR = {
  '1.3.0': 'mongodb-saver-vulnerable',
  '1.3.1': 'mongodb-saver-patched',
};

const CHECKPOINT_COLLECTIONS = new Set(['checkpoints', 'checkpoint_writes']);

let clientPromise = null;
// When a capture is active this holds the array the monitor pushes into.
let activeCapture = null;

// Lazy singleton client. `monitorCommands` lets us record the ACTUAL command
// document the driver sends to MongoDB, so the browser shows a real query and
// not a hand-written approximation.
export function getClient() {
  if (!clientPromise) {
    const client = new MongoClient(MONGO_URI, { monitorCommands: true });
    client.on('commandStarted', (event) => {
      if (!activeCapture) return;
      if (event.commandName !== 'find') return;
      if (!CHECKPOINT_COLLECTIONS.has(event.command.find)) return;
      // We record the fields command monitoring reports reliably: the target
      // collection, the filter (where the injected operator shows up), and the
      // limit. The saver's source additionally applies `.sort("checkpoint_id",
      // -1)`, which is why a broadened match returns the newest checkpoint; the
      // driver does not surface that sort in the command document for the
      // string-form sort call, so we do not display a misleading empty sort.
      activeCapture.push({
        collection: event.command.find,
        filter: event.command.filter ?? {},
        limit: event.command.limit ?? null,
      });
    });
    clientPromise = client.connect();
  }
  return clientPromise;
}

// Record every checkpoint `find` command issued while `fn` runs.
export async function withCapture(fn) {
  const captured = [];
  activeCapture = captured;
  try {
    const value = await fn();
    return { value, captured };
  } finally {
    activeCapture = null;
  }
}

export function dbNameFor(version) {
  const name = DB_NAMES[version];
  if (!name) throw new Error(`Unknown saver version: ${version}`);
  return name;
}

async function loadSaverClass(version) {
  const pkg = PACKAGE_FOR[version];
  if (!pkg) throw new Error(`Unknown saver version: ${version}`);
  const mod = await import(pkg);
  return mod.MongoDBSaver;
}

// A real MongoDBSaver of the requested version, bound to that version's db.
export async function makeSaver(version) {
  const client = await getClient();
  const MongoDBSaver = await loadSaverClass(version);
  return new MongoDBSaver({ client, dbName: dbNameFor(version) });
}

// Wrap a saver so reads (getTuple/list) run the REAL, unmodified vulnerable or
// patched code, but writes (put/putWrites) are suppressed. Trials call the real
// graph.invoke, which resumes a saved thread through getTuple (the code path the
// advisory is about) and then would persist a new checkpoint. Suppressing only
// the persistence keeps the seeded fixture identical between trials so results
// stay repeatable. Nothing about the vulnerable read path is altered.
export function readOnly(saver) {
  return new Proxy(saver, {
    get(target, prop, receiver) {
      if (prop === 'put') {
        return async (config) => ({
          configurable: {
            thread_id: config?.configurable?.thread_id,
            checkpoint_ns: config?.configurable?.checkpoint_ns ?? '',
            checkpoint_id: `read-only-no-write-${Date.now()}`,
          },
        });
      }
      if (prop === 'putWrites') return async () => {};
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function closeClient() {
  if (clientPromise) {
    const client = await clientPromise;
    await client.close();
    clientPromise = null;
  }
}
