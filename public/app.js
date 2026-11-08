'use strict';

const ui = {
  trialControls: document.querySelector('#trial-controls'),
  resetButton: document.querySelector('#reset-button'),
  serverStatus: document.querySelector('#server-status'),
  statusMessage: document.querySelector('#status-message'),
  headline: document.querySelector('#headline'),
  message: document.querySelector('#chat-message'),
  requestPanel: document.querySelector('#request-panel'),
  request: document.querySelector('#request-json'),
  requestType: document.querySelector('#request-type'),
  queryPanel: document.querySelector('#query-panel'),
  query: document.querySelector('#query-json'),
  queryReached: document.querySelector('#query-reached'),
  queryPlain: document.querySelector('#query-plain'),
  resultPanel: document.querySelector('#result-panel'),
  result: document.querySelector('#result-content'),
  store: document.querySelector('#store-view'),
  scoreboard: document.querySelector('#scoreboard-rows'),
  evidence: document.querySelector('#evidence-link'),
};

// A trial finishes in milliseconds, far too fast to follow. The finished result
// is revealed one panel at a time so the audience's eyes go left to right.
const REVEAL_MS = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 900;
const pause = () => new Promise(resolve => setTimeout(resolve, REVEAL_MS));

let ready = false;
let busy = false;
let trials = [];
let trialButtons = [];
let scoreCells = new Map();

function setMessage(message, isError = false) {
  ui.statusMessage.textContent = message;
  ui.statusMessage.classList.toggle('error', isError);
}

function updateControls() {
  ui.resetButton.disabled = busy || !ready;
  for (const button of trialButtons) button.disabled = busy || !ready;
}

function setEvidenceAvailable(available) {
  ui.evidence.setAttribute('aria-disabled', String(!available));
}

async function api(path, options = {}) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || body.message || `Request failed (${response.status}).`);
  return body;
}

function formatJSON(value, depth = 0) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const array = Array.isArray(value);
  const entries = Object.entries(value);
  const open = array ? '[' : '{';
  const close = array ? ']' : '}';
  const compact = array ? JSON.stringify(value) : `{ ${entries.map(([key, item]) => `${JSON.stringify(key)}: ${JSON.stringify(item)}`).join(', ')} }`;
  const flat = entries.every(([, item]) => item === null || typeof item !== 'object');
  if (!entries.length) return array ? '[]' : '{}';
  if (depth > 0 && flat && compact.length <= 40) return compact;
  const indent = '  '.repeat(depth);
  const lines = entries.map(([key, item]) => `${indent}  ${array ? '' : `${JSON.stringify(key)}: `}${formatJSON(item, depth + 1)}`);
  return `${open}\n${lines.join(',\n')}\n${indent}${close}`;
}

function renderJSON(element, value) {
  element.replaceChildren();
  element.classList.remove('placeholder');
  const json = formatJSON(value);
  const tokens = /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let offset = 0;
  for (const match of json.matchAll(tokens)) {
    element.append(document.createTextNode(json.slice(offset, match.index)));
    const token = document.createElement('span');
    const text = match[0];
    const isKey = text.startsWith('"') && /^\s*:/.test(json.slice(match.index + text.length));
    token.className = isKey ? (text.startsWith('"$') ? 'json-operator' : 'json-key') : text.startsWith('"') ? 'json-string' : /^(true|false|null)$/.test(text) ? 'json-literal' : 'json-number';
    token.textContent = text;
    element.append(token);
    offset = match.index + text.length;
  }
  element.append(document.createTextNode(json.slice(offset)));
}

function placeholder(element, text) {
  element.textContent = text;
  element.classList.add('placeholder');
}

function setActivePanel(panel) {
  for (const candidate of [ui.requestPanel, ui.queryPanel, ui.resultPanel]) candidate.classList.toggle('active', candidate === panel);
}

function setHeadline(text, tone = '') {
  ui.headline.textContent = text;
  ui.headline.className = `headline ${tone}`;
}

function setReached(text, className) {
  ui.queryReached.textContent = text;
  ui.queryReached.className = `reached ${className}`;
  ui.queryReached.hidden = false;
}

function clearResult(text) {
  ui.resultPanel.classList.remove('cross-user');
  ui.result.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'placeholder';
  empty.textContent = text;
  ui.result.append(empty);
}

function resetPanels() {
  setActivePanel(null);
  placeholder(ui.request, 'Run a trial to see them.');
  ui.requestType.hidden = true;
  placeholder(ui.query, 'Run a trial to see the query.');
  ui.query.hidden = false;
  ui.queryReached.hidden = true;
  ui.queryPlain.hidden = true;
  clearResult('The real returned state will appear here.');
}

function addResultText(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  ui.result.append(element);
  return element;
}

function addDetail(label, value, className = '') {
  if (value === undefined || value === null || value === '') return;
  const detail = document.createElement('dl');
  detail.className = `result-detail ${className}`;
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = typeof value === 'string' ? value : JSON.stringify(value);
  detail.append(term, description);
  ui.result.append(detail);
}

// The captured query in plain English, read from the real command so it can
// never disagree with the JSON above it.
function describeQuery(trace) {
  const threadId = trace.filter.thread_id;
  const isOperator = typeof threadId !== 'string';
  const match = !isOperator ? `thread_id is exactly "${threadId}"` : threadId?.$gt === '' ? 'any non-empty thread_id' : `thread_id matches ${JSON.stringify(threadId)}`;
  const steps = [{ text: match, bad: isOperator }];
  if (trace.sort?.checkpoint_id === -1) steps.push({ text: 'newest first' });
  if (trace.limit === 1) steps.push({ text: 'take 1' });
  return steps;
}

function showRequest(run) {
  ui.message.textContent = `“${run.request.message}”`;
  renderJSON(ui.request, run.request.configurable);
  const isText = typeof run.request.configurable.thread_id === 'string';
  ui.requestType.textContent = isText ? 'thread_id is text, as expected' : 'thread_id is an object, not text';
  ui.requestType.className = `type-tag ${isText ? '' : 'bad'}`;
  ui.requestType.hidden = false;
}

function showQuery(run) {
  const trace = (Array.isArray(run.queryTrace) ? run.queryTrace : [])[0];
  ui.queryPlain.replaceChildren();
  if (!trace) {
    setReached('Nothing reached MongoDB. No query was sent.', 'blocked');
    ui.query.hidden = true;
    ui.queryPlain.hidden = true;
    return;
  }
  const steps = describeQuery(trace);
  const injected = steps.some(step => step.bad);
  setReached(injected ? 'Reached MongoDB: YES, operator included' : 'Reached MongoDB: YES', injected ? 'bad' : '');
  ui.query.hidden = false;
  renderJSON(ui.query, trace);
  for (const step of steps) {
    const item = document.createElement('li');
    item.textContent = step.text;
    if (step.bad) item.className = 'bad';
    ui.queryPlain.append(item);
  }
  ui.queryPlain.hidden = false;
}

function showResult(run) {
  ui.result.replaceChildren();
  ui.resultPanel.classList.remove('cross-user');

  if (run.status === 'rejected') {
    addResultText('span', 'result-status', 'REQUEST REJECTED');
    addResultText('h3', 'result-owner', 'No conversation restored');
    if (run.error) addResultText('p', 'rejection-error', run.error);
    addResultText('p', 'rejection-note', 'Error raised by the saver itself, before it built a query.');
    return;
  }
  const owner = String(run.result?.owner || 'Unknown owner');
  const isOtherUser = owner !== run.simulatedRequester;
  ui.resultPanel.classList.toggle('cross-user', isOtherUser);
  addResultText('span', 'result-status', isOtherUser ? 'SOMEONE ELSE’S CHAT' : 'ALICE’S OWN CHAT');
  addResultText('h3', 'result-owner', `${owner}’s conversation`);
  const saved = run.result?.messages?.[0];
  if (saved) addDetail(`${owner}’s saved message`, `“${saved.text}”`);
  addDetail('Saved order details · fictional', run.result?.privateNote);
  addDetail('Scripted reply · no LLM', run.result?.reply, 'reply-detail');
}

function renderStore(store, run = null) {
  ui.store.replaceChildren();
  for (const thread of store) {
    const returned = run?.status === 'ok' && run.result?.owner === thread.owner;
    const card = document.createElement('div');
    card.className = `store-card ${returned ? 'returned' : ''} ${returned && thread.owner !== run.simulatedRequester ? 'leaked' : ''}`;
    const name = document.createElement('strong');
    name.textContent = `${thread.owner}’s chat`;
    const id = document.createElement('code');
    id.textContent = thread.threadId;
    const tags = document.createElement('div');
    tags.className = 'store-tags';
    const addTag = (text, className = '') => {
      const tag = document.createElement('span');
      tag.textContent = text;
      tag.className = className;
      tags.append(tag);
    };
    if (thread.newest) addTag('newest');
    if (run && !run.queryTrace.length) addTag('not queried');
    else if (run) addTag(thread.matched ? 'matches the query' : 'does not match', thread.matched ? 'hit' : '');
    if (returned) addTag('returned to Alice', 'returned-tag');
    card.append(name, id, tags);
    ui.store.append(card);
  }
}

function renderTrials() {
  ui.trialControls.replaceChildren();
  ui.scoreboard.replaceChildren();
  scoreCells = new Map();
  trialButtons = trials.map(trial => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'trial-button';
    const number = document.createElement('span');
    number.className = 'trial-number';
    number.textContent = trial.id;
    const text = document.createElement('span');
    const title = document.createElement('strong');
    title.textContent = trial.label;
    const detail = document.createElement('small');
    detail.textContent = `${trial.version} ${trial.version === '1.3.0' ? 'vulnerable' : 'patched'} · ${trial.request}`;
    text.append(title, detail);
    button.append(number, text);
    button.addEventListener('click', () => runTrial(trial, button));
    ui.trialControls.append(button);

    const row = document.createElement('tr');
    const cells = [trial.id, trial.request, trial.version, '—', '—'].map(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
      return cell;
    });
    cells[3].className = 'pending';
    cells[4].className = 'pending';
    ui.scoreboard.append(row);
    scoreCells.set(trial.id, { row, reached: cells[3], received: cells[4] });
    return button;
  });
}

function highlightTrial(trial, button) {
  for (const other of trialButtons) {
    other.classList.toggle('selected', other === button);
    other.setAttribute('aria-pressed', String(other === button));
  }
  for (const [id, cells] of scoreCells) cells.row.classList.toggle('current', id === trial.id);
}

function updateScore(trial, run) {
  const cells = scoreCells.get(trial.id);
  const reached = run.queryTrace.length > 0;
  const leaked = run.status === 'ok' && run.result?.owner !== run.simulatedRequester;
  cells.reached.textContent = reached ? 'Yes' : 'No, stopped first';
  cells.reached.className = reached ? '' : 'good';
  cells.received.textContent = run.status === 'rejected' ? 'Nothing: rejected' : `${run.result?.owner}’s chat`;
  cells.received.className = leaked ? 'bad' : 'good';
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    ready = status.ready === true;
    ui.serverStatus.textContent = ready ? 'Local server ready' : 'Not ready';
    ui.serverStatus.className = `server-status ${ready ? 'ready' : 'error'}`;
    setEvidenceAvailable(Boolean(status.evidenceAvailable));
    trials = status.trials || [];
    renderTrials();
    renderStore(status.store || []);
    setMessage(ready ? 'Ready.' : 'The local database is not ready. Check the server, then reload this page.', !ready);
  } catch (error) {
    ready = false;
    ui.serverStatus.textContent = 'Server unavailable';
    ui.serverStatus.className = 'server-status error';
    setMessage(`Cannot connect to the local demo. Start the server and reload. ${error.message}`, true);
  }
  updateControls();
}

async function runTrial(trial, button) {
  if (busy || !ready) return;
  busy = true;
  updateControls();
  resetPanels();
  highlightTrial(trial, button);
  setHeadline(`Trial ${trial.id}: ${trial.label}`);
  setMessage('Running the actual LangGraph call and capturing database commands…');
  try {
    const run = await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: trial.version, requestKind: trial.requestKind }) });
    setActivePanel(ui.requestPanel);
    showRequest(run);
    await pause();
    setActivePanel(ui.queryPanel);
    showQuery(run);
    await pause();
    setActivePanel(null);
    showResult(run);
    renderStore(run.store, run);
    updateScore(trial, run);
    const leaked = run.status === 'ok' && run.result?.owner !== run.simulatedRequester;
    setHeadline(trial.proves, leaked ? 'leak' : 'safe');
    setEvidenceAvailable(Boolean(run.evidenceFile));
    if (run.expectedPassed === false) setMessage(`Unexpected result for trial ${trial.id}. Click Reset and run it again before presenting.`, true);
    else setMessage(`Run ${run.runId} · evidence saved`);
  } catch (error) {
    setActivePanel(null);
    setHeadline(`Trial ${trial.id} did not complete. No conclusion can be drawn from this run.`);
    ui.result.replaceChildren();
    addResultText('h3', 'result-owner', 'Run did not complete');
    addResultText('p', 'rejection-error', error.message);
    setMessage(error.message, true);
  } finally {
    busy = false;
    updateControls();
  }
}

ui.evidence.addEventListener('click', event => { if (ui.evidence.getAttribute('aria-disabled') === 'true') event.preventDefault(); });
ui.resetButton.addEventListener('click', async () => {
  if (busy || !ready) return;
  busy = true;
  updateControls();
  setMessage('Resetting the local fictional data…');
  try {
    await api('/api/reset', { method: 'POST' });
    resetPanels();
    setHeadline('Choose a trial to begin.');
    busy = false;
    await refreshStatus();
  } catch (error) {
    setMessage(`Reset failed. ${error.message}`, true);
  } finally {
    busy = false;
    updateControls();
  }
});

updateControls();
refreshStatus();
