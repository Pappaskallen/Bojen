/**
 * The Excel side of the customer import: the template as an .xlsx file, and a filled-in file
 * back to cells for `parseCustomerSheet`.
 */
import { crm } from "@bojen/core/i18n/sv";
import { importTemplate, type Cell } from "@bojen/core/onboarding";
import readXlsxFile from "read-excel-file/node";
import writeXlsxFile from "write-excel-file/node";

const texts = crm.customerImport;

/** The template, with a bold header that stays in view. */
export async function templateXlsx(): Promise<Buffer> {
  const { data, help } = importTemplate();
  const [header = [], ...examples] = data;
  const bold = (value: string) => ({ value, fontWeight: "bold" as const });
  return writeXlsxFile([
    {
      sheet: texts.sheet,
      data: [header.map((title) => bold(String(title))), ...examples],
      columns: header.map((title) => ({ width: Math.max(12, String(title).length + 4) })),
      stickyRowsCount: 1,
    },
    {
      sheet: texts.helpSheet,
      data: help.map((row, i) =>
        i === 2 ? row.map(bold) : row.map((value) => ({ value, wrap: true })),
      ),
      columns: [{ width: 22 }, { width: 8 }, { width: 70 }, { width: 40 }],
    },
  ]).toBuffer();
}

/** The customer sheet's cells: the sheet named as in the template, or else the first. */
export async function readImportFile(input: Buffer | string): Promise<Cell[][]> {
  const sheets = await readXlsxFile(input);
  const sheet = sheets.find((s) => s.sheet === texts.sheet) ?? sheets[0];
  return (sheet?.data ?? []) as Cell[][];
}
