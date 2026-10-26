const prefix = 'syncit-draft-v1:';
export interface Draft { runId: string; root: string; path: string; text: string; revision: string; savedAt: number }
export const draftKey = () => prefix + crypto.randomUUID();
export function persistDraft(key: string, draft: Draft) { localStorage.setItem(key, JSON.stringify(draft)); }
export function clearDraft(key: string) { localStorage.removeItem(key); }
export async function recoverDrafts(runId: string, root: string): Promise<number> {
  let recovered = 0;
  for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix))) {
    let draft: Draft;
    try { draft = JSON.parse(localStorage.getItem(key) || 'null'); } catch { continue; }
    if (!draft || draft.root !== root || draft.runId === runId || typeof draft.text !== 'string' || draft.text.length > 1024 * 1024 || typeof draft.path !== 'string') continue;
    try {
      const existing = await window.syncit.readNote(draft.path).catch(() => null);
      if (existing?.text !== draft.text) { await window.syncit.createNote(draft.text); recovered++; }
      clearDraft(key); // Only discard the journal after a confirmed, durable save.
    } catch { /* Keep the recovery journal if the folder or disk is unavailable. */ }
  }
  return recovered;
}
