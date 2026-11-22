/**
 * Decides when a failed `library.db` open is a corruption story (and the file
 * should be rotated aside and recreated) versus an ordinary failure that must
 * be surfaced.
 *
 * The first version rotated the database on *any* error. A transient problem
 * (the file briefly locked by another instance, EACCES, ENOSPC, a WAL hiccup)
 * therefore renamed a perfectly healthy library.db to .corrupt-<ts> and opened
 * an empty database: to the user the whole library and history "vanished".
 * Only genuine corruption codes justify throwing the data away.
 */
export function isCorruptionError(error: unknown): boolean {
  const code = String((error as { code?: unknown } | null | undefined)?.code ?? '');
  return code === 'SQLITE_CORRUPT' || code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT_');
}

/** True when the database file must be moved aside and recreated. */
export function shouldRotateDatabase(error: unknown): boolean {
  return isCorruptionError(error);
}
