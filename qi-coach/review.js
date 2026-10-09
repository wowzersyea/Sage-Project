// Browser-only review adapter. No authentication, model calls, uploads or Spark access.
const STORAGE = 'qi-coach-review-v1';
const NOTES = 'qi-coach-review-notes-v1';
const initial = await fetch(new URL('./seed.json', import.meta.url)).then(r => {
  if (!r.ok) throw new Error('The synthetic preview could not load. Please refresh.');
  return r.json();
});
let state;
try { state = JSON.parse(localStorage.getItem(STORAGE)); } catch { /* New browser session. */ }
if (!state?.workspace?.project?.synthetic || !state.versions || !state.meetings) state = structuredClone(initial);
const copy = value => structuredClone(value);
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectPath = '/api/projects/synthetic-flow';

function persist() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); }
  catch { throw new Error('Browser storage is unavailable or full. Keep this tab open and download your feedback before leaving.'); }
}

function failure(message, status = 400, data = {}) {
  const error = new Error(message);
  error.status = status;
  error.data = data;
  throw error;
}

function updateArtifact(artifact, body, revision, reason = 'Browser review edit') {
  if (revision !== artifact.revision) failure('A newer local revision exists.', 409, {current: copy(artifact)});
  artifact.body = copy(body);
  artifact.revision++;
  artifact.author = 'Browser reviewer';
  artifact.updated = now();
  state.versions[artifact.id].unshift({revision: artifact.revision, body: copy(body), author: artifact.author, reason, created: artifact.updated});
  return {revision: artifact.revision};
}

function handle(path, method, body) {
  if (path === '/api/me') return {project: 'synthetic-flow', role: 'editor'};
  if (path === projectPath) return state.workspace;
  if (!path.startsWith(projectPath + '/')) failure('Only the synthetic review project is available.', 403);
  const route = path.slice(projectPath.length).split('?')[0];
  const parts = route.split('/').filter(Boolean);
  if (route === '/references/search') return [];
  if (route === '/metrics') {
    if (method === 'POST') {
      state.metrics.unshift({...body, created: now()});
      return {ok: true};
    }
    return state.metrics;
  }
  if (parts[0] === 'artifacts') {
    if (method === 'POST' && parts.length === 1) {
      const artifact = {...copy(body), id: id(), revision: 1, updated: now(), author: 'Browser reviewer'};
      state.workspace.artifacts.push(artifact);
      state.versions[artifact.id] = [{revision: 1, body: copy(body.body), author: artifact.author, reason: 'Created in browser preview', created: artifact.updated}];
      return {id: artifact.id};
    }
    const artifact = state.workspace.artifacts.find(a => a.id === parts[1]);
    if (!artifact) failure('Document not found.', 404);
    if (parts[2] === 'versions' && method === 'GET') return state.versions[artifact.id];
    if (parts[2] === 'undo' && method === 'POST') {
      const version = state.versions[artifact.id].find(v => v.revision === body.target_revision);
      if (!version) failure('Revision not found.', 404);
      return updateArtifact(artifact, version.body, body.revision, 'Restored local revision ' + version.revision);
    }
    if (method === 'PUT') return updateArtifact(artifact, body.body, body.revision);
  }
  if (parts[0] === 'meetings') {
    if (parts.length === 1 && method === 'POST') {
      const meeting = {id: id(), name: body.name, project: 'synthetic-flow', state: 'paused', epoch: 0, created: now(), config: initial.workspace.meetings[0].config};
      state.workspace.meetings.unshift(meeting);
      state.meetings[meeting.id] = {meeting: copy(meeting), segments: [], speakers: [], issues: []};
      return {id: meeting.id};
    }
    const meeting = state.workspace.meetings.find(m => m.id === parts[1]);
    const details = state.meetings[parts[1]];
    if (!meeting || !details) failure('Session not found.', 404);
    if (parts.length === 2 && method === 'GET') return {...details, meeting};
    if (parts[2] === 'state' && method === 'POST') {
      meeting.state = body.state;
      meeting.epoch++;
      return meeting;
    }
    if (parts[2] === 'config' && method === 'PUT') {
      meeting.config = JSON.stringify(body);
      return {ok: true};
    }
    if (parts[2] === 'speakers' && method === 'PUT') {
      const speaker = details.speakers.find(s => s.id === body.id);
      if (!speaker) failure('Speaker not found.', 404);
      Object.assign(speaker, {label: body.label, verified: Number(body.verified)});
      return {ok: true};
    }
    if (parts[2] === 'segments' && method === 'POST') {
      if (meeting.state === 'paused') return {ignored: 'Preview session is paused. Choose Listen first.'};
      const source = body.source || 'room', voice = body.voice || 'unassigned';
      const speaker = `${source}:${voice}`;
      if (!details.speakers.some(s => s.id === speaker)) details.speakers.push({id: speaker, source, voice, label: `${source === 'room' ? 'Room' : 'Remote'} speaker ${voice}`, verified: 0});
      const old = details.segments.find(s => s.id === body.id);
      const revision = body.revision || 1;
      const previousText = old?.text;
      if (old && old.revision >= revision) return {duplicate: true};
      const segment = {...body, speaker, revision, final: 1, uncertain: 1, overlap: 0, created: now()};
      if (old) Object.assign(old, segment); else details.segments.push(segment);
      // Replay shows how source-linked notes look, with no AI or agreement inference.
      const notes = state.workspace.artifacts.find(a => a.kind === 'notes');
      if (notes) {
        const updated = copy(notes.body);
        const noteId = `${meeting.id}:${body.id}`;
        const entry = updated.entries.find(e => e.id === noteId);
        const fields = {id: noteId, text: body.text, classification: 'participant_statement', sources: [{type: 'transcript', meeting: meeting.id, segment: body.id, revision}]};
        if (entry && entry.text === previousText) Object.assign(entry, fields);
        else if (!entry) updated.entries.push(fields);
        else entry.source_changed = true;
        updateArtifact(notes, updated, notes.revision, 'Synthetic transcript replay');
      }
      return {ok: true};
    }
  }
  failure('This feature needs the private Spark app. The public review does not upload files or call live services.', 403);
}

const help = {
  data: 'Review the real chart layout, synthetic snapshot history and measurement definitions. File imports and mapping calculations run on Spark and are disabled in this preview.',
  meetings: 'Try Replay synthetic meeting, edit a transcript, or change speaker labels. The session controls simulate the interface here; live audio and AI replies require the private Spark app.',
  library: 'Preview of the reference library. No textbooks are included. Upload, OCR and retrieval need the private Spark app.',
  delivery: 'Preview of delivery and backup controls. This browser review has no connection to Spark, Teams or OneDrive. Download the full source and setup guide from the private GitHub repository.',
  pilot: 'Observations entered here are practice entries stored only in this browser. They are not results from a real pilot.'
};

function disable(element) {
  element.disabled = true;
  element.setAttribute('aria-disabled', 'true');
  element.title = 'Available in the private Spark app';
  element.classList.add('review-unavailable');
  if (element.tagName === 'A') {
    element.removeAttribute('href');
    element.setAttribute('role', 'link');
  }
}

globalThis.QI_REVIEW = {
  async request(path, method = 'GET', body) {
    const result = handle(path, method, body);
    if (method !== 'GET') persist();
    return copy(result);
  },
  decorate() {
    const active = document.querySelector('.nav .active')?.dataset.page;
    if (help[active]) {
      const note = document.createElement('div');
      note.className = 'review-note';
      note.textContent = help[active];
      document.getElementById('content').prepend(note);
    }
    for (const form of document.querySelectorAll('#importForm, #referenceForm, #coachForm')) {
      for (const control of form.querySelectorAll('input,textarea,select,button')) disable(control);
    }
    for (const control of document.querySelectorAll('[data-action="export"], [data-action="new-dataset"], [data-action="edit-mapping"], [data-action="companion-key"], a[href*="/api/projects/"]')) disable(control);
    if (active === 'delivery') {
      const link = document.createElement('a');
      link.href = 'https://github.com/wowzersyea/qi-coach/blob/main/docs/WINDOWS_COMPANION.md';
      link.target = '_blank'; link.rel = 'noopener noreferrer'; link.className = 'button mt';
      link.textContent = 'Windows setup guide on GitHub';
      document.querySelector('.review-note').append(document.createElement('br'), link);
    }
  }
};

const dialog = document.getElementById('review-dialog');
const notes = document.getElementById('review-notes');
try { notes.value = localStorage.getItem(NOTES) || ''; } catch { /* Optional persistence. */ }
const pageName = () => document.querySelector('.nav .active')?.textContent.trim() || 'Overview';
const feedback = () => `QI Coach review\nPage: ${pageName()}\nPreview: https://sageproject.xyz/qi-coach/\n\n${notes.value}`;
function issueLink() {
  document.getElementById('review-issue').href = 'https://github.com/wowzersyea/qi-coach/issues/new?' + new URLSearchParams({title: `Review feedback: ${pageName()}`, body: feedback()});
}
document.getElementById('review-feedback').addEventListener('click', () => { issueLink(); dialog.showModal(); notes.focus(); });
document.getElementById('review-close').addEventListener('click', () => dialog.close());
notes.addEventListener('input', () => {
  try { localStorage.setItem(NOTES, notes.value); } catch { /* Download remains available. */ }
  issueLink();
});
document.getElementById('review-download').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([feedback()], {type: 'text/plain'}));
  const a = document.createElement('a'); a.href = url; a.download = 'qi-coach-feedback.txt'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.getElementById('review-reset').addEventListener('click', () => {
  if (confirm('Reset the demo documents and sessions? Your feedback notes will be kept.')) {
    localStorage.removeItem(STORAGE); location.reload();
  }
});
await import('./app.js');
