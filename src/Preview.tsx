import { useEffect, useState } from 'react';
import { File } from 'lucide-react';
import type { LibraryItem } from '../shared/types';
import { browserRenders, previewKind } from '../shared/media';

export const streamURL = (item: LibraryItem) => `syncit-media://media/stream?path=${encodeURIComponent(item.path)}&v=${item.modifiedAt}`;
export const osPreviewURL = (item: LibraryItem) => `syncit-media://image/preview?path=${encodeURIComponent(item.path)}&v=${item.modifiedAt}`;
export function previewLabel(item: LibraryItem) {
  const kind = previewKind(item.name);
  return kind === 'image' ? 'Image preview' : kind === 'video' || kind === 'audio' ? 'Media player' : kind === 'pdf' ? 'PDF preview' : kind === 'text' ? 'Text preview' : 'File';
}

/** The in-app view of one item: the original for formats the engine decodes, an OS-rendered image for the rest, a player, the PDF viewer, or read-only text. */
export function PreviewBody({ item, onFail }: { item: LibraryItem; onFail: () => void }) {
  const kind = previewKind(item.name);
  const [text, setText] = useState<string | null>(null);
  const [useOS, setUseOS] = useState(!browserRenders(item.name));
  useEffect(() => {
    setText(null); setUseOS(!browserRenders(item.name));
    if (kind === 'text') window.syncit.readText(item.path).then(setText).catch(() => { setText(''); onFail(); });
  }, [item.path]);
  if (kind === 'image') return <img key={`${item.path}:${useOS}`} src={useOS ? osPreviewURL(item) : streamURL(item)} alt={item.name} onError={() => { if (useOS) onFail(); else setUseOS(true); }} />;
  if (kind === 'video') return <video key={item.path} controls autoPlay playsInline src={streamURL(item)} onError={onFail} />;
  if (kind === 'audio') return <audio key={item.path} controls autoPlay src={streamURL(item)} onError={onFail} />;
  if (kind === 'pdf') return <iframe key={item.path} className="pdf-frame" title={item.name} src={streamURL(item)} />;
  if (kind === 'text') return <pre className="text-preview" aria-label="File text">{text === null ? 'Loading…' : text}</pre>;
  return <div className="file-preview-large"><File size={44} strokeWidth={1.2} /><p>No in-app preview for this type. Open it in its default app.</p></div>;
}
