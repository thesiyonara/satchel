import type { LibraryItem } from '../shared/types';

/** Whether Copy applies: a note's text or an image goes on the clipboard; other files are dragged or opened. */
export const copyable = (item: LibraryItem) => item.kind === 'note' || item.kind === 'image';

/** Puts a note's text or an image on the clipboard. `media` gives the thumbnail URL; the full preview is fetched from it. */
export async function copyItem(item: LibraryItem, media: (item: LibraryItem) => string, notify: (message: string) => void) {
  try {
    if (item.kind === 'note') await navigator.clipboard.writeText(await window.syncit.readText(item.path));
    else if (item.kind === 'image') { const blob = await (await fetch(media(item).replace('/thumbnail', '/preview'))).blob(); await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]); }
    else return;
    notify(`${item.name} copied.`);
  } catch (error) { notify(`Could not copy: ${String(error)}`); }
}
