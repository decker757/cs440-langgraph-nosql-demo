# CS440 · NoSQL Injection in LangGraph's MongoDBSaver

A small, local, browser-based demonstration of a **real, published** security
advisory: unvalidated checkpoint identifiers in the LangGraph `MongoDBSaver`
integration let an attacker smuggle a MongoDB query operator into an identifier
field and read **another user's saved conversation**.

- Advisory: **GHSA-98xf-r82g-9mhx / CVE-2026-48121**
  (<https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-98xf-r82g-9mhx>)
- Related issue: **#2351** (<https://github.com/langchain-ai/langgraphjs/issues/2351>)
- Vulnerable package: `@langchain/langgraph-checkpoint-mongodb@1.3.0`
- Patched package: `@langchain/langgraph-checkpoint-mongodb@1.3.1`

Everything runs on your own machine with **fictional Alice and Bob data only**.
No external targets, real accounts, cloud services, or API keys.

> **This is an integration flaw, not a flaw in MongoDB's query engine.** MongoDB
> is one optional storage backend for LangGraph checkpoints. The bug is that the
> saver built a query straight from caller-supplied identifier fields without
> checking they were strings. **This is not prompt injection**: the attack enters
> the *identifier fields*, never the chat message.

---

## What the demo shows

The screen is laid out to be read from the back of a room. For every trial it
reveals, left to right:

1. **What Alice sends:** the actual submitted identifiers (`configurable`).
2. **What MongoDB is asked:** the actual query, captured live through the
   driver's command monitoring, with a plain-English reading of it. Or, if the
   request was rejected, a clear statement that nothing reached MongoDB.
3. **What Alice gets back:** the actual restored state, or the actual error.

Below those, **In the database** shows the two stored chats and which ones the
query matched, and **Results so far** builds up a comparison of every trial.

| # | Trial | Version | `thread_id` sent | Outcome |
|---|-------|---------|------------------|---------|
| 1 | Normal request | 1.3.0 vulnerable | `"alice-thread"` | Returns **Alice** |
| 2 | Injection attack | 1.3.0 vulnerable | `{ "$gt": "" }` | Returns **Bob** |
| 3 | Same attack, patched | 1.3.1 patched | `{ "$gt": "" }` | **Rejected** before any lookup |
| 4 | Normal request, patched | 1.3.1 patched | `"alice-thread"` | Returns **Alice** (fix is not over-broad) |
| 5 | Bob's real ID, patched | 1.3.1 patched | `"bob-thread"` | Returns **Bob** (the patch checks types, not ownership) |

Trial 5 is not a LangGraph bug. It shows what a type check cannot do: the ID is
valid text, so deciding whether Alice may read it is the application's job.

---

## Prerequisites

- **Node.js >= 22** (`node --version`)
- **Docker Desktop** running (for the local MongoDB container)
- A bash shell for `setup.sh`: macOS, Linux, or Windows with **Git Bash or WSL**.
  The `npm run` commands also work from PowerShell.

Install dependencies once with `npm install`.

The two saver versions are installed side by side as npm aliases (see
`package.json`):

```json
"mongodb-saver-vulnerable": "npm:@langchain/langgraph-checkpoint-mongodb@1.3.0",
"mongodb-saver-patched":    "npm:@langchain/langgraph-checkpoint-mongodb@1.3.1"
```

---

## Exact commands

```bash
./setup.sh          # start: check prereqs, start MongoDB, seed the data, serve the UI
./setup.sh test     # run the five trials as integration tests
./setup.sh logs     # show MongoDB's own log of each trial's query (add -f to follow)
./setup.sh stop     # stop and remove ONLY this demo's MongoDB container + volume
```

Then open: **<http://127.0.0.1:4400>**. You should see "Local server ready" at the
top right. Press Ctrl+C to stop the web server.

Without bash, the same steps are `npm run db:up`, `npm start`, `npm test`, and
`npm run db:down`. These use this project's Compose file (`compose.yaml`, project
name `cs440-nosql-demo`) and touch **only** this demo's container and volume.

---

## Running the trials

Alice is the simulated requester. The chat message is always the literal text
`Continue my chat`. Only the identifier fields change between trials. Click the
numbered buttons in order, 1 to 5.

A trial finishes in milliseconds, so the page reveals the finished result one
panel at a time, about a second apart. That pause is display pacing only, not
query time.

**Reset** re-seeds the fictional data (Alice first, Bob last) and clears the
results table. **Download evidence** saves the last run as JSON. Every run is also
appended to `evidence/runs.jsonl`.

### Why Bob comes back in Trial 2

`{ "$gt": "" }` means "any non-empty `thread_id`", which broadens Alice's lookup
to every stored thread. The saver then applies `.sort("checkpoint_id", -1)` and
`.limit(1)`, both visible in the captured query, so it returns the single newest
checkpoint. Bob is seeded last, so that checkpoint is Bob's.

> **Important nuance:** a broadened lookup returns the **latest matching
> checkpoint**, not every record and not an arbitrarily chosen victim.

---

## Plain-English: `thread_id` and `checkpoint_ns`

LangGraph can **save** the state of a conversation so it can be **restored**
later. Each saved snapshot is a *checkpoint*. To find the right checkpoint, the
saver looks it up by a few identifier fields you pass in `config.configurable`:

- **`thread_id`**: *which conversation.* Normally a plain string such as
  `"alice-thread"`.
- **`checkpoint_ns`**: *checkpoint namespace.* A sub-label used to separate
  checkpoints within one conversation. For a simple top-level chat it is `""`.
- **`checkpoint_id`** (optional): *which exact snapshot.* If you don't provide
  one, the saver returns the **latest** checkpoint for that thread.

Version 1.3.0 dropped these values straight into a MongoDB filter. MongoDB treats
a field whose value is an **object** like `{ "$gt": "" }` as an **operator**, not
as a literal id. Version 1.3.1 rejects any identifier field that is not a string.

---

## How faithful is this? (what actually runs)

- **Real LangGraph.** Seeding calls `graph.invoke(...)` on a compiled
  `StateGraph`, and each trial calls `graph.invoke(...)` again: the real
  restoration path that internally calls the saver's `getTuple`.
- **Real, unmodified saver source.** The two saver versions are the actual
  published 1.3.0 and 1.3.1 packages, loaded via npm aliases.
- **Real captured query.** The query shown is captured from the Node driver's
  `commandStarted` monitoring event.
- **Deterministic node, clearly labelled.** The single graph node returns a fixed
  canned reply and never calls an LLM. This keeps trials reproducible.

**Disclosed simplifications:**

- During a *trial* the saver is wrapped so that **writes** (`put` / `putWrites`)
  are suppressed while **reads** (`getTuple` / `list`) run the real, unmodified
  code. This keeps the seeded data identical between runs. Seeding uses the fully
  unwrapped saver, so the stored checkpoints are written by the genuine saver. See
  `src/saver.js` (`readOnly`) and `src/demo.js`.
- The trial buttons choose one of three preset identifier sets (`src/fixture.js`),
  which go straight into the real `graph.invoke`. The demo does not expose a
  free-form public endpoint. An app that forwards client-supplied IDs without
  checking them is the affected scenario the advisory describes.
- The **In the database** strip comes from separate read-only aggregates, not from
  the saver. They are not `find` commands, so they appear in neither the captured
  query nor the rows of `./setup.sh logs`.

---

## Database-side evidence (MongoDB's own log)

The query panel shows the command the *app* captured. For evidence that does
**not** rely on the app's own word, `compose.yaml` starts mongod with
`--slowms 0`, so it logs every operation, and this prints those log entries:

```bash
./setup.sh logs        # each trial's checkpoint query
./setup.sh logs -f     # follow live
```

Lookups from seeding return nothing and are counted but not listed.

```text
  demo_patched
    07:29:17  thread_id="alice-thread"       newest first  COLLSCAN  scanned 6  -> returned 1
    07:29:17  thread_id="bob-thread"         newest first  COLLSCAN  scanned 6  -> returned 1

  demo_vulnerable
    07:29:17  thread_id="alice-thread"       newest first  COLLSCAN  scanned 6  -> returned 1
    07:29:17  thread_id={"$gt":""}           newest first  COLLSCAN  scanned 6  -> returned 1   <- INJECTED OPERATOR
```

What this proves, independently of the app:

- The injected operator `{"$gt":""}` reached MongoDB **verbatim**, along with the
  newest-first sort.
- On the patched database, **no** checkpoint query carries an operator: `getTuple`
  rejected it before any `find` ran.

**What it does not prove:** `COLLSCAN` and `scanned 6` are not signs of the attack.
The collection has no index on these fields, so normal queries scan all 6 stored
checkpoints as well. The evidence is the filter itself.

---

## The fix, in the saver's own source

```bash
diff node_modules/mongodb-saver-vulnerable/dist/checkpoint.js \
     node_modules/mongodb-saver-patched/dist/checkpoint.js
```

1.3.1 adds a helper:

```js
function getStringConfigValue(name, value, { required = false } = {}) {
  if (value === void 0) { if (required) throw new Error(`Invalid configurable.${name}: expected a string`); return; }
  if (value === null || typeof value !== "string") throw new Error(`Invalid configurable.${name}: expected a string`);
  return value;
}
```

and routes every identifier field (`thread_id`, `checkpoint_ns`, `checkpoint_id`)
in `getTuple`, `list`, `put`, and `putWrites` through it, so a non-string value is
rejected before it can become a query operator. `deleteThread` gets its own
equivalent inline check.

---

## Troubleshooting

- **"Server unavailable" / "Cannot connect to the local demo."** The web server is
  not running. Run `./setup.sh` and reload the page.
- **"The local database is not ready."** MongoDB is not up. Run `npm run db:up`,
  wait for it to report healthy, then `npm start`.
- **Docker not running.** Start Docker Desktop and try again.
- **Port 4400 already in use.** Stop the other process, or run
  `DEMO_PORT=4500 npm start` and open `http://127.0.0.1:4500`.
- **Port 27028 already in use, or a different MongoDB answers.** Run
  `npm run db:down`, make sure nothing else uses the port, then `npm run db:up`. To
  point at another MongoDB: `DEMO_MONGO_URI="mongodb://127.0.0.1:PORT" npm start`.
- **Trial 2 shows Alice, not Bob, or a red "Unexpected result" message.** Click
  **Reset** and run it again.
- **Reinstall dependencies.** `rm -rf node_modules && npm install`.

---

## Ports and isolation

- MongoDB is bound to **127.0.0.1:27028** only (see `compose.yaml`).
- The web server binds to **127.0.0.1:4400** only (see `src/server.js`).
- The demo uses two isolated databases, `demo_vulnerable` and `demo_patched`,
  inside this demo's own MongoDB container and volume.

---

## Sources

- LangGraph.js advisory GHSA-98xf-r82g-9mhx:
  <https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-98xf-r82g-9mhx>
- LangGraph.js issue #2351:
  <https://github.com/langchain-ai/langgraphjs/issues/2351>
- The installed 1.3.0 and 1.3.1 package sources under `node_modules/`.

## Limitations (summary)

- Trials suppress checkpoint **writes** to stay repeatable; the vulnerable **read**
  path is real and unmodified.
- The graph node is deterministic and does not use an LLM.
- Data is entirely fictional; Alice is a simulated requester, not an authenticated
  session.
- Type-validating identifier fields (the 1.3.1 fix) stops this operator injection,
  but does **not** replace an application-level check that the requester owns the
  thread. Trial 5 demonstrates this.
- Trials submit the operator in `thread_id` only. When we also submitted
  `checkpoint_ns: { "$ne": null }` through `graph.invoke` (LangGraph 1.4.18), the
  captured filter still showed `checkpoint_ns: ""`, so that second operator did not
  reach MongoDB on this path. The public reproducer calls `getTuple` directly.
