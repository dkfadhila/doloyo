const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
/** URL of a file in public/ under the deployment base ("/" or e.g. "/motion-doll-studio/"). */
export const publicUrl = (p: string) => base.replace(/\/$/, '') + '/' + p.replace(/^\//, '');
