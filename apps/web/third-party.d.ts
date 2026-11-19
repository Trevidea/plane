declare module "mammoth" {
  export type MammothResult = {
    value: string;
    messages?: unknown[];
  };

  export type ConvertToHtmlOptions = {
    arrayBuffer: ArrayBuffer;
  };

  export function convertToHtml(options: ConvertToHtmlOptions): Promise<MammothResult>;

  const defaultExport: {
    convertToHtml: typeof convertToHtml;
  };

  export default defaultExport;
}

declare module "xlsx" {
  export type WorkBook = {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };

  export type SheetToJsonOptions = {
    header?: number | string[];
    defval?: unknown;
    raw?: boolean;
  };

  export type ReadOptions = {
    type: "array";
    sheetRows?: number;
  };

  export function read(data: ArrayBuffer, options: ReadOptions): WorkBook;

  export const utils: {
    book_new(): WorkBook;
    book_append_sheet(book: WorkBook, sheet: unknown, name: string): void;
    aoa_to_sheet(rows: string[][]): unknown;
    sheet_to_html(sheet: unknown): string;
    sheet_to_json<T = Record<string, unknown>>(sheet: unknown, options?: SheetToJsonOptions): T[];
  };

  export function writeFile(book: WorkBook, filename: string): void;

  const defaultExport: {
    read: typeof read;
    utils: typeof utils;
    writeFile: typeof writeFile;
  };

  export default defaultExport;
}
