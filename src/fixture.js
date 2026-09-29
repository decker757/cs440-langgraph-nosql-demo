'use strict';

// All data here is FICTIONAL. No real people, accounts, or secrets.
//
// The demo stores two saved conversations, Alice's and Bob's. Bob is always
// seeded LAST so that his checkpoint id sorts newest. The vulnerable saver
// sorts by checkpoint_id descending and returns the single newest match, so a
// broadened lookup deterministically surfaces Bob. This is why the injection
// result is repeatable, and it is also why the leak returns "the latest
// matching checkpoint", not every record and not an arbitrarily chosen victim.

// Fictional saved conversations. `owner` doubles as the simulated requester.
export const USERS = [
  {
    owner: 'Alice',
    threadId: 'alice-thread-001',
    marker: 'fixture:alice-001',
    firstMessage: 'Remind me what we set up last time.',
    privateNote: "Alice's fictional note: renewal quote saved for account A-1001.",
  },
  {
    owner: 'Bob',
    threadId: 'bob-thread-001',
    marker: 'fixture:bob-001',
    firstMessage: 'Pick up where we left off.',
    privateNote: "Bob's fictional note: draft appeal letter for case B-2002.",
  },
];

// Alice is the simulated requester for every trial.
export const REQUESTER = USERS[0];

// The chat message never changes between trials. Only the identifier fields do.
export const CHAT_MESSAGE = 'Continue my chat';

// The two identifier sets a trial can submit as `configurable`.
//   - "normal"   : plain string ids that a legitimate Alice request would send.
//   - "operator" : an operator OBJECT smuggled into the thread_id field. `$gt`
//                  with an empty string matches every stored thread_id, so the
//                  vulnerable saver broadens Alice's lookup to the whole
//                  collection and returns the newest checkpoint (Bob's).
export function identifiersFor(requestKind) {
  if (requestKind === 'operator') {
    return { thread_id: { $gt: '' }, checkpoint_ns: '' };
  }
  return { thread_id: REQUESTER.threadId, checkpoint_ns: '' };
}

// The four trials the assignment asks for, in presentation order.
export const TRIALS = [
  {
    id: 1,
    label: 'Baseline',
    version: '1.3.0',
    requestKind: 'normal',
    expect: 'alice',
    proves: 'Vulnerable version with normal ids returns the requester (Alice).',
  },
  {
    id: 2,
    label: 'Changed input',
    version: '1.3.0',
    requestKind: 'operator',
    expect: 'other',
    proves: 'Vulnerable version with an operator object broadens the lookup and returns another user (Bob).',
  },
  {
    id: 3,
    label: 'After update',
    version: '1.3.1',
    requestKind: 'operator',
    expect: 'rejected',
    proves: 'Patched version rejects the same operator object before any lookup runs.',
  },
  {
    id: 4,
    label: 'Normal control',
    version: '1.3.1',
    requestKind: 'normal',
    expect: 'alice',
    proves: 'Patched version with normal ids still returns the requester (Alice): the fix is not over-broad.',
  },
];
