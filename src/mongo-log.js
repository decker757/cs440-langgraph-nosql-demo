'use strict';

// Formats mongod's own diagnostic log into one readable row per checkpoint query.
// Reads `docker compose logs` on stdin, so this is evidence from the database's
// side, independent of the app. Used by `./setup.sh logs`.

import { createInterface } from 'node:readline';

const FOLLOW = process.argv.includes('--follow');
const SHOW_PER_DB = 12;

const useColor = process.stdout.isTTY;
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

function parseQuery(line) {
  let entry;
  try {
    entry = JSON.parse(line);
  } catch {
    return null;
  }
  const command = entry.attr?.command;
  if (command?.find !== 'checkpoints') return null;
  return {
    db: entry.attr.ns.replace(/\.checkpoints$/, ''),
    time: entry.t.$date.split('T')[1].split('.')[0],
    threadId: command.filter?.thread_id,
    injected: typeof command.filter?.thread_id === 'object',
    newestFirst: command.sort?.checkpoint_id === -1,
    plan: entry.attr.planSummary ?? '-',
    scanned: entry.attr.docsExamined ?? 0,
    returned: entry.attr.nreturned ?? 0,
  };
}

function formatRow(query) {
  const label = `thread_id=${JSON.stringify(query.threadId)}`.padEnd(30);
  const sort = query.newestFirst ? 'newest first' : '-';
  const row = `${query.time}  ${label} ${sort.padEnd(13)} ${query.plan.padEnd(9)} scanned ${String(query.scanned).padEnd(2)} -> returned ${query.returned}`;
  return query.injected ? paint('1;31', `${row}   <- INJECTED OPERATOR`) : row;
}

const lines = createInterface({ input: process.stdin });

if (FOLLOW) {
  // Seeding looks up threads that do not exist yet. Those rows return nothing.
  for await (const line of lines) {
    const query = parseQuery(line);
    if (query && query.returned > 0) console.log(`${query.db.padEnd(16)} ${formatRow(query)}`);
  }
} else {
  const byDb = new Map();
  let seeding = 0;
  for await (const line of lines) {
    const query = parseQuery(line);
    if (!query) continue;
    if (query.returned === 0) {
      seeding += 1;
      continue;
    }
    if (!byDb.has(query.db)) byDb.set(query.db, []);
    byDb.get(query.db).push(query);
  }

  if (!byDb.size) {
    console.log('No trial queries logged yet. Start the demo and run a trial first.');
  } else {
    console.log("\nMongoDB's own log of each trial's checkpoint query");
    console.log('(read straight from the database, independent of the app)\n');
    for (const [db, queries] of [...byDb].sort()) {
      console.log(`  ${paint('1', db)}`);
      const shown = queries.slice(-SHOW_PER_DB);
      if (shown.length < queries.length) console.log(`    (${queries.length - shown.length} earlier rows not shown)`);
      for (const query of shown) console.log(`    ${formatRow(query)}`);
      console.log('');
    }
    console.log(`(${seeding} lookups from seeding returned nothing and are not shown.)`);
    console.log('A filter like {"$gt":""} is the injected operator. It only reaches the vulnerable');
    console.log('database: the patched saver rejects it before any query runs.');
  }
}
