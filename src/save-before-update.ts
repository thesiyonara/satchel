const editors = new Set<() => Promise<void>>();
export function registerEditor(save: () => Promise<void>) { editors.add(save); return () => { editors.delete(save); }; }
export async function saveBeforeUpdate() { await Promise.all([...editors].map(save => save())); }
