export type RawImportRow = Record<string, unknown>;

export type ParsedImportRow = {
  rowNumber: number;
  value: RawImportRow;
};

export interface ImportAdapter {
  parse(content: string): ParsedImportRow[];
}
