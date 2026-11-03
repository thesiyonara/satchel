export function closeApp(application: { close(): Promise<void>; process(): { kill(signal?: string): void } }, seconds?: number): Promise<void>;
