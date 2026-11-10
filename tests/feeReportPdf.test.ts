import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFeeReportPdf, downloadOwnerFeePdf, feeReportPdfLines } from '@/lib/billing/fee-report-pdf';

const money = { amount: '0.300000000001', currency: 'usd', decimals: 12, display_decimals: 2 };
const rate = { percentage: 2.7, fixed: money };
const fee = { ...rate, category: 'payments', source: 'custom', ends_at: '2026-12-01T00:00:00Z', region: null,
  regions: { usa: { ...rate, source: 'default', default: rate, reset: { percentage: 3, fixed: null } },
    bra: { percentage: 8, fixed: null, source: 'default', default: rate, reset: rate } }, default: rate, reset: rate };
const report = { source: 'https://api.whop.com/api/v1/accounts/biz_fixture/fees', accountHasParent: false,
  retrievedAt: '2026-11-09T14:41:30.090Z', apiVersionDate: '2026-11-07', percentageUnit: 'percent',
  settlementCurrency: null, settlementCurrencyStatus: 'not_provided_by_account_fees', currentRatesArePermanentCeilings: false,
  schedule: { account_id: 'biz_fixture', card_processing: fee, orchestration: { ...fee, percentage: 0.8 },
    tax_calculation: { ...fee, percentage: 0 }, three_ds: { ...fee, percentage: null },
    markups: { payments: { ...rate, source: 'custom', default: rate }, payouts: { bank: rate } },
    payment_methods: Object.fromEntries(Array.from({ length: 46 }, (_, index) => [`method_${index}`, fee])),
    payouts: { bank: { ...fee, percentage: 0.17, fixed: { ...money, amount: '7.123456789012', currency: 'eur' } } } } };

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('complete local fee report PDF', () => {
  it('preserves the entire report, every region, zero, null, expiry, reference rate and tail', () => {
    const lines = feeReportPdfLines(JSON.stringify(report));
    const start = lines.indexOf('FULL SANITIZED REPORT') + 2;
    expect(JSON.parse(lines.slice(start).join(''))).toEqual(report);
    expect(Math.max(...lines.map(line => line.length))).toBeLessThanOrEqual(94);
    expect(lines.join('\n')).toContain('not provided');
    expect(lines.join('\n')).toContain('conditional events');
  });
  it('produces all pages with valid byte offsets, ASCII-safe strings and a complete final object', () => {
    const pdf = new TextDecoder().decode(createFeeReportPdf(JSON.stringify(report)));
    const pageCount = Math.ceil(feeReportPdfLines(JSON.stringify(report)).length / 58);
    expect(pdf).toMatch(/^%PDF-1\.4/); expect(pdf).toMatch(/%%EOF\n$/);
    expect(pdf).toContain(`/Count ${pageCount}`);
    expect(pdf).toContain(`page ${pageCount} of ${pageCount}`);
    expect(pdf).toContain('7.123456789012'); expect(pdf).toContain('method_45');
    const xref = Number(pdf.match(/startxref\n(\d+)/)?.[1]); expect(pdf.slice(xref, xref + 4)).toBe('xref');
    const rows = pdf.slice(xref).split('\n').slice(3).filter(line => /^\d{10} 00000 n/.test(line));
    rows.forEach((row, index) => expect(pdf.slice(Number(row.slice(0, 10)))).toMatch(new RegExp(`^${index + 1} 0 obj`)));
  });
  it('escapes PDF control syntax and preserves non-ASCII text as reversible JSON escapes', () => {
    const special = { ...report, source: 'ő (x) \\ ) Tj /OpenAction (漢)' };
    const lines = feeReportPdfLines(JSON.stringify(special));
    expect(JSON.parse(lines.slice(lines.indexOf('FULL SANITIZED REPORT') + 2).join(''))).toEqual(special);
    const pdf = new TextDecoder().decode(createFeeReportPdf(JSON.stringify(special)));
    expect(pdf).not.toMatch(/[^\x00-\x7f]/); expect(pdf).toContain('\\(x\\)');
  });
  it('downloads the existing report as a PDF Blob and releases the local URL, without fetching', async () => {
    vi.useFakeTimers();
    const click = vi.fn(), remove = vi.fn(), appendChild = vi.fn();
    const anchor = { href: '', download: '', click, remove };
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { appendChild } });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    downloadOwnerFeePdf(JSON.stringify(report));
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/pdf'); expect((await blob.text()).startsWith('%PDF-1.4')).toBe(true);
    expect(anchor.download).toBe('start-ai-whop-fees.pdf'); expect(anchor.href).toBe('blob:synthetic');
    expect(click).toHaveBeenCalledOnce(); expect(remove).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled();
    vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:synthetic');
  });
  it('refuses malformed data rather than producing an incomplete success artifact', () => {
    expect(() => createFeeReportPdf('not json')).toThrow();
    expect(() => createFeeReportPdf('{"code":"WHOP_FEE_HTTP_ERROR"}')).toThrow();
  });
});
