import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { Settings } from '../shared/types';
import { atomicWrite, readJSON } from './files';

export class SettingsStore {
  value!: Settings;
  private writing: Promise<void> = Promise.resolve();
  constructor(private directory: string, private defaultRoot = path.join(os.homedir(), 'Satchel')) {}
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      this.value = await readJSON<Settings>(path.join(this.directory, 'settings.json'));
      if (this.value.version !== 1 || !path.isAbsolute(this.value.root) || typeof this.value.folderId !== 'string') throw new Error('Settings are not compatible. Keep your collection and contact support before resetting the app.');
      this.value.localDiscovery ??= true;
      this.value.syncPaused ??= false;
      this.value.drawerEdge ??= 'right';
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.value = { version: 1, root: this.defaultRoot, folderId: randomUUID(), deviceName: os.hostname(), onboardingDone: false, startAtLogin: false, alwaysOnTop: true, shortcut: 'CommandOrControl+Shift+Space', theme: 'system', drawerEdge: 'right' };
      await fs.mkdir(this.value.root, { recursive: true });
      await this.update({});
    }
  }
  async update(patch: Partial<Settings>) {
    const write = this.writing.then(async () => { const next = { ...this.value, ...patch }; await atomicWrite(path.join(this.directory, 'settings.json'), JSON.stringify(next, null, 2)); this.value = next; });
    this.writing = write.catch(() => {}); await write;
  }
}
export function validateSettingsPatch(input: unknown): Partial<Settings> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid preferences');
  const result: Partial<Settings> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'startAtLogin' || key === 'alwaysOnTop' || key === 'onboardingDone' || key === 'localDiscovery' || key === 'syncPaused' || key === 'panelAutoHide' || key === 'updateChecks' || key === 'updatePreviews' || key === 'phoneAccess') {
      if (typeof value !== 'boolean') throw new Error('Invalid preference');
      result[key] = value;
    } else if (key === 'deviceName' || key === 'shortcut') {
      if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error('Use a name or shortcut between 1 and 100 characters');
      result[key] = value.trim();
    } else if (key === 'panelMode' && ['quick', 'mini'].includes(value as string)) result.panelMode = value as Settings['panelMode'];
    else if (key === 'panelOpacity' && typeof value === 'number' && Number.isFinite(value) && value >= .6 && value <= 1) result.panelOpacity = value;
    else if (key === 'phonePort' && Number.isInteger(value) && (value as number) >= 1024 && (value as number) <= 65535) result.phonePort = value as number;
    else if (key === 'theme' && ['system', 'light', 'dark'].includes(value as string)) result.theme = value as Settings['theme'];
    else if (key === 'drawerEdge' && ['off', 'left', 'right'].includes(value as string)) result.drawerEdge = value as Settings['drawerEdge'];
    else throw new Error('This preference cannot be changed here');
  }
  return result;
}
