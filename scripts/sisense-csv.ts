export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string | null>[];
}

export function parseCsv(input: string): ParsedCsv {
  const rows: (string | null)[][] = [];
  let field = "";
  let row: (string | null)[] = [];
  let inQuotes = false;
  let quotedField = false;

  const text = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      quotedField = true;
    } else if (char === ",") {
      row.push(cleanCell(field, quotedField));
      quotedField = false;
      field = "";
    } else if (char === "\n") {
      row.push(cleanCell(field.replace(/\r$/, ""), quotedField));
      quotedField = false;
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length || quotedField) {
    row.push(cleanCell(field.replace(/\r$/, ""), quotedField));
    rows.push(row);
  }

  const headerRow = rows.shift();
  if (!headerRow) return { headers: [], rows: [] };

  const headers = uniqueHeaders(headerRow.map((value) => value ?? ""));
  return {
    headers,
    rows: rows
      .filter((values) => values.some((value) => value !== null))
      .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]))),
  };
}

function uniqueHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header.trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
}

function cleanCell(value: string, quoted: boolean): string | null {
  const trimmed = value.trim();
  // Sisense exports SQL NULL as an unquoted blank and an empty string as "".
  return trimmed || (quoted ? "" : null);
}
