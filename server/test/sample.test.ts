import { describe, expect, it } from 'vitest';
import { loadSampleExtractions } from '../src/extraction/fixtures';
import { buildEntry } from '../src/domain/pipeline';
import { checkContainer } from '../src/domain/iso6346';
import { cleanGoodsDescription, parseDate } from '../src/domain/util';

const ex = loadSampleExtractions();
const has = (r: Awaited<ReturnType<typeof buildEntry>>, id: string) => r.issues.find((i) => i.id.startsWith(id));

describe('sample shipment', () => {
  it('produces XML that passes NetCHB entry.xsd', async () => {
    const r = await buildEntry(ex);
    expect(r.xsd.errors).toEqual([]);
    expect(r.xsd.valid).toBe(true);
  });

  it('keeps the invoice number inside NetCHB pattern', async () => {
    const r = await buildEntry(ex);
    expect(r.xml).toContain('<invoice-no>KBASNB26-0912</invoice-no>');
    expect(has(r, 'invno-changed')).toBeTruthy();
  });

  it('uses the recalculated T-shirt amount that the invoice total supports', async () => {
    const r = await buildEntry(ex);
    const tee = r.summary.lines.find((l) => l.styleNo === 'NB-T101')!;
    expect(tee.enteredValue).toBe(6840);
    expect(tee.valueBasis).toBe('recomputed');
    expect(has(r, 'line-typo')).toBeTruthy();
    const total = r.summary.lines.filter((l) => l.styleNo !== 'NB-P118S').reduce((a, l) => a + l.enteredValue, 0);
    expect(total).toBe(23235);
  });

  it('picks the container number that passes ISO 6346', async () => {
    expect(checkContainer('OPLU3041728')?.checkDigitOk).toBe(false);
    expect(checkContainer('OPLU3041722')?.checkDigitOk).toBe(true);
    const r = await buildEntry(ex);
    expect(r.xml).toContain('<container-number>OPLU3041722</container-number>');
    expect(has(r, 'container-amended')?.severity).toBe('review');
  });

  it('assigns Bangladesh origin to the samples only', async () => {
    const r = await buildEntry(ex);
    expect(r.summary.lines.map((l) => [l.styleNo, l.origin])).toEqual([
      ['NB-T101', 'VN'], ['NB-H205', 'VN'], ['NB-C330', 'VN'], ['W-B220', 'VN'], ['NB-P118S', 'BD'],
    ]);
    expect(has(r, 'mixed-origin')).toBeTruthy();
  });

  it('flags the discrepancies planted in the documents', async () => {
    const r = await buildEntry(ex);
    for (const id of ['qty-mismatch', 'fibre-NBH205', 'gross-weight', 'assist-WB220', 'hts-short', 'mid', 'importer-tax-id', 'bond']) {
      expect(has(r, id), id).toBeTruthy();
    }
    const q = has(r, 'qty-mismatch')!;
    expect(q.detail).toContain('1200');
    expect(q.detail).toContain('1176');
    expect(q.detail).toContain('offset');
  });

  it('does not add the assist unless asked, and adds it when asked', async () => {
    const off = await buildEntry(ex);
    expect(off.summary.lines.find((l) => l.styleNo === 'W-B220')!.enteredValue).toBe(1260);
    const on = await buildEntry(ex, { applyAssistToValue: true });
    expect(on.summary.lines.find((l) => l.styleNo === 'W-B220')!.enteredValue).toBe(5440);
  });

  it('accepts broker inputs and clears the matching blockers', async () => {
    const r = await buildEntry(ex, {
      importerTaxId: '12-3456789', bondType: '08', suretyCode: '123',
      lines: { i1l1: { hts: '6109100012', mid: 'VNSAIPHO123DIA' } },
    });
    expect(has(r, 'importer-tax-id')).toBeFalsy();
    expect(has(r, 'bond')).toBeFalsy();
    expect(r.xml).toContain('<tariff-no>6109100012</tariff-no>');
    expect(r.xml).toContain('<importer-tax-id>12-3456789</importer-tax-id>');
    expect(r.xsd.valid).toBe(true);
  });

  it('splits bill numbers from carrier codes', async () => {
    const r = await buildEntry(ex);
    expect(r.xml).toContain('<master-scac>OPLU</master-scac>');
    expect(r.xml).toContain('<master-bill>SGN260917735</master-bill>');
    expect(r.xml).toContain('<house-bill>HCM26090418</house-bill>');
  });

  it('never emits a transmit tag', async () => {
    expect((await buildEntry(ex)).xml).not.toContain('transmit');
  });

  it('degrades gracefully when documents are missing', async () => {
    const r = await buildEntry(ex.filter((e) => e.documentType === 'commercial_invoice'));
    expect(has(r, 'missing-bol')?.severity).toBe('blocker');
    expect(has(r, 'missing-pl')).toBeTruthy();
    const empty = await buildEntry([]);
    expect(has(empty, 'missing-invoice')).toBeTruthy();
  });
});

describe('helpers', () => {
  it('drops container and carton wording from the goods description', () => {
    // exact text the model returned for the real bill of lading
    const raw = "1 X 20'GP CONTAINER S.T.C.: 138 CARTONS OF WEARING APPAREL - MEN'S AND LADIES' KNIT AND WOVEN GARMENTS";
    expect(cleanGoodsDescription(raw)).toBe("WEARING APPAREL - MEN'S AND LADIES' KNIT AND WOVEN GARMENTS");
    expect(cleanGoodsDescription('COTTON T-SHIRTS')).toBe('COTTON T-SHIRTS');
  });

  it('reads day-month dates and flags ambiguity', () => {
    expect(parseDate('12/09/2026')).toEqual({ iso: '2026-09-12', ambiguous: true });
    expect(parseDate('24-SEP-2026')).toEqual({ iso: '2026-09-24', ambiguous: false });
    expect(parseDate('13/09/2026').ambiguous).toBe(false);
  });
});
