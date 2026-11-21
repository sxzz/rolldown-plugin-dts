/** Converts Windows path separators to `/`, as TypeScript uses them. */
export function normalizePath(file: string): string {
  return file.replaceAll('\\', '/')
}
