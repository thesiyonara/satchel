import { useEffect, useRef, useState } from 'react';
import { Check, Eye, FileText, History, LoaderCircle, X, ExternalLink, AlertTriangle, Pencil } from 'lucide-react';
import type { NoteDocument, NoteVersion } from '../shared/types';
import { clearDraft, draftKey, persistDraft } from './drafts';
import { registerEditor } from './save-before-update';
import { Markdown } from './Markdown';

function formatTime(time: number) { return new Date(time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function formatSize(bytes: number) { return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`; }

/**
 * The note editor. In the dashboard it is a pane beside the collection (mode "pane"), so the grid stays in view and
 * switching notes is one click; in the small Quick drop window it covers the window (mode "overlay").
 */
export function NoteEditor({ document: initial, close, notify, runId, root, mode = 'overlay' }: { document: NoteDocument; close: () => void; notify: (message: string) => void; runId: string; root: string; mode?: 'pane' | 'overlay' }) {
  const journal = useRef(draftKey());
  const [text, setText] = useState(initial.text);
  const [document, setDocument] = useState(initial);
  const [state, setState] = useState<'saved' | 'saving' | 'error' | 'changed'>('saved');
  const [error, setError] = useState('');
  const [remoteChanged, setRemoteChanged] = useState(false);
  const [preview, setPreview] = useState(false);
  const [history, setHistory] = useState(false);
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [selected, setSelected] = useState<NoteVersion | null>(null);
  const [versionText, setVersionText] = useState<string | null>(null);
  const current = useRef(initial); const buffer = useRef(initial.text); const saving = useRef<Promise<void> | null>(null);
  const dirty = useRef(false); const active = useRef(true); const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function journalDraft() {
    try { persistDraft(journal.current, { runId, root, path: current.current.path, text: buffer.current, revision: current.current.revision, savedAt: Date.now() }); }
    catch { notify('Draft recovery storage is full. Keep this note open until “Saved” appears.'); }
  }
  const isMarkdown = /\.md$/i.test(document.path);
  const folder = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/')) : '';
  const title = document.path.split('/').at(-1)?.replace(/\.(md|txt)$/i, '') || '';
  async function loadHistory() {
    try { const list = await window.syncit.noteHistory(current.current.path); if (active.current) setVersions(list); }
    catch (error) { if (active.current) { setVersions([]); notify(String(error)); } }
  }
  async function save() {
    clearTimeout(timer.current);
    if (saving.current) { await saving.current; if (dirty.current) return save(); return; }
    if (!dirty.current) return;
    const value = buffer.current;
    if (active.current) setState('saving');
    let failed = false;
    saving.current = (async () => {
      try {
        const result = await window.syncit.saveNote(current.current.path, value, current.current.revision);
        current.current = result; dirty.current = buffer.current !== value;
        if (!dirty.current) clearDraft(journal.current);
        if (active.current) { setDocument(result); setState(dirty.current ? 'changed' : 'saved'); setRemoteChanged(false); }
        if (result.conflict) notify('Both versions kept. Your edits were saved as a conflict copy.');
        if (history && active.current) void loadHistory();
      } catch (error) { failed = true; if (active.current) { setState('error'); setError(String(error)); } }
      finally { saving.current = null; }
    })();
    await saving.current;
    if (failed) throw new Error('Save failed');
    if (dirty.current) await save();
  }
  useEffect(() => {
    active.current = true;
    const unregisterEditor = registerEditor(save);
    const unsubscribe = window.syncit.onLibrary(() => {
      void window.syncit.readNote(current.current.path).then(remote => {
        if (!active.current || remote.revision === current.current.revision) return;
        if (dirty.current || saving.current) { setRemoteChanged(true); return; }
        current.current = remote; buffer.current = remote.text; setText(remote.text); setDocument(remote);
        if (history) void loadHistory();
      }).catch(() => { if (active.current) setRemoteChanged(true); });
    });
    // Leaving the editor with unsaved text (another note opened, the view closed) still saves it; the draft journal covers a crash in between.
    return () => { active.current = false; clearTimeout(timer.current); clearTimeout(draftTimer.current); if (dirty.current) { journalDraft(); void save().catch(() => {}); } unsubscribe(); unregisterEditor(); };
  }, []);
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => { if (dirty.current || saving.current) { event.preventDefault(); void save().catch(() => {}); } };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, []);
  useEffect(() => { if (history && versions === null) void loadHistory(); }, [history]);
  function edit(value: string) {
    buffer.current = value; dirty.current = true; setText(value); setState('changed');
    // The draft journal is for crash recovery; writing it a few times a second is enough and keeps large notes responsive.
    clearTimeout(draftTimer.current); draftTimer.current = setTimeout(journalDraft, 250);
    clearTimeout(timer.current); timer.current = setTimeout(() => { void save().catch(() => {}); }, 600);
  }
  async function showVersion(version: NoteVersion) {
    setSelected(version); setVersionText(null);
    try { setVersionText(await window.syncit.readNoteVersion(version.id)); } catch (error) { notify(String(error)); setSelected(null); }
  }
  function restore() {
    if (!selected || versionText === null) return;
    edit(versionText); setPreview(false); setSelected(null);
    notify('Version restored. The text it replaced is kept in History.');
  }
  async function finish() { try { await save(); close(); } catch { /* Keep the buffer visible until it can be saved. */ } }
  const editor = <section className={`note-editor ${mode === 'pane' ? 'note-pane' : ''} ${history ? 'with-history' : ''}`} role={mode === 'pane' ? 'complementary' : 'dialog'} aria-modal={mode === 'pane' ? undefined : true} aria-label="Note" onKeyDown={event => { if (event.key === 'Escape') void finish(); if ((event.metaKey || event.ctrlKey) && event.key === 's') { event.preventDefault(); void save().catch(() => {}); } }}>
    <header><span className="note-label"><FileText size={17} />{folder ? <span className="note-folder">{folder}</span> : isMarkdown ? 'Markdown' : 'Plain text'}</span><div className="row">
      {isMarkdown && <button className={`icon-button ${preview ? 'active' : ''}`} aria-label={preview ? 'Edit note' : 'Preview Markdown'} aria-pressed={preview} title={preview ? 'Edit' : 'Preview Markdown'} onClick={() => setPreview(value => !value)}>{preview ? <Pencil size={17} /> : <Eye size={17} />}</button>}
      <button className={`icon-button ${history ? 'active' : ''}`} aria-label="Note history" aria-pressed={history} title="History" onClick={() => setHistory(value => !value)}><History size={17} /></button>
      <button className="icon-button" title="Open in text editor" aria-label="Open in text editor" onClick={() => { void save().then(() => window.syncit.open(current.current.path)).catch(() => {}); }}><ExternalLink size={17} /></button>
      <button className="icon-button" aria-label="Close note" title="Close · Esc" onClick={() => void finish()}><X size={20} /></button></div></header>
    <h2>{title}</h2>
    {remoteChanged && <div className="inline-warning"><AlertTriangle size={16} /> This note changed on disk. Saving keeps both versions.</div>}
    <div className="note-body">
      {preview ? <div className="markdown" aria-label="Markdown preview"><Markdown source={text} omitTitle={title} /></div> : <textarea autoFocus value={text} onChange={event => edit(event.target.value)} placeholder="Write here. Changes save automatically." aria-label="Note text" spellCheck />}
      {history && <aside className="note-history" aria-label="Note history">
        <div className="history-head"><strong>History</strong><span>{versions ? `${versions.length} ${versions.length === 1 ? 'version' : 'versions'}` : 'Loading…'}</span></div>
        {versions && versions.length === 0 && <p>No previous versions yet. A copy is kept on this computer each time this note is saved with changes, and received changes are archived for 30 days.</p>}
        {versions && versions.length > 0 && <ul>{versions.map(version => <li key={version.id}><button className={selected?.id === version.id ? 'selected' : ''} onClick={() => void showVersion(version)}><span>{formatTime(version.time)}</span><small>{version.source === 'local' ? 'This computer' : 'Received change'} · {formatSize(version.size)}</small></button></li>)}</ul>}
        {selected && <div className="history-preview"><pre>{versionText === null ? 'Loading…' : versionText || '(empty note)'}</pre><div className="row"><button className="primary" disabled={versionText === null} onClick={restore}>Restore this version</button><button onClick={() => setSelected(null)}>Close</button></div></div>}
      </aside>}
    </div>
    <footer><span className={state === 'error' ? 'error-text' : ''}>{state === 'saved' ? <><Check size={14} /> Saved on this computer</> : state === 'saving' ? <><LoaderCircle className="spin" size={14} /> Saving…</> : state === 'error' ? error : 'Unsaved changes'}</span><span>{text.length.toLocaleString()} characters</span>{state === 'error' && <button onClick={() => void save().catch(() => {})}>Retry save</button>}</footer>
  </section>;
  if (mode === 'pane') return editor;
  return <div className="modal-shade" onMouseDown={event => { if (event.target === event.currentTarget) void finish(); }}>{editor}</div>;
}
