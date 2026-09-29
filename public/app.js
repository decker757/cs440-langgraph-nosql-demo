'use strict';

const ui = {
  form: document.querySelector('#run-form'),
  version: document.querySelector('#adapter-version'),
  requestKind: document.querySelector('#request-kind'),
  runButton: document.querySelector('#run-button'),
  resetButton: document.querySelector('#reset-button'),
  trials: [...document.querySelectorAll('.trial-button')],
  serverStatus: document.querySelector('#server-status'),
  statusMessage: document.querySelector('#status-message'),
  context: document.querySelector('#run-context'),
  message: document.querySelector('#chat-message'),
  request: document.querySelector('#request-json'),
  query: document.querySelector('#query-json'),
  lookupCount: document.querySelector('#lookup-count'),
  nodeRan: document.querySelector('#node-ran'),
  resultPanel: document.querySelector('#result-panel'),
  result: document.querySelector('#result-content'),
  resultCheck: document.querySelector('#result-check'),
  evidence: document.querySelector('#evidence-link'),
};

let ready = false;
let busy = false;

function setMessage(message, isError = false) {
  ui.statusMessage.textContent = message;
  ui.statusMessage.classList.toggle('error', isError);
}

function updateControls() {
  ui.runButton.disabled = busy || !ready;
  ui.resetButton.disabled = busy || !ready;
  ui.version.disabled = busy;
  ui.requestKind.disabled = busy;
  for (const button of ui.trials) {
    button.disabled = busy || !ready;
    const selected = button.dataset.version === ui.version.value && button.dataset.kind === ui.requestKind.value;
    button.classList.toggle('selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  }
  ui.form.setAttribute('aria-busy', String(busy));
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

function resetPreview(message = 'Choose a trial to begin.') {
  ui.context.textContent = message;
  ui.message.textContent = '“Continue my chat”';
  placeholder(ui.request, 'Run a trial to see the submitted fields.');
  placeholder(ui.query, 'Run a trial to inspect the lookup.');
  ui.lookupCount.textContent = '—';
  ui.nodeRan.textContent = '—';
  ui.resultPanel.classList.remove('cross-user');
  ui.result.replaceChildren();
  const empty = document.createElement('div');
  empty.className = 'empty-result';
  const symbol = document.createElement('span');
  symbol.className = 'empty-symbol';
  symbol.setAttribute('aria-hidden', 'true');
  symbol.textContent = '↩';
  const text = document.createElement('p');
  text.textContent = 'The real returned state will appear here.';
  empty.append(symbol, text);
  ui.result.append(empty);
  ui.resultCheck.textContent = 'No result for this selection yet.';
  ui.resultCheck.className = 'panel-note';
  updateControls();
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
  if (label === 'Fixture marker') description.className = 'marker-value';
  detail.append(term, description);
  ui.result.append(detail);
}

function showRun(run) {
  const traces = Array.isArray(run.queryTrace) ? run.queryTrace : [];
  const kind = run.requestKind === 'operator' ? 'Operator objects' : 'Normal text IDs';
  ui.context.textContent = `${run.version} · ${kind} · Run ${run.runId}`;
  ui.message.textContent = `“${run.request.message}”`;
  renderJSON(ui.request, run.request.configurable);
  if (traces.length) renderJSON(ui.query, traces[0]);
  else placeholder(ui.query, 'No database lookup recorded.');
  ui.lookupCount.textContent = String(traces.length);
  ui.nodeRan.textContent = run.graphNodeRan ? 'Yes' : 'No';
  ui.result.replaceChildren();
  ui.resultPanel.classList.remove('cross-user');

  if (run.status === 'rejected') {
    addResultText('span', 'result-status', 'Request rejected');
    addResultText('h3', 'result-owner', 'No conversation restored');
    if (run.error) addResultText('p', 'rejection-error', run.error);
    addResultText('p', 'rejection-note', traces.length === 0 ? 'The request stopped before a database lookup.' : `${traces.length} lookup queries were recorded before rejection.`);
  } else if (run.result) {
    const owner = String(run.result.owner || 'Unknown owner');
    const isOtherUser = owner.toLowerCase() !== 'alice';
    ui.resultPanel.classList.toggle('cross-user', isOtherUser);
    addResultText('span', 'result-status', isOtherUser ? 'Different owner returned' : 'Requester’s state returned');
    addResultText('h3', 'result-owner', `${owner}’s conversation`);
    addDetail('Fixture marker', run.result.marker);
    addDetail('Saved private note · fictional', run.result.privateNote);
    addDetail('Deterministic reply · no LLM', run.result.reply, 'reply-detail');
  } else {
    addResultText('span', 'result-status', 'No saved state');
    addResultText('h3', 'result-owner', 'No checkpoint returned');
    if (run.error) addResultText('p', 'rejection-error', run.error);
  }

  if (typeof run.expectedPassed === 'boolean') {
    ui.resultCheck.textContent = run.expectedPassed ? 'Server check: expected result confirmed.' : 'Server check: result differs from expectation.';
    ui.resultCheck.className = `panel-note ${run.expectedPassed ? 'check-pass' : 'check-fail'}`;
  } else {
    ui.resultCheck.textContent = 'Actual response captured.';
    ui.resultCheck.className = 'panel-note';
  }
  setEvidenceAvailable(Boolean(run.evidenceFile));
  setMessage(run.evidenceFile ? `Evidence saved: ${String(run.evidenceFile).split(/[\\/]/).pop()}` : 'Trial complete. Results shown are from the server response.');
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    ready = status.ready === true;
    ui.serverStatus.textContent = ready ? 'Local server ready' : 'Not ready';
    ui.serverStatus.className = `server-status ${ready ? 'ready' : 'error'}`;
    setEvidenceAvailable(Boolean(status.evidenceAvailable));
    const owners = (status.fixtureUsers || []).map(user => user.owner).join(' / ');
    setMessage(ready ? `Ready${owners ? ` · Fictional fixture: ${owners}` : ''}. Select a trial or continue the chat.` : 'The local database is not ready. Check the server, then reload this page.', !ready);
  } catch (error) {
    ready = false;
    ui.serverStatus.textContent = 'Server unavailable';
    ui.serverStatus.className = 'server-status error';
    setMessage(`Cannot connect to the local demo. Start the server and reload. ${error.message}`, true);
  }
  updateControls();
}

async function runTrial() {
  if (busy || !ready) return;
  const version = ui.version.value;
  const requestKind = ui.requestKind.value;
  busy = true;
  resetPreview(`${version} · ${requestKind === 'operator' ? 'Operator objects' : 'Normal text IDs'} · Running…`);
  setMessage('Running the actual LangGraph call and capturing database commands…');
  ui.runButton.textContent = 'Loading saved state…';
  try {
    showRun(await api('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version, requestKind }) }));
  } catch (error) {
    ui.context.textContent = `${version} · Run failed`;
    ui.result.replaceChildren();
    addResultText('h3', 'result-owner', 'Run did not complete');
    addResultText('p', 'rejection-error', error.message);
    ui.resultCheck.textContent = 'No conclusion can be drawn from this run.';
    setMessage(error.message, true);
  } finally {
    busy = false;
    ui.runButton.textContent = 'Continue my chat →';
    updateControls();
  }
}

ui.form.addEventListener('submit', event => { event.preventDefault(); runTrial(); });
for (const button of ui.trials) {
  button.addEventListener('click', () => {
    ui.version.value = button.dataset.version;
    ui.requestKind.value = button.dataset.kind;
    runTrial();
  });
}
for (const select of [ui.version, ui.requestKind]) select.addEventListener('change', () => resetPreview('Selection changed. Run it to capture a new result.'));
ui.evidence.addEventListener('click', event => { if (ui.evidence.getAttribute('aria-disabled') === 'true') event.preventDefault(); });
ui.resetButton.addEventListener('click', async () => {
  if (busy || !ready) return;
  busy = true;
  updateControls();
  setMessage('Resetting the local fictional fixture…');
  try {
    await api('/api/reset', { method: 'POST' });
    resetPreview('Fixture reset. Choose a trial to begin.');
    await refreshStatus();
  } catch (error) {
    setMessage(`Fixture reset failed. ${error.message}`, true);
  } finally {
    busy = false;
    updateControls();
  }
});

updateControls();
refreshStatus();
