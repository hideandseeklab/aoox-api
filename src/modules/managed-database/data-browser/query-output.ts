/**
 * Parsers for what the engines' CLIs print (run in a one-off container, see
 * DatabaseQueryService). Both keep NULL distinguishable from empty string.
 */
export interface ResultSet {
  columns: string[];
  rows: (string | null)[][];
}

/** What psql prints for NULL (`-P null=...`); CSV alone cannot tell NULL from ''. */
export const PSQL_NULL = '\\N';

/**
 * `psql --csv -P null='\N'`: RFC 4180 — fields with commas/quotes/newlines
 * are quoted, quotes doubled. An *unquoted* `\N` is NULL (a real string
 * `\N` is indistinguishable — accepted, like mysql's bare `NULL`).
 */
export function parsePsqlCsv(text: string): ResultSet {
  const rows: (string | null)[][] = [];
  let row: (string | null)[] = [];
  let field = '';
  let quoted = false; // current field had quotes -> never NULL
  let inQuotes = false;
  let i = 0;
  const push = () => {
    row.push(!quoted && field === PSQL_NULL ? null : field);
    field = '';
    quoted = false;
  };
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      quoted = true;
    } else if (c === ',') push();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      push();
      rows.push(row);
      row = [];
    } else field += c;
    i++;
  }
  if (field !== '' || quoted || row.length > 0) {
    push();
    rows.push(row);
  }
  const [header = [], ...data] = rows;
  return {
    columns: header.map((h) => h ?? ''),
    rows: data,
  };
}

/**
 * `mysql --batch`: tab-separated, header first; tabs, newlines, backslashes
 * and NUL inside values are escaped as `\t` `\n` `\\` `\0`; NULL is the bare
 * word `NULL` (indistinguishable from the string 'NULL' — accepted).
 */
export function parseMysqlBatch(text: string): ResultSet {
  const lines = text.replace(/\r?\n$/, '').split('\n');
  if (lines.length === 0 || lines[0] === '') return { columns: [], rows: [] };
  const unescape = (v: string) =>
    v.replace(/\\(.)/g, (_, ch: string) =>
      ch === 't' ? '\t' : ch === 'n' ? '\n' : ch === '0' ? '\0' : ch,
    );
  const split = (line: string): (string | null)[] =>
    line.split('\t').map((v) => (v === 'NULL' ? null : unescape(v)));
  const [header, ...data] = lines;
  return {
    columns: split(header).map((h) => h ?? ''),
    rows: data.map(split),
  };
}
