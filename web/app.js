// Satchel phone client. Served by the desktop's Phone access service and talks only to the same origin.
// Everything is built with DOM APIs; no markup is ever assembled from text, so collection contents cannot inject anything.
(() => {
  'use strict';
  const TOKEN_KEY = 'syncit-phone-token';
  const root = document.getElementById('app');
  const state = { token: localStorage.getItem(TOKEN_KEY) || '', status: null, items: null, query: '', filter: 'all', view: { name: 'list' }, busy: false, pendingCode: '' };
  const thumbnails = new Map();
  const labels = { starting: 'starting', unpaired: 'no computer paired', offline: 'computers offline', syncing: 'syncing', synced: 'up to date', error: 'needs attention', paused: 'paused' };
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
  const icon = name => el('span', { class: `glyph glyph-${name}`, 'aria-hidden': 'true' });
  let toastTimer;
  function toast(message) {
    document.querySelectorAll('.toast').forEach(node => node.remove());
    const node = el('div', { class: 'toast', role: 'status', text: message });
    document.body.append(node);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => node.remove(), 4500);
  }
  function forget() { state.token = ''; localStorage.removeItem(TOKEN_KEY); state.status = null; state.items = null; state.view = { name: 'list' }; }

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
  // Card text without Markdown syntax: headings, emphasis and quote markers go, list markers become bullets.
  const notePreview = item => (item.preview || '').replace(/^#+\s*/gm, '').replace(/^\s*>\s?/gm, '').replace(/^\s*[-*+]\s+/gm, '• ').replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, '$1$2').replace(/`([^`]+)`/g, '$1').split('\n').map(line => line.trim()).filter(line => line && line !== title(item)).join(' ');
  const tint = path => path.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 3;
  const canShareFiles = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

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
  async function fetchFile(item) { return api('GET', `/v1/file?path=${encodeURIComponent(item.path)}`, { blob: true }); }
  async function download(item) {
    const blob = await fetchFile(item);
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: item.name });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function share(item) {
    const blob = await fetchFile(item);
    const file = new File([blob], item.name, { type: blob.type || 'application/octet-stream' });
    if (!navigator.canShare({ files: [file] })) throw new Error('This phone cannot share this file type. Download it instead.');
    try { await navigator.share({ files: [file], title: item.name }); } catch (error) { if (error.name !== 'AbortError') throw error; }
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
    return el('header', { class: `top ${options.back ? 'compact' : ''}` },
      options.back ? el('button', { class: 'plain back', 'aria-label': 'Back', onclick: () => go({ name: 'list' }) }, icon('back')) : el('span', { class: 'brand' }, el('span', { text: 's/i' })),
      el('h1', { text }),
      options.back ? null : el('button', { class: 'plain', 'aria-label': 'Computer', title: 'This computer', onclick: () => go({ name: 'computer' }) }, icon('computer')));
  }
  function statusLine() {
    const status = state.status; if (!status) return null;
    const ok = status.state === 'synced' || status.state === 'unpaired';
    return el('p', { class: 'status' }, el('i', { class: ok ? 'ok' : status.state === 'error' ? 'bad' : '' }), `${status.deviceName} · ${labels[status.state] || status.state}`);
  }

  function mediaCard(item, inTiles) {
    const card = el('button', { class: 'card-item media', 'aria-label': item.name, onclick: () => open(item) }, el('span', { class: 'placeholder', text: item.kind === 'video' ? 'Video' : 'Photo' }));
    thumbnail(item).then(url => {
      card.replaceChildren(el('img', { src: url, alt: '', onload: event => event.target.classList.add('loaded') }));
      if (item.kind === 'video') card.append(el('span', { class: 'play' }));
      if (!inTiles) { if (folder(item.path)) card.append(el('span', { class: 'folder-tag', text: folder(item.path) })); card.append(el('span', { class: 'caption', text: item.name })); }
    }).catch(() => { if (!inTiles) card.append(el('span', { class: 'caption', text: item.name })); });
    return card;
  }
  function noteCard(item) {
    return el('button', { class: `card-item note tint-${tint(item.path)}`, onclick: () => open(item) },
      folder(item.path) ? el('span', { class: 'folder-tag', text: folder(item.path) }) : null,
      el('strong', { text: title(item) }), el('p', { text: notePreview(item) || 'Empty note' }), el('span', { class: 'foot', text: when(item.modifiedAt) }));
  }
  function fileCard(item) {
    const preview = previewOf(item);
    const card = el('button', { class: `card-item file ${item.kind === 'audio' ? 'audio' : ''} ${preview === 'pdf' ? 'pdf' : ''}`, onclick: () => open(item) },
      el('span', { class: 'ext', text: item.kind === 'audio' ? 'Audio' : (extOf(item.name).slice(1) || 'file').slice(0, 4).toUpperCase() }),
      el('div', { class: 'text' }, el('strong', { text: item.name }), el('span', { class: 'foot', text: `${size(item.size)} · ${when(item.modifiedAt)}` })));
    if (preview === 'pdf') thumbnail(item).then(url => { card.classList.replace('file', 'media'); card.classList.remove('pdf'); card.replaceChildren(el('img', { src: url, alt: '', onload: event => event.target.classList.add('loaded') }), el('span', { class: 'caption', text: item.name })); }).catch(() => {});
    return card;
  }
  function renderPairing(prefill) {
    const input = el('input', { 'aria-label': 'Pairing code', placeholder: 'Pairing code', autocapitalize: 'characters', autocomplete: 'off', spellcheck: 'false', value: prefill || '' });
    const form = el('form', { onsubmit: event => { event.preventDefault(); void run(() => pair(input.value.trim().toUpperCase())); } },
      el('div', { class: 'card' }, el('h2', { text: 'Pair with this computer' }), el('p', { text: 'On the computer, open Preferences → Phone access and choose “Pair a phone”. Scanning its QR code with the camera fills this in; otherwise type the eight-character code.' }), input),
      el('button', { class: 'primary wide', type: 'submit', disabled: state.busy, text: state.busy ? 'Pairing…' : 'Pair' }));
    root.replaceChildren(el('header', { class: 'top' }, el('span', { class: 'brand' }, el('span', { text: 's/i' })), el('h1', { text: 'Phone access' })), form, el('p', { class: 'status', text: 'Nothing is stored on this phone except the pairing.' }));
  }

  function renderList() {
    const items = state.items || [];
    const query = state.query.toLowerCase();
    const counts = { all: items.length };
    for (const item of items) counts[item.kind] = (counts[item.kind] || 0) + 1;
    const visible = items.filter(item => (state.filter === 'all' || item.kind === state.filter) && `${item.path} ${item.preview || ''}`.toLowerCase().includes(query));
    const search = el('input', { type: 'search', 'aria-label': 'Search the collection', placeholder: 'Search', value: state.query, oninput: event => { state.query = event.target.value; renderList(); } });
    const chips = el('div', { class: 'chips', role: 'tablist' }, ['all', 'note', 'image', 'video', 'audio', 'file'].filter(kind => kind === 'all' || kind === 'note' || counts[kind]).map(kind =>
      el('button', { class: `chip ${state.filter === kind ? 'active' : ''}`, role: 'tab', 'aria-selected': state.filter === kind ? 'true' : 'false', onclick: () => { state.filter = kind; renderList(); } }, kindNames[kind], el('span', { text: String(counts[kind] || 0) }))));
    const tiles = state.filter === 'image' || state.filter === 'video';
    let content;
    if (state.items === null) content = el('div', { class: 'grid' }, el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }), el('div', { class: 'skeleton' }));
    else if (!visible.length) content = el('div', { class: 'empty' }, el('strong', { text: items.length ? 'No matches' : 'Nothing here yet' }), items.length ? 'Try another word.' : 'Tap + to write a note or add a photo. Everything lands on the computer.');
    else if (tiles) content = el('div', { class: 'tiles' }, visible.map(item => mediaCard(item, true)));
    else content = el('div', { class: 'grid' }, visible.map(item => item.kind === 'note' ? noteCard(item) : item.kind === 'image' || item.kind === 'video' ? mediaCard(item, false) : fileCard(item)));
    const label = el('div', { class: 'section-label' }, el('span', { text: state.query ? 'Results' : kindNames[state.filter] }), el('span', { text: String(visible.length) }));
    const upload = el('input', { type: 'file', class: 'hidden', 'aria-label': 'Choose a file to add', onchange: event => { const file = event.target.files[0]; if (file) void run(async () => { await api('POST', `/v1/upload?name=${encodeURIComponent(file.name)}`, { body: file, contentType: file.type || 'application/octet-stream' }); await load(); toast(`${file.name} added.`); }); event.target.value = ''; } });
    const openSheet = () => {
      const shade = el('div', { class: 'sheet-shade', onclick: event => { if (event.target === shade) shade.remove(); } },
        el('div', { class: 'sheet', role: 'dialog', 'aria-label': 'Create' },
          el('button', { onclick: () => { shade.remove(); go({ name: 'note', item: null }); } }, icon('note'), 'New note'),
          el('button', { onclick: () => { shade.remove(); upload.click(); } }, icon('photo'), 'Add photo or file'),
          el('button', { class: 'cancel', onclick: () => shade.remove(), text: 'Cancel' })));
      document.body.append(shade);
    };
    root.replaceChildren(
      topBar(state.status ? state.status.collection : 'Collection'), statusLine(),
      el('div', { class: 'toolbar' }, el('div', { class: 'search' }, search), el('button', { class: 'plain', 'aria-label': 'Refresh', title: 'Refresh', disabled: state.busy, onclick: () => void run(load) }, icon('refresh'))),
      chips, label, content, upload,
      el('button', { class: 'fab', 'aria-label': 'Create', disabled: state.busy, onclick: openSheet }, icon('plus')));
  }
  function open(item) { go({ name: item.kind === 'note' ? 'note' : 'item', item }); }

  function renderItem() {
    const item = state.view.item; const preview = previewOf(item);
    const problem = el('p', { class: 'save-state error hidden', text: 'This phone cannot show this file. Download it and open it in another app.' });
    const fail = message => { if (message) problem.textContent = message; problem.classList.remove('hidden'); };
    let body;
    if (preview === 'image' || preview === 'video') {
      const media = preview === 'image' ? el('img', { alt: item.name }) : el('video', { controls: true, playsinline: true, autoplay: true, 'aria-label': item.name });
      body = el('div', { class: 'viewer loading' }, media);
      const ready = () => body.classList.remove('loading');
      media.addEventListener(preview === 'image' ? 'load' : 'loadeddata', ready, { once: true });
      if (preview === 'image') {
        const useOS = () => osPreview(item).then(url => { media.src = url; }).catch(error => { ready(); fail(error.message); });
        if (imageExt.includes(extOf(item.name))) { streamLink(item).then(url => { media.src = url; }).catch(error => { ready(); fail(error.message); }); media.addEventListener('error', () => { media.removeAttribute('src'); void useOS(); }, { once: true }); }
        else void useOS();
        media.classList.add('preview-image');
      } else {
        streamLink(item).then(url => { media.src = url; }).catch(error => { ready(); fail(error.message); });
        media.addEventListener('error', () => { ready(); fail(); });
      }
    } else if (preview === 'audio') {
      const audio = el('audio', { class: 'preview-audio', controls: true, autoplay: true, 'aria-label': item.name });
      body = el('div', {}, el('div', { class: 'audio-art', text: item.name }), audio);
      streamLink(item).then(url => { audio.src = url; }).catch(error => fail(error.message));
      audio.addEventListener('error', () => fail());
    } else if (preview === 'pdf') {
      body = el('iframe', { class: 'preview-pdf', title: item.name });
      streamLink(item).then(url => { body.src = url; }).catch(error => fail(error.message));
    } else if (preview === 'text') {
      body = el('pre', { class: 'preview-text', 'aria-label': 'File text', text: 'Loading…' });
      api('GET', `/v1/text?path=${encodeURIComponent(item.path)}`).then(result => { body.textContent = result.text; }).catch(error => { body.textContent = ''; fail(error.message); });
    } else body = el('div', { class: 'card center' }, icon('file'), el('p', { text: 'No preview for this type on the phone. Download it to open it in another app.' }));
    root.replaceChildren(topBar(item.name, { back: true }), body, problem,
      el('p', { class: 'meta', text: `${size(item.size)} · ${when(item.modifiedAt)}${folder(item.path) ? ` · ${folder(item.path)}` : ''}` }),
      el('div', { class: 'actions' },
        canShareFiles() ? el('button', { class: 'primary', disabled: state.busy, onclick: () => void run(() => share(item)) }, icon('share'), 'Share') : null,
        el('button', { class: canShareFiles() ? '' : 'primary', disabled: state.busy, onclick: () => void run(() => download(item)) }, icon('download'), canShareFiles() ? 'Download' : 'Download original')));
  }

  function renderNote() {
    const item = state.view.item;
    const textarea = el('textarea', { 'aria-label': 'Note text', placeholder: 'Write here.', spellcheck: 'true', oninput: () => grow() });
    // The editor grows with the text so the page scrolls, never a box inside it.
    const grow = () => { textarea.style.height = 'auto'; textarea.style.height = `${Math.max(textarea.scrollHeight + 24, window.innerHeight - 200)}px`; };
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
      el('div', { class: 'actions' }, saveButton, item ? el('button', { class: 'icon', 'aria-label': 'Download note', onclick: () => void run(() => download(item)) }, icon('download')) : null));
    grow();
    if (item) api('GET', `/v1/note?path=${encodeURIComponent(item.path)}`).then(note => { document_ = note; textarea.value = note.text; grow(); }).catch(error => { saveState.className = 'save-state error'; saveState.textContent = error.message; });
    else textarea.focus();
  }

  function renderComputer() {
    const status = state.status || {};
    root.replaceChildren(topBar('This computer', { back: true }),
      el('div', { class: 'card' },
        el('h2', { text: status.deviceName || 'Computer' }),
        el('dl', {}, el('dt', { text: 'Collection' }), el('dd', { text: status.collection || '' }), el('dt', { text: 'Sync' }), el('dd', { text: labels[status.state] || status.state || '' }), el('dt', { text: 'Phones' }), el('dd', { text: String(status.phones || 1) }), el('dt', { text: 'This phone' }), el('dd', { text: status.phone ? status.phone.name : 'Phone' }))),
      el('div', { class: 'card' },
        el('p', { text: 'Nothing from the collection is stored on this phone. Photos and files are fetched from the computer each time; notes are saved straight to it. Add this page to the Home Screen to open it like an app.' })),
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
