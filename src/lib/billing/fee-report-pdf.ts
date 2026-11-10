/** Local, dependency-free PDF export of an already-sanitized owner report. */
const LINE_WIDTH = 94;
const LINES_PER_PAGE = 58;

function readableJson(value: unknown, depth = 0): string[] {
  const indent = '  '.repeat(depth);
  const compact = JSON.stringify(value);
  // Keep small rate/money objects on one line, while retaining every field.
  if (compact.length <= 260 || !value || typeof value !== 'object') return [indent + compact];
  const array = Array.isArray(value);
  const rows = [indent + (array ? '[' : '{')];
  const entries = Object.entries(value);
  entries.forEach(([key, child], index) => {
    const childRows = readableJson(child, depth + 1);
    if (!array) childRows[0] = `${'  '.repeat(depth + 1)}${JSON.stringify(key)}: ${childRows[0].trimStart()}`;
    childRows[childRows.length - 1] += index < entries.length - 1 ? ',' : '';
    rows.push(...childRows);
  });
  rows.push(indent + (array ? ']' : '}'));
  return rows;
}

function wrapLine(line: string): string[] {
  const result: string[] = [];
  while (line.length > LINE_WIDTH) {
    let quoted = false, escaped = false, boundary = 0;
    for (let index = 0; index < LINE_WIDTH; index++) {
      const character = line[index];
      if (escaped) { escaped = false; continue; }
      if (character === '\\' && quoted) { escaped = true; continue; }
      if (character === '"') quoted = !quoted;
      if (!quoted && character === ',') boundary = index + 1;
    }
    const length = boundary || LINE_WIDTH;
    result.push(line.slice(0, length)); line = line.slice(length);
  }
  result.push(line); return result;
}

export function feeReportPdfLines(fullText: string): string[] {
  const report: unknown = JSON.parse(fullText);
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
    !('schedule' in report) || !report.schedule || typeof report.schedule !== 'object')
    throw new Error('Invalid sanitized fee report');
  // Standard PDF Courier supports ASCII. JSON escapes preserve every Unicode
  // code unit instead of substituting or silently dropping unsupported glyphs.
  const json = readableJson(report).join('\n').replace(/[\u007f-\uffff]/g,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
  const introduction = [
    'Complete sanitized account fee schedule',
    '',
    'This is an account-rate snapshot, not a guaranteed future fee ceiling.',
    'A listed rate does not establish that the fee or payment method applies.',
    'Allowed methods, actual acquirer, card issuer, recurring status, orchestration,',
    'fraud/3DS, tax, high-risk, affiliate and payout applicability are not provided',
    'by this fee schedule. Disputes, alerts and representment are conditional events.',
    'Null means unavailable/not provided, never zero. Zero rates remain explicit.',
    'Unknown settlement currency does not establish that foreign exchange is absent.',
    'Effective rates, regions, expiry, source, default/reset reference rates, markups,',
    'payment methods and payouts are retained below without truncation.',
    'Percentages use the reported percentageUnit. Fixed amounts retain their exact',
    'currency, amount and decimal metadata. No credentials are included.',
    '',
    'FULL SANITIZED REPORT',
    '',
  ];
  return [...introduction, ...json.split('\n')].flatMap(wrapLine);
}

function pdfString(text: string) { return text.replace(/([\\()])/g, '\\$1'); }

export function createFeeReportPdf(fullText: string): Uint8Array {
  const lines = feeReportPdfLines(fullText);
  const pages: string[][] = [];
  for (let offset = 0; offset < lines.length; offset += LINES_PER_PAGE) pages.push(lines.slice(offset, offset + LINES_PER_PAGE));
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
  ];
  pages.forEach((page, index) => {
    const stream = [
      '0.12 0.20 0.36 rg',
      'BT /F2 16 Tf 42 799 Td (Start AI Creator) Tj ET',
      'BT /F2 10 Tf 42 779 Td (Whop account fee report) Tj ET',
      '0.78 0.82 0.88 RG 42 769 m 553 769 l S',
      '0.12 0.14 0.18 rg',
      'BT /F1 9 Tf 11.5 TL 42 748 Td',
      ...page.map((line, row) => `${row ? 'T* ' : ''}(${pdfString(line)}) Tj`),
      'ET',
      '0.35 0.39 0.45 rg',
      `BT /F1 9 Tf 42 38 Td (Complete sanitized snapshot - page ${index + 1} of ${pages.length}) Tj ET`,
    ].join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export function downloadOwnerFeePdf(fullText: string) {
  const bytes = createFeeReportPdf(fullText);
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = 'start-ai-whop-fees.pdf';
  try { document.body.appendChild(anchor); anchor.click(); }
  finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
