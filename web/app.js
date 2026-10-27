// Sync it phone client. Served by the desktop's Phone access service and talks only to the same origin.
// Everything is built with DOM APIs; no markup is ever assembled from text, so collection contents cannot inject anything.
(() => {
  'use strict';
  const TOKEN_KEY = 'syncit-phone-token';
  const root = document.getElementById('app');
  const state = { token: localStorage.getItem(TOKEN_KEY) || '', status: null, items: [], query: '', view: { name: 'list' }, busy: false };
  const thumbnails = new Map();

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  };
  let toastTimer;
  function toast(message) {
    document.querySelectorAll('.toast').forEach(node => node.remove());
    const node = el('div', { class: 'toast', role: 'status', text: message });
    document.body.append(node);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.remove(), 5000);
  }
  function forget() { state.token = ''; localStorage.removeItem(TOKEN_KEY); state.status = null; state.items = []; state.view = { name: 'list' }; }

  async function api(method, path, options = {}) {
    const headers = {};
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    let body;
    if (options.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.json); }
    else if (options.body !== undefined) { headers['Content-Type'] = options.contentType || 'application/octet-stream'; body = options.body; }
    const response = await fetch(path, { method, headers, body, cache: 'no-store' });
    if (response.status === 401 && state.token) { forget(); render(); throw new Error('This phone is no longer paired. Pair it again from the computer.'); }
    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try { message = (await response.json()).error || message; } catch { /* not JSON */ }
      throw new Error(message);
    }
    if (options.blob) return response.blob();
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  const labels = { starting: 'starting the sync engine', unpaired: 'no computer paired yet', offline: 'paired computers offline', syncing: 'syncing', synced: 'up to date', error: 'sync needs attention', paused: 'sync paused' };
  const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const when = ms => new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const title = item => item.kind === 'note' ? item.name.replace(/\.(md|txt)$/i, '') : item.name;
  const folder = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';

  // Only the list view is rebuilt to reflect busy state; the editor keeps its live elements across a save.
  async function run(action) {
    if (state.busy) return;
    state.busy = true; if (state.view.name === 'list' || !state.token) render();
    try { await action(); } catch (error) { toast(error.message || String(error)); }
    finally { state.busy = false; if (state.view.name === 'list' || !state.token) render(); }
  }
  async function load() {
    state.status = await api('GET', '/v1/status');
    const response = await api('GET', '/v1/items');
    state.items = response.items;
    if (response.error) toast(response.error);
  }
  async function pair(code) {
    const result = await api('POST', '/v1/pair', { json: { code, name: `${/iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : 'Phone'} (web)` } });
    state.token = result.token; localStorage.setItem(TOKEN_KEY, state.token);
    await load();
    toast(`Paired with ${result.deviceName}.`);
  }
  async function download(item) {
    const blob = await api('GET', `/v1/file?path=${encodeURIComponent(item.path)}`, { blob: true });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: item.name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function thumbnail(item) {
    if (thumbnails.has(item.path)) return thumbnails.get(item.path);
    const blob = await api('GET', `/v1/thumbnail?path=${encodeURIComponent(item.path)}`, { blob: true });
    const url = URL.createObjectURL(blob); thumbnails.set(item.path, url); return url;
  }

  function header(text, back) {
    return el('header', { class: 'top' },
      back ? el('button', { class: 'plain', 'aria-label': 'Back', onclick: () => { state.view = { name: 'list' }; render(); }, text: '‹ Back' }) : el('span', { class: 'brand' }, el('span', { text: 's/i' }), 'Sync it'),
      el('h1', { text }));
  }
  function statusLine() {
    const status = state.status; if (!status) return null;
    const ok = status.state === 'synced' || status.state === 'unpaired';
    return el('p', { class: 'status' }, el('i', { class: ok ? 'ok' : status.state === 'error' ? 'bad' : '' }), `${status.collection} on ${status.deviceName} · ${labels[status.state] || status.state}`);
  }

  function renderPairing(prefill) {
    const input = el('input', { 'aria-label': 'Pairing code', placeholder: 'Pairing code', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', value: prefill || '' });
    const form = el('form', { onsubmit: event => { event.preventDefault(); void run(() => pair(input.value.trim().toUpperCase())); } },
      el('div', { class: 'card' }, el('h2', { text: 'Pair with this computer' }), el('p', { text: 'On the computer, open Preferences → Phone access and choose “Pair a phone”. Scanning its QR code with the camera fills this in; otherwise type the eight-character code.' }), input),
      el('button', { class: 'primary', type: 'submit', disabled: state.busy, text: state.busy ? 'Pairing…' : 'Pair' }));
    root.replaceChildren(header('Phone access'), form, el('p', { class: 'status', text: 'Nothing is stored on this phone except the pairing. The collection stays on the computer.' }));
  }
  function renderList() {
    const query = state.query.toLowerCase();
    const visible = state.items.filter(item => `${item.path} ${item.preview || ''}`.toLowerCase().includes(query));
    const search = el('input', { type: 'search', 'aria-label': 'Search the collection', placeholder: 'Search names, folders and note text', value: state.query, oninput: event => { state.query = event.target.value; renderList(); } });
    const list = el('ul', { class: 'list' }, visible.map(item => {
      const thumb = el('div', { class: 'thumb', text: item.kind === 'note' ? 'NOTE' : item.kind === 'image' ? 'IMG' : (item.name.split('.').at(-1) || 'FILE').slice(0, 4).toUpperCase() });
      if (item.kind === 'image') thumbnail(item).then(url => thumb.replaceChildren(el('img', { src: url, alt: '' }))).catch(() => {});
      return el('li', {}, el('button', { class: 'item', onclick: () => { state.view = { name: item.kind === 'note' ? 'note' : 'file', item }; render(); } },
        thumb,
        el('div', { class: 'text' }, el('strong', { text: title(item) }), folder(item.path) ? el('span', { class: 'folder', text: folder(item.path) }) : null, el('small', { text: item.kind === 'note' ? (item.preview || '').replace(/^#+\s*/gm, '').split('\n').map(line => line.trim()).filter(line => line && line !== title(item)).slice(0, 2).join(' · ') || 'Empty note' : `${size(item.size)} · ${when(item.modifiedAt)}` }))));
    }));
    const upload = el('input', { type: 'file', class: 'hidden', 'aria-label': 'Choose a file to add', onchange: event => { const file = event.target.files[0]; if (file) void run(async () => { await api('POST', `/v1/upload?name=${encodeURIComponent(file.name)}`, { body: file, contentType: file.type || 'application/octet-stream' }); await load(); toast(`${file.name} added to the collection.`); }); event.target.value = ''; } });
    root.replaceChildren(
      header(state.status ? state.status.collection : 'Collection'), statusLine(),
      el('div', { class: 'toolbar' }, search, el('button', { 'aria-label': 'Refresh', onclick: () => void run(load), text: '↻' })),
      visible.length ? list : el('p', { class: 'empty', text: state.items.length ? 'No matches.' : 'The collection is empty.' }),
      upload,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', disabled: state.busy, onclick: () => { state.view = { name: 'note', item: null }; render(); }, text: 'New note' }),
        el('button', { disabled: state.busy, onclick: () => upload.click(), text: 'Add photo or file' }),
        el('button', { class: 'plain danger', disabled: state.busy, onclick: () => { if (confirm('Unpair this phone from the computer?')) void run(async () => { await api('DELETE', '/v1/session').catch(() => {}); forget(); toast('Unpaired.'); }); }, text: 'Unpair' })));
    search.focus({ preventScroll: true });
  }
  function renderNote() {
    const item = state.view.item;
    const textarea = el('textarea', { 'aria-label': 'Note text', placeholder: 'Write here.', spellcheck: 'true' });
    const saveState = el('p', { class: 'save-state' });
    let document_ = null;
    const saveButton = el('button', { class: 'primary', text: 'Save', onclick: () => void run(async () => {
      saveButton.disabled = true;
      const text = textarea.value;
      if (document_) {
        const saved = await api('PUT', '/v1/note', { json: { path: document_.path, text, revision: document_.revision } });
        document_ = saved;
        saveState.className = 'save-state'; saveState.textContent = saved.conflict ? 'The computer had a newer copy, so yours was kept as a conflict copy.' : `Saved on ${state.status ? state.status.deviceName : 'the computer'}.`;
      } else {
        document_ = await api('POST', '/v1/note', { json: { text } });
        saveState.textContent = `Saved as ${document_.path}.`;
      }
      await load();
    }).finally(() => { saveButton.disabled = false; }) });
    root.replaceChildren(header(item ? title(item) : 'New note', true),
      el('div', { class: 'note-head' }, saveButton, item ? el('button', { 'aria-label': 'Download note', onclick: () => void run(() => download(item)), text: 'Download' }) : null),
      textarea, saveState);
    if (item) {
      api('GET', `/v1/note?path=${encodeURIComponent(item.path)}`).then(note => { document_ = note; textarea.value = note.text; }).catch(error => { saveState.className = 'save-state error'; saveState.textContent = error.message; });
    } else textarea.focus();
  }
  function renderFile() {
    const item = state.view.item;
    const preview = item.kind === 'image' ? el('img', { class: 'preview-image', alt: item.name }) : null;
    if (preview) thumbnail(item).then(url => { preview.src = url; }).catch(() => {});
    root.replaceChildren(header(item.name, true), preview,
      el('div', { class: 'card' }, el('p', { text: `${size(item.size)} · ${when(item.modifiedAt)}${folder(item.path) ? ` · ${folder(item.path)}` : ''}` }),
        el('button', { class: 'primary', disabled: state.busy, onclick: () => void run(() => download(item)), text: 'Download original' }),
        el('p', { text: 'Downloads come from the computer each time; nothing stays on this phone.' })));
  }
  function render() {
    if (!state.token) return renderPairing(state.pendingCode);
    if (state.view.name === 'note') return renderNote();
    if (state.view.name === 'file') return renderFile();
    renderList();
  }

  async function main() {
    const match = /[#&]pair=([A-Za-z0-9]{8})/.exec(location.hash);
    if (match) { history.replaceState(null, '', location.pathname); state.pendingCode = match[1].toUpperCase(); }
    render();
    if (match && !state.token) await run(() => pair(match[1].toUpperCase()));
    else if (state.token) await run(load);
    document.addEventListener('visibilitychange', () => { if (!document.hidden && state.token && state.view.name === 'list') void run(load); });
  }
  void main();
})();
