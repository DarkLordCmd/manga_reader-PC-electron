export function needsDeletedAtColumn(userVersion: number, columns: string[]): boolean {
  return userVersion < 2 && !columns.includes('deleted_at');
}

export function needsFavoritedAtColumn(userVersion: number, columns: string[]): boolean {
  return userVersion < 3 && !columns.includes('favorited_at');
}

export function needsKindColumn(userVersion: number, columns: string[]): boolean {
  return userVersion < 5 && !columns.includes('kind');
}
