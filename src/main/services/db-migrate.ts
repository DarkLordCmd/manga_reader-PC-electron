export function needsDeletedAtColumn(userVersion: number, columns: string[]): boolean {
  return userVersion < 2 && !columns.includes('deleted_at')
}
