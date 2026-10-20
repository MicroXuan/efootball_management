export async function collectCursorPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    if (!page.nextCursor) break;
    if (seen.has(page.nextCursor)) throw new Error('Repeated pagination cursor');
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}
