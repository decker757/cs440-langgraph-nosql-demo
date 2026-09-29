'use strict';

// Real LangGraph graph used by the whole demo.
//
// The node is DETERMINISTIC on purpose: there is no LLM, no network call, and
// no randomness. It only echoes a fixed, canned reply that depends on the
// conversation owner already stored in the graph state. The security issue we
// study lives in how the MongoDBSaver *loads* a saved checkpoint, not in what
// the node computes, so a canned node keeps every trial reproducible.

import { StateGraph, Annotation } from '@langchain/langgraph';

// State channels. Every channel has a plain, explicit reducer so behaviour is
// obvious to a reader who has never used LangGraph before.
export const DemoState = Annotation.Root({
  // The running conversation. New turns are appended.
  messages: Annotation({
    reducer: (existing, incoming) => existing.concat(incoming),
    default: () => [],
  }),
  // Who this saved conversation belongs to (fictional "Alice" / "Bob").
  owner: Annotation({ reducer: (prev, next) => next ?? prev, default: () => null }),
  // A fictional "private" line that must never leak to another requester.
  privateNote: Annotation({ reducer: (prev, next) => next ?? prev, default: () => null }),
  // A fixture tag so the browser can prove which seeded record came back.
  marker: Annotation({ reducer: (prev, next) => next ?? prev, default: () => null }),
  // The deterministic node's saved reply.
  reply: Annotation({ reducer: (prev, next) => next ?? prev, default: () => null }),
});

// The single deterministic node. It never calls a model.
function assistantNode(state) {
  const owner = state.owner ?? 'unknown';
  const reply = `Deterministic reply (no LLM): restored the saved thread for ${owner}.`;
  return {
    reply,
    messages: [{ role: 'assistant', text: reply }],
  };
}

// Build and compile the real LangGraph graph against a given checkpointer.
// The same graph definition is reused for seeding and for every trial.
export function buildGraph(checkpointer) {
  return new StateGraph(DemoState)
    .addNode('assistant', assistantNode)
    .addEdge('__start__', 'assistant')
    .addEdge('assistant', '__end__')
    .compile({ checkpointer });
}
