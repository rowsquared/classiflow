/**
 * CSV writing for exports. Every cell is quoted and inner quotes doubled, so
 * commas, quotes and newlines survive in any column (RFC 4180).
 *
 * Spreadsheet formula injection: a free-text cell that starts with = + - @ or a
 * tab/CR is run as a formula by Excel/LibreOffice/Sheets. Such cells get a
 * leading apostrophe when `neutralizeFormulas` is on. Only columns marked as
 * text are touched: ids, classification codes, statuses and dates are never
 * altered, so codes like "-99" or "0110" keep their exact value.
 */

const FORMULA_START = /^[=+\-@\t\r]/

export function neutralizeFormula(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value
}

export function csvCell(value: string | number | boolean | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replace(/"/g, '""')}"`
}

export type CsvColumn = { header: string; text?: boolean }

export function toCsv(
  columns: CsvColumn[],
  rows: Array<Array<string | number | boolean | null | undefined>>,
  opts: { neutralizeFormulas: boolean }
): string {
  const lines = [columns.map(c => csvCell(c.header)).join(',')]
  for (const row of rows) {
    lines.push(row.map((value, i) => {
      if (opts.neutralizeFormulas && columns[i]?.text && typeof value === 'string') {
        return csvCell(neutralizeFormula(value))
      }
      return csvCell(value)
    }).join(','))
  }
  return lines.join('\n')
}
