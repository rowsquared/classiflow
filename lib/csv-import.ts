/** Files from Excel may use a semicolon. Inspect the first non-empty record,
 * ignoring delimiters and line breaks inside quoted headers. */
export function csvDelimiter(csv: string): ',' | ';' {
  let quoted = false
  let commas = 0
  let semicolons = 0
  for (const char of csv.replace(/^\uFEFF?[\r\n]*/, '')) {
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === '\r' || char === '\n') break
    if (char === ',') commas++
    if (char === ';') semicolons++
  }
  return semicolons > commas ? ';' : ','
}

type DecodedCsv = { ok: true; text: string } | { ok: false; error: string }

export function decodeCsv(bytes: ArrayBuffer): DecodedCsv {
  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false, error: 'This file is not valid UTF-8. Save it as CSV UTF-8 and try again.' }
  }
}
