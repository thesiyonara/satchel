// Sync it phone client. Served by the desktop's Phone access service and talks only to the same origin.
// Everything is built with DOM APIs; no markup is ever assembled from text, so collection contents cannot inject anything.
(() => {
  'use strict';
  const TOKEN_KEY = 'syncit-phone-token';
  const root = document.getElementById('app');
  const state = { token: localStorage.getItem(TOKEN_KEY) || '', status: null, items: [], query: '', filter: 'all', view: { name: 'list' }, busy: false, pendingCode: '' };
  const thumbnails = new Map();
  const labels = { starting: 'starting the sync engine', unpaired: 'no computer paired yet', offline: 'paired computers offline', syncing: 'syncing', synced: 'up to date', error: 'sync needs attention', paused: 'sync paused' };
  const kindNames = { all: 'All', note: 'Notes', image: 'Photos', video: 'Videos', audio: 'Audio', file: 'Files' };
  const imageExt = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.svg', '.ico'];

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
  const icon = (name) => el('span', { class: `glyph glyph-${name}`, 'aria-hidden': 'true' });
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

  const size = bytes => bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
  const when = ms => { const d = new Date(ms); const today = new Date(); return d.toDateString() === today.toDateString() ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const title = item => item.kind === 'note' ? item.name.replace(/\.(md|txt)$/i, '') : item.name;
  const folder = path => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const extOf = name => { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i).toLowerCase(); };
  const previewOf = item => item.previewKind || (item.kind === 'image' || item.kind === 'video' || item.kind === 'audio' ? item.kind : null);
  const notePreview = item => (item.preview || '').replace(/^#+\s*/gm, '').split('\n').map(line => line.trim()).filter(line => line && line !== title(item)).slice(0, 2).join(' · ');

  // Only the list view is rebuilt to reflect busy state; other screens keep their live elements across a request.
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
  const streamLink = item => api('POST', '/v1/media-ticket', { json: { path: item.path } }).then(ticket => ticket.url);
  const osPreview = item => api('GET', `/v1/preview?path=${encodeURIComponent(item.path)}`, { blob: true }).then(blob => URL.createObjectURL(blob));
  function go(view) { state.view = view; render(); window.scrollTo(0, 0); }

  function topBar(text, options = {}) {
    return el('header', { class: 'top' },
      options.back ? el('button', { class: 'plain back', 'aria-label': 'Back', onclick: () => go({ name: 'list' }) }, icon('back'), 'Back') : el('span', { class: 'brand' }, el('span', { text: 's/i' })),
      el('h1', { text }),
      options.back ? null : el('button', { class: 'plain', 'aria-label': 'Computer', title: 'This computer', onclick: () => go({ name: 'computer' }) }, icon('computer')));
  }
  function statusLine() {
    const status = state.status; if (!status) return null;
    const ok = status.state === 'synced' || status.state === 'unpaired';
    return el('p', { class: 'status' }, el('i', { class: ok ? 'ok' : status.state === 'error' ? 'bad' : '' }), `${status.deviceName} · ${labels[status.state] || status.state}`);
  }
  function thumbFor(item, cls = 'thumb') {
    const preview = previewOf(item);
    const box = el('div', { class: `${cls} kind-${item.kind}` }, el('span', { class: 'kind-tag', text: item.kind === 'note' ? 'NOTE' : item.kind === 'image' ? 'PHOTO' : item.kind === 'video' ? 'VIDEO' : item.kind === 'audio' ? 'AUDIO' : (extOf(item.name).slice(1) || 'FILE').slice(0, 4).toUpperCase() }));
    if (item.kind === 'image' || item.kind === 'video' || preview === 'pdf') thumbnail(item).then(url => { box.replaceChildren(el('img', { src: url, alt: '' })); if (item.kind === 'video') box.append(el('span', { class: 'play' })); }).catch(() => {});
    return box;
  }

  function renderPairing(prefill) {
    const input = el('input', { 'aria-label': 'Pairing code', placeholder: 'Pairing code', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', value: prefill || '' });
    const form = el('form', { onsubmit: event => { event.preventDefault(); void run(() => pair(input.value.trim().toUpperCase())); } },
      el('div', { class: 'card' }, el('h2', { text: 'Pair with this computer' }), el('p', { text: 'On the computer, open Preferences → Phone access and choose “Pair a phone”. Scanning its QR code with the camera fills this in; otherwise type the eight-character code.' }), input),
      el('button', { class: 'primary wide', type: 'submit', disabled: state.busy, text: state.busy ? 'Pairing…' : 'Pair' }));
    root.replaceChildren(el('header', { class: 'top' }, el('span', { class: 'brand' }, el('span', { text: 's/i' })), el('h1', { text: 'Phone access' })), form, el('p', { class: 'status', text: 'Nothing is stored on this phone except the pairing. The collection stays on the computer.' }));
  }

  function renderList() {
    const query = state.query.toLowerCase();
    const counts = { all: state.items.length };
    for (const item of state.items) counts[item.kind] = (counts[item.kind] || 0) + 1;
    const visible = state.items.filter(item => (state.filter === 'all' || item.kind === state.filter) && `${item.path} ${item.preview || ''}`.toLowerCase().includes(query));
    const search = el('input', { type: 'search', 'aria-label': 'Search the collection', placeholder: 'Search names, folders and note text', value: state.query, oninput: event => { state.query = event.target.value; renderList(); } });
    const chips = el('div', { class: 'chips', role: 'tablist' }, ['all', 'note', 'image', 'video', 'audio', 'file'].filter(kind => kind === 'all' || kind === 'note' || counts[kind]).map(kind =>
      el('button', { class: `chip ${state.filter === kind ? 'active' : ''}`, role: 'tab', 'aria-selected': state.filter === kind ? 'true' : 'false', onclick: () => { state.filter = kind; renderList(); } }, kindNames[kind], el('span', { text: String(counts[kind] || 0) }))));
    const grid = state.filter === 'image' || state.filter === 'video';
    const content = !visible.length ? el('p', { class: 'empty', text: state.items.length ? 'No matches.' : 'The collection is empty. Add a note or a photo below.' })
      : grid ? el('div', { class: 'tiles' }, visible.map(item => el('button', { class: 'tile', 'aria-label': item.name, onclick: () => open(item) }, thumbFor(item, 'tile-thumb'), el('span', { class: 'tile-name', text: item.name }))))
      : el('ul', { class: 'list' }, visible.map(item => el('li', {}, el('button', { class: 'item', onclick: () => open(item) },
        thumbFor(item),
        el('div', { class: 'text' }, el('strong', { text: title(item) }), folder(item.path) ? el('span', { class: 'folder', text: folder(item.path) }) : null,
          el('small', { text: item.kind === 'note' ? notePreview(item) || 'Empty note' : `${size(item.size)} · ${when(item.modifiedAt)}` })),
        el('span', { class: 'chevron', 'aria-hidden': 'true' })))));
    const upload = el('input', { type: 'file', class: 'hidden', 'aria-label': 'Choose a file to add', onchange: event => { const file = event.target.files[0]; if (file) void run(async () => { await api('POST', `/v1/upload?name=${encodeURIComponent(file.name)}`, { body: file, contentType: file.type || 'application/octet-stream' }); await load(); toast(`${file.name} added to the collection.`); }); event.target.value = ''; } });
    root.replaceChildren(
      topBar(state.status ? state.status.collection : 'Collection'), statusLine(),
      el('div', { class: 'toolbar' }, search, el('button', { class: 'plain', 'aria-label': 'Refresh', title: 'Refresh', disabled: state.busy, onclick: () => void run(load) }, icon('refresh'))),
      chips, content, upload,
      el('div', { class: 'actions' },
        el('button', { class: 'primary', disabled: state.busy, onclick: () => go({ name: 'note', item: null }), text: 'New note' }),
        el('button', { disabled: state.busy, onclick: () => upload.click(), text: 'Add photo or file' })));
  }
  function open(item) { go({ name: item.kind === 'note' ? 'note' : 'item', item }); }

  function renderItem() {
    const item = state.view.item; const preview = previewOf(item);
    const problem = el('p', { class: 'save-state error hidden', text: 'This phone cannot show this file. Download it and open it in another app.' });
    const fail = message => { if (message) problem.textContent = message; problem.classList.remove('hidden'); };
    let body;
    if (preview === 'image') {
      body = el('img', { class: 'preview-image', alt: item.name });
      const useOS = () => osPreview(item).then(url => { body.src = url; }).catch(error => fail(error.message));
      if (imageExt.includes(extOf(item.name))) { streamLink(item).then(url => { body.src = url; }).catch(error => fail(error.message)); body.addEventListener('error', () => { body.removeAttribute('src'); void useOS(); }, { once: true }); }
      else void useOS();
    } else if (preview === 'video' || preview === 'audio') {
      body = preview === 'video' ? el('video', { class: 'preview-video', controls: true, playsinline: true, autoplay: true, 'aria-label': item.name }) : el('audio', { class: 'preview-audio', controls: true, autoplay: true, 'aria-label': item.name });
      streamLink(item).then(url => { body.src = url; }).catch(error => fail(error.message));
      body.addEventListener('error', () => fail());
    } else if (preview === 'pdf') {
      body = el('iframe', { class: 'preview-pdf', title: item.name });
      streamLink(item).then(url => { body.src = url; }).catch(error => fail(error.message));
    } else if (preview === 'text') {
      body = el('pre', { class: 'preview-text', 'aria-label': 'File text', text: 'Loading…' });
      api('GET', `/v1/text?path=${encodeURIComponent(item.path)}`).then(result => { body.textContent = result.text; }).catch(error => { body.textContent = ''; fail(error.message); });
    } else body = el('div', { class: 'card center' }, icon('file'), el('p', { text: 'No preview for this type on the phone. Download it to open it in another app.' }));
    root.replaceChildren(topBar(item.name, { back: true }), body, problem,
      el('p', { class: 'meta', text: `${size(item.size)} · ${when(item.modifiedAt)}${folder(item.path) ? ` · ${folder(item.path)}` : ''}` }),
      el('div', { class: 'actions' }, el('button', { class: 'primary', disabled: state.busy, onclick: () => void run(() => download(item)), text: 'Download original' })));
  }

  function renderNote() {
    const item = state.view.item;
    const textarea = el('textarea', { 'aria-label': 'Note text', placeholder: 'Write here.', spellcheck: 'true', oninput: () => grow() });
    // The editor grows with the text so the page scrolls, never a box inside it.
    const grow = () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.max(textarea.scrollHeight + 24, window.innerHeight - 190)}px`; };
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
    root.replaceChildren(topBar(item ? title(item) : 'New note', { back: true }), textarea, saveState,
      el('div', { class: 'actions' }, saveButton, item ? el('button', { 'aria-label': 'Download note', onclick: () => void run(() => download(item)), text: 'Download' }) : null));
    grow();
    if (item) api('GET', `/v1/note?path=${encodeURIComponent(item.path)}`).then(note => { document_ = note; textarea.value = note.text; grow(); }).catch(error => { saveState.className = 'save-state error'; saveState.textContent = error.message; });
    else textarea.focus();
  }

  function renderComputer() {
    const status = state.status || {};
    root.replaceChildren(topBar('This computer', { back: true }),
      el('div', { class: 'card' },
        el('h2', { text: status.deviceName || 'Computer' }),
        el('p', { text: `Collection “${status.collection || ''}” · ${labels[status.state] || status.state || ''}.` }),
        el('p', { text: `${status.phones || 1} phone${status.phones === 1 ? '' : 's'} paired. This phone appears as “${status.phone ? status.phone.name : 'Phone'}” in the computer’s Phone access list.` }),
        el('p', { text: 'Nothing from the collection is stored on this phone. Photos and files are fetched from the computer each time; notes are saved straight to it.' })),
      el('div', { class: 'card' },
        el('h2', { text: 'Unpair' }),
        el('p', { text: 'Removes this phone’s access. Pair again from the computer at any time.' }),
        el('button', { class: 'danger', disabled: state.busy, onclick: () => { if (confirm('Unpair this phone from the computer?')) void run(async () => { await api('DELETE', '/v1/session').catch(() => {}); forget(); toast('Unpaired.'); }); }, text: 'Unpair' })));
  }

  function render() {
    if (!state.token) return renderPairing(state.pendingCode);
    if (state.view.name === 'note') return renderNote();
    if (state.view.name === 'item') return renderItem();
    if (state.view.name === 'computer') return renderComputer();
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
