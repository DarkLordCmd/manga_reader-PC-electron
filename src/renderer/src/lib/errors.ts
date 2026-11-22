/**
 * User-facing text for a failed IPC call.
 *
 * Electron serialises a main-process exception as
 * `Error invoking remote method 'channel': Error: <real message>`. Showing that
 * verbatim in the UI (Popular/Library modals/reader alerts) leaked the channel
 * name and an English wrapper in front of the actual Russian message — and when
 * the inner message was empty the user saw a bare, meaningless prefix.
 */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const m = raw.match(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?([\s\S]*)$/);
  const inner = (m ? m[1] : raw).trim();
  return inner || 'Неизвестная ошибка';
}
