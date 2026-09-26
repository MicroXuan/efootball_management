import { parse } from 'csv-parse/sync';
import type { ImportAdapter, ParsedImportRow, RawImportRow } from './import-adapter.js';

type CsvRecordWithInfo = {
  record: RawImportRow;
  info: { lines: number };
};

export class CsvImportAdapter implements ImportAdapter {
  parse(content: string): ParsedImportRow[] {
    const rows = parse(content, {
      bom: true,
      columns: true,
      info: true,
      skip_empty_lines: true,
      trim: true
    }) as CsvRecordWithInfo[];

    return rows.map(({ record, info }) => ({
      rowNumber: info.lines,
      value: record
    }));
  }
}
