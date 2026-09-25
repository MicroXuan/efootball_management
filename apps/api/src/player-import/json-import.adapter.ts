import type { ImportAdapter, ParsedImportRow, RawImportRow } from './import-adapter.js';

function isRawImportRow(value: unknown): value is RawImportRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class JsonImportAdapter implements ImportAdapter {
  parse(content: string): ParsedImportRow[] {
    const parsed: unknown = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      throw new TypeError('JSON import must contain a top-level array');
    }

    return parsed.map((value, index) => {
      if (!isRawImportRow(value)) {
        throw new TypeError(`JSON import row ${index + 1} must be an object`);
      }

      return { rowNumber: index + 1, value };
    });
  }
}
