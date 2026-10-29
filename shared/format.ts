/** A byte count for people: whole kilobytes, megabytes to one decimal under ten, gigabytes above a thousand megabytes. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(2)} GB`;
}

/** A computer's name as people know it: the host name without the ".local" style suffix a Mac or a router appends. */
export function tidyName(name: string): string {
  return name.trim().replace(/\.(local|lan|home|localdomain|internal)$/i, '');
}
