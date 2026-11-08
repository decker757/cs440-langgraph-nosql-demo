'use strict';

// All data here is FICTIONAL. No real people, accounts, or secrets.
//
// The demo stores two saved order-support conversations, Alice's and Bob's. Bob
// is always seeded LAST so that his checkpoint id sorts newest. The vulnerable
// saver sorts by checkpoint_id descending and returns the single newest match,
// so a broadened lookup deterministically surfaces Bob. This is why the injection
// result is repeatable, and it is also why the leak returns "the latest matching
// checkpoint", not every record and not an arbitrarily chosen victim.

// Fictional saved conversations. `owner` doubles as the simulated requester.
export const USERS = [
  {
    owner: 'Alice',
    threadId: 'alice-thread',
    marker: 'fixture:alice-001',
    firstMessage: 'Has my order A-1001 shipped yet?',
    privateNote: 'Order A-1001 · deliver to 8 Sample Street · arriving Friday',
  },
  {
    owner: 'Bob',
    threadId: 'bob-thread',
    marker: 'fixture:bob-001',
    firstMessage: 'Please send order B-2002 to my new address.',
    privateNote: 'Order B-2002 · deliver to 14 Example Road · parcel locker code 4471',
  },
];

// Alice is the simulated requester for every trial.
export const REQUESTER = USERS[0];

// The chat message never changes between trials. Only the identifier fields do.
export const CHAT_MESSAGE = 'Continue my chat';

export const REQUEST_KINDS = ['normal', 'operator', 'otherUser'];

// The identifier sets a trial can submit as `configurable`.
//   - "normal"    : plain string ids that a legitimate Alice request would send.
//   - "operator"  : an operator OBJECT smuggled into the thread_id field. `$gt`
//                   with an empty string matches every non-empty thread_id, so
//                   the vulnerable saver broadens Alice's lookup to the whole
//                   collection and returns the newest checkpoint (Bob's).
//   - "otherUser" : Bob's real id, as a plain string. It is valid text, so a type
//                   check cannot stop it. Only an ownership check could.
export function identifiersFor(requestKind) {
  if (requestKind === 'operator') {
    return { thread_id: { $gt: '' }, checkpoint_ns: '' };
  }
  if (requestKind === 'otherUser') {
    return { thread_id: USERS[1].threadId, checkpoint_ns: '' };
  }
  return { thread_id: REQUESTER.threadId, checkpoint_ns: '' };
}

// The five trials, in presentation order. `proves` is shown on screen as the
// plain-English result of the trial.
export const TRIALS = [
  {
    id: 1,
    label: 'Normal request',
    request: "Alice's ID",
    version: '1.3.0',
    requestKind: 'normal',
    expect: 'alice',
    proves: 'Normal text ID: Alice gets the right chat. This is the correct behaviour.',
  },
  {
    id: 2,
    label: 'Injection attack',
    request: 'Operator object',
    version: '1.3.0',
    requestKind: 'operator',
    expect: 'other',
    proves: "Same message, one field changed: the ID became a query rule and Alice got Bob's chat.",
  },
  {
    id: 3,
    label: 'Same attack, patched',
    request: 'Operator object',
    version: '1.3.1',
    requestKind: 'operator',
    expect: 'rejected',
    proves: 'Same attack on the patched version: rejected before any query reached MongoDB.',
  },
  {
    id: 4,
    label: 'Normal request, patched',
    request: "Alice's ID",
    version: '1.3.1',
    requestKind: 'normal',
    expect: 'alice',
    proves: 'Normal text ID on the patched version: Alice still gets the right chat, so the fix is not over-broad.',
  },
  {
    id: 5,
    label: "Bob's real ID, patched",
    request: "Bob's real ID",
    version: '1.3.1',
    requestKind: 'otherUser',
    expect: 'other',
    proves: "Bob's real ID is valid text, so the type check passes. The patch does not check ownership: that is the app's job.",
  },
];
