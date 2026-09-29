# CS440 · NoSQL Injection in LangGraph's MongoDBSaver

A small, local, browser-based demonstration of a **real, published** security
advisory: unvalidated checkpoint identifiers in the LangGraph `MongoDBSaver`
integration let an attacker smuggle a MongoDB query operator into an identifier
field and read **another user's saved conversation**.

- Advisory: **GHSA-98xf-r82g-9mhx**
  (<https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-98xf-r82g-9mhx>)
- Related issue: **#2351** (<https://github.com/langchain-ai/langgraphjs/issues/2351>)
- Vulnerable package: `@langchain/langgraph-checkpoint-mongodb@1.3.0`
- Patched package: `@langchain/langgraph-checkpoint-mongodb@1.3.1`

Everything runs on your own machine with **fictional Alice and Bob data only**.
No external targets, real accounts, cloud services, or API keys.

> **This is an integration flaw, not a flaw in MongoDB's query engine.** MongoDB
> is one optional storage backend for LangGraph checkpoints. The bug is that the
> saver built a query straight from caller-supplied identifier fields without
> checking they were strings. **This is not prompt injection** — the attack
> enters the *identifier fields*, never the chat message.

---

## What the demo shows

The browser shows, side by side, for every trial:

1. **The actual submitted identifiers** (the `configurable` object).
2. **The actual MongoDB query**, captured live through the driver's command
   monitoring (not a hand-written mock).
3. **The actual returned state**, or the actual rejection error.

Four trials:

| # | Version | Identifiers | Outcome |
|---|---------|-------------|---------|
| 1 | 1.3.0 vulnerable | normal Alice text ids | Returns **Alice** (happy path) |
| 2 | 1.3.0 vulnerable | operator object in `thread_id` | Returns **Bob** (unintended lookup) |
| 3 | 1.3.1 patched | same operator object | **Rejected** before any lookup |
| 4 | 1.3.1 patched | normal Alice text ids | Returns **Alice** (fix is not over-broad) |

---

## Prerequisites

- **Node.js >= 22** (`node --version`)
- **Docker Desktop** running (for the local MongoDB container)
- macOS/Linux shell. All commands below are run from this `demo/` folder.

The npm dependencies are already installed (`node_modules/` is present). If you
ever need to reinstall: `npm install`.

The two saver versions are installed side by side as npm aliases (see
`package.json`):

```json
"mongodb-saver-vulnerable": "npm:@langchain/langgraph-checkpoint-mongodb@1.3.0",
"mongodb-saver-patched":    "npm:@langchain/langgraph-checkpoint-mongodb@1.3.1"
```

---

## Exact commands

### Start

```bash
# 1. Start the local MongoDB container (binds to 127.0.0.1:27028 only)
npm run db:up

# 2. Start the demo (seeds the fictional fixture, then serves the UI)
npm start
```

Then open: **<http://127.0.0.1:4400>**

You should see "Local server ready" in the top right.

### Stop

```bash
# Stop the web server: press Ctrl+C in its terminal.

# Stop and remove ONLY this demo's MongoDB container + volume:
npm run db:down
```

`npm run db:down` uses this project's Compose file (`compose.yaml`, project name
`cs440-nosql-demo`) and touches **only** this demo's container. Your other
Docker containers are not affected.

### Run the automated tests (optional but recommended)

```bash
npm test
```

This runs the same four trials as integration tests against real LangGraph and
real MongoDB and asserts each expected outcome, including that the fixture is
unchanged afterward.

---

## Step-by-step: the four trials in the browser

Alice is the simulated requester. The chat message is always the literal text
`Continue my chat`. Only the identifier fields change between trials.

There are two ways to run each trial:

- Click a numbered **trial button** (1–4) — the fastest path, or
- Set the two dropdowns (**MongoDBSaver version**, **Request identifiers**) and
  click **Continue my chat**.

### Trial 1 — Baseline (1.3.0 vulnerable, normal ids)

1. Click trial button **1 · Baseline**.
2. **Request identifiers** panel shows: `{ "thread_id": "alice-thread-001",
   "checkpoint_ns": "" }`.
3. **Actual database lookup** shows a `find` on `checkpoints` with that exact
   string filter.
4. **Restored conversation** shows **Alice's** conversation.

**Proves:** with honest string ids, the saver returns the requester's own state.
This is the normal, correct behaviour.

### Trial 2 — Changed input (1.3.0 vulnerable, operator object)

1. Click trial button **2 · Changed input**.
2. **Request identifiers** shows `thread_id` is now an **object**:
   `{ "thread_id": { "$gt": "" }, "checkpoint_ns": "" }`. The `$gt` key is
   highlighted as an operator.
3. **Actual database lookup** shows the operator reached MongoDB verbatim:
   `filter: { thread_id: { "$gt": "" }, checkpoint_ns: "" }`, `limit: 1`.
4. **Restored conversation** shows **Bob's** conversation — a different owner —
   and the panel highlights the cross-user result.

**Proves:** `{ "$gt": "" }` means "any string thread_id". It broadens Alice's
lookup to every stored thread. The saver's source then applies
`.sort("checkpoint_id", -1).limit(1)`, so it returns the single **newest**
matching checkpoint. Because Bob is seeded last, that newest checkpoint is
Bob's. Alice receives Bob's fictional private note.

> **Important nuance:** a broadened lookup returns the **latest matching
> checkpoint**, not every record and not an arbitrarily chosen victim. Here it
> is deterministically Bob because Bob was seeded last.

### Trial 3 — After update (1.3.1 patched, same operator object)

1. Click trial button **3 · After update**.
2. Same operator identifiers are submitted.
3. **Actual database lookup** shows **zero** lookup queries.
4. **Restored conversation** shows **Request rejected** with the real error:
   `Invalid configurable.thread_id: expected a string`.

**Proves:** the 1.3.1 patch validates that identifier fields are strings and
throws **before** building any query. The injection never reaches MongoDB.

### Trial 4 — Normal control (1.3.1 patched, normal ids)

1. Click trial button **4 · Normal control**.
2. Normal Alice string ids are submitted.
3. **Restored conversation** shows **Alice's** conversation.

**Proves:** the fix is a targeted type check, not an over-correction. Legitimate
string requests still work exactly as before. (This is the regression control.)

### Reset

Click **Reset fixture** at any time to re-seed the fictional Alice/Bob records
(Alice first, Bob last) if you want to re-run from a clean state.

### Download evidence

After any trial, **Download evidence** saves the last run (submitted
identifiers, captured query, and returned state/rejection) as JSON. Every run is
also appended to `evidence/runs.jsonl` on disk.

---

## Plain-English: `thread_id` and `checkpoint_ns`

LangGraph can **save** the state of a conversation so it can be **restored**
later. Each saved snapshot is a *checkpoint*. To find the right checkpoint, the
saver looks it up by a few identifier fields you pass in `config.configurable`:

- **`thread_id`** — *which conversation.* Think of it as the conversation's ID,
  like a chat's URL slug. Alice's chat and Bob's chat have different
  `thread_id`s. Normally it is a plain string such as `"alice-thread-001"`.

- **`checkpoint_ns`** — *checkpoint namespace.* A sub-label used to separate
  checkpoints within one conversation (for example, nested sub-graphs get their
  own namespace). For a simple top-level chat it is just the empty string `""`.

- **`checkpoint_id`** (optional) — *which exact snapshot.* If you don't provide
  one, the saver returns the **latest** checkpoint for that thread.

The vulnerability: version 1.3.0 dropped these values straight into a MongoDB
filter. MongoDB treats a field whose value is an **object** like `{ "$gt": "" }`
as an **operator**, not as a literal id. So instead of "the thread whose id is
exactly X", the query becomes "any thread where id is greater than the empty
string" — i.e. all of them. Version 1.3.1 rejects any identifier field that is
not a string.

---

## Narration script (say this while clicking)

**Setup (10s):** "This is a real, published LangGraph advisory, running locally
on fictional Alice and Bob data. Alice is a simulated requester. Watch three
panels: the identifiers she submits, the actual MongoDB query captured live, and
what comes back."

**Trial 1 (15s):** "Baseline, vulnerable version 1.3.0, normal string ids. The
query filters on Alice's thread id, and Alice's own conversation comes back.
Correct behaviour."

**Trial 2 (25s):** "Same vulnerable version, but now I put an object,
dollar-g-t empty string, into the thread_id field. Look at the captured query —
that operator reached MongoDB unchanged. It means 'any thread', so the lookup is
broadened to the whole collection and returns the newest checkpoint, which is
Bob's. Alice just received Bob's saved private note. That's the leak."

**Trial 3 (20s):** "Now the patched version, 1.3.1, with the exact same
malicious object. Zero queries run. The saver rejects it: 'Invalid
configurable.thread_id: expected a string.' The injection never reaches the
database."

**Trial 4 (15s):** "Patched version with normal ids. Alice still gets Alice.
The fix is a targeted type check, not an over-correction."

**Close (15s):** "The lesson: this is an integration flaw, not a MongoDB bug,
and not prompt injection — it enters the identifier fields. And note that
type-checking identifiers stops this operator injection, but it does not by
itself prove the requester owns the thread. A real app still needs its own
ownership check."

---

## Roughly two-minute recording walkthrough

1. **0:00–0:15** — Show the browser at `http://127.0.0.1:4400`. Read the title
   "Whose conversation gets restored?" and point out the three panels and the
   "Simulated requester · not authenticated · Alice" label.
2. **0:15–0:30** — Click **1 · Baseline**. Narrate Trial 1.
3. **0:30–1:00** — Click **2 · Changed input**. Slow down. Point at the operator
   object in panel 1, the captured operator query in panel 2, and Bob's leaked
   note in panel 3.
4. **1:00–1:25** — Click **3 · After update**. Point at "0 lookup queries" and
   the rejection error.
5. **1:25–1:45** — Click **4 · Normal control**. Alice returns; the fix is
   clean.
6. **1:45–2:00** — Click **Download evidence**, open the JSON, and note it
   contains the real submitted identifiers, captured query, and result. Close
   with the one-line lesson.

A prerecorded video is acceptable: the presentation brief does not require a
live demo or prohibit a prerecorded one, and the full presentation has a
12-minute limit. Recording this two-minute walkthrough in advance de-risks the
live environment.

---

## How faithful is this? (what actually runs)

- **Real LangGraph.** Seeding calls `graph.invoke(...)` on a compiled
  `StateGraph`, and each trial calls `graph.invoke(...)` again — the real
  restoration path that internally calls the saver's `getTuple`. We do **not**
  hand-call the saver or write a raw MongoDB query and present it as automatic
  restoration.
- **Real, unmodified saver source.** The two saver versions are the actual
  published 1.3.0 and 1.3.1 packages, loaded via npm aliases. The vulnerable
  read path (`getTuple`) is used exactly as shipped.
- **Real captured query.** The MongoDB query shown in the browser is captured
  from the Node driver's `commandStarted` monitoring event — it is the real
  command document sent to MongoDB.
- **Deterministic node, clearly labelled.** The single graph node returns a
  fixed canned reply and never calls an LLM. This keeps trials reproducible.

**One deliberate, disclosed limitation:** during a *trial* the saver is wrapped
so that **writes** (`put` / `putWrites`) are suppressed while **reads**
(`getTuple` / `list`) run the real, unmodified code. This keeps the seeded
fixture identical between runs so results are repeatable. Nothing about the
vulnerable read path is changed. Seeding uses the fully unwrapped saver, so the
stored checkpoints are written by the genuine saver. See `src/saver.js`
(`readOnly`) and `src/demo.js`.

---

## The fix, in the saver's own source

You can read the difference yourself:

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

and routes every identifier field (`thread_id`, `checkpoint_ns`,
`checkpoint_id`) in `getTuple`, `list`, `put`, `putWrites`, and `deleteThread`
through it, so a non-string value is rejected before it can become a query
operator.

---

## Troubleshooting

- **"Server unavailable" / "Cannot connect to the local demo."** The web server
  is not running. Run `npm start` in this folder and reload the page.
- **"The local database is not ready."** MongoDB is not up. Run `npm run db:up`,
  wait for it to report healthy, then `npm start`.
- **Port 4400 already in use.** Another process holds the port. Stop it, or run
  the server on another port: `DEMO_PORT=4500 npm start` (then open
  `http://127.0.0.1:4500`).
- **Port 27028 already in use, or a different MongoDB answers.** Something else
  is bound to 27028. `npm run db:down`, ensure nothing else uses the port, then
  `npm run db:up`. To point the demo at a different MongoDB:
  `DEMO_MONGO_URI="mongodb://127.0.0.1:PORT" npm start`.
- **Docker not running.** Start Docker Desktop, then `npm run db:up`.
- **Trial 2 shows Alice, not Bob.** Click **Reset fixture** (this re-seeds Alice
  first, Bob last) and run Trial 2 again.
- **Reinstall dependencies.** `rm -rf node_modules && npm install`.

---

## Ports and isolation

- MongoDB is bound to **127.0.0.1:27028** only (see `compose.yaml`).
- The web server binds to **127.0.0.1:4400** only (see `src/server.js`).
- The demo uses two isolated databases, `demo_vulnerable` and `demo_patched`,
  inside this demo's own MongoDB container/volume.

---

## Sources

- LangGraph.js advisory GHSA-98xf-r82g-9mhx:
  <https://github.com/langchain-ai/langgraphjs/security/advisories/GHSA-98xf-r82g-9mhx>
- LangGraph.js issue #2351:
  <https://github.com/langchain-ai/langgraphjs/issues/2351>
- The installed 1.3.0 and 1.3.1 package sources under `node_modules/` (verified
  by `diff`, shown above).

## Limitations (summary)

- Trials suppress checkpoint **writes** to stay repeatable; the vulnerable
  **read** path is real and unmodified (disclosed above).
- The graph node is deterministic and does not use an LLM.
- Data is entirely fictional; Alice is a simulated requester, not an
  authenticated session.
- Type-validating identifier fields (the 1.3.1 fix) stops this operator
  injection, but does **not** replace an application-level ownership check that
  the requester actually owns the requested thread.
