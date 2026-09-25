import { canonicalizePesdataParams, signPesdataRequest } from './pesdata-signer.js';

describe('PESDATA request signing', () => {
  it('sorts keys, encodes values, and omits empty values', () => {
    expect(
      canonicalizePesdataParams({
        start: 0,
        order: 'DESC',
        empty: '',
        missing: null,
        nothing: undefined,
        tags: [],
        query: "A B!()'*",
        filters: { position: 'CB' }
      })
    ).toBe(
      "filters=%7B%22position%22%3A%22CB%22%7D&order=DESC&query=A%20B%21%28%29'%2A&start=0"
    );
  });

  it('matches the pinned authorized protocol fixture', () => {
    expect(
      signPesdataRequest(
        { start: 0, limit: 2, order: 'DESC' },
        1_798_000_000,
        'fixednonce',
        'authorized-test-seed'
      )
    ).toBe('2f915a70a1aaedf991b51f3ca477ccd9');
  });
});
