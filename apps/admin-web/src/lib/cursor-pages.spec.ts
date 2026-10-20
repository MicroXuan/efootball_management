import { collectCursorPages } from './cursor-pages';

it('collects every cursor page in order', async () => {
  const fetch = vi.fn(async (cursor?: string) => cursor
    ? { items: ['later'], nextCursor: null }
    : { items: ['first'], nextCursor: 'next' });
  await expect(collectCursorPages(fetch)).resolves.toEqual(['first', 'later']);
  expect(fetch).toHaveBeenCalledWith('next');
});
