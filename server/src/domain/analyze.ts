import type { Extraction, InvoiceDoc, PackingDoc, BolDoc, InvoiceLine } from '../../../shared/extraction';
import type { BrokerInputs, Issue, LineView } from '../../../shared/result';
import { checkContainer } from './iso6346';
import { lookupUsPort } from './ports';
import { toIso2 } from './countries';
import { clean, cleanGoodsDescription, money, normKey, parseDate, round2, sum, truncateWords } from './util';

export interface LineModel extends LineView {
  invoiceIndex: number;
  commercialDescription: string;
}
export interface ContainerModel { number: string; size: string | null; type: string | null; seal: string | null }
export interface Model {
  importerName: string;
  importerTaxId: string;
  ultimateConsigneeName: string;
  entryType: string;
  bondType: string;
  suretyCode: string;
  processingPort: string;
  entryPort: string;
  unladingPort: string;
  entryDate: string;
  arrivalDate: string;
  description: string;
  stateDestination: string;
  vesselName: string;
  voyageNo: string;
  modeTransport: string;
  carrierCode: string;
  customerRef: string;
  grossKg: number | null;
  charges: number | null;
  totalEntryValue: number;
  manifest: { masterScac: string; masterBill: string; houseScac: string; houseBill: string; quantity: number; unit: string } | null;
  containers: ContainerModel[];
  invoices: { no: string; lines: LineModel[] }[];
  packages: number | null;
}

const GENERIC_DESCRIPTIONS = ['ITEMS', 'ITEM', 'GOODS', 'MERCHANDISE', 'APPAREL', 'GARMENTS', 'CLOTHING', 'PRODUCTS', 'SAMPLES', 'ASSORTED'];
const UNIT_MAP: Record<string, string> = {
  CARTONS: 'CTN', CARTON: 'CTN', CTNS: 'CTN', PALLETS: 'PLT', PALLET: 'PLT', PACKAGES: 'PKG', PKGS: 'PKG', PIECES: 'PCS',
  BAGS: 'BAG', CASES: 'CS', DRUMS: 'DR', BALES: 'BE', ROLLS: 'RL', BOXES: 'BX', CRATES: 'CRT',
};
const percents = (s: string) => [...s.matchAll(/(\d{1,3})\s*%/g)].map((m) => Number(m[1]));
const ratios = (s: string) => [...s.matchAll(/\b(\d{1,3})\/(\d{1,3})\b/g)].flatMap((m) => [Number(m[1]), Number(m[2])]);
const sameSet = (a: number[], b: number[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

function stripPrefix(num: string | null, scac: string | null): string {
  const n = normKey(num);
  const s = normKey(scac);
  return s && n.startsWith(s) && n.length > s.length ? n.slice(s.length) : n;
}

export function analyze(extractions: Extraction[], inputs: BrokerInputs): { model: Model; issues: Issue[]; fileTypes: { fileName: string; type: string }[] } {
  const issues: Issue[] = [];
  const add = (i: Issue) => issues.push(i);

  const invoices = extractions.filter((e) => e.invoice).map((e) => ({ file: e.fileName, d: e.invoice as InvoiceDoc }));
  const pls = extractions.filter((e) => e.packingList).map((e) => ({ file: e.fileName, d: e.packingList as PackingDoc }));
  const bols = extractions.filter((e) => e.billOfLading).map((e) => ({ file: e.fileName, d: e.billOfLading as BolDoc }));
  const pl = pls[0]?.d ?? null;
  const bol = bols[0]?.d ?? null;
  const fileTypes = extractions.map((e) => ({ fileName: e.fileName, type: e.documentType }));

  /* ---------- Which documents did we get? ---------- */
  for (const e of extractions.filter((x) => x.documentType === 'unknown')) {
    add({ id: `unknown-doc-${e.fileName}`, severity: 'review', title: `Could not identify ${e.fileName}`, detail: 'The file was not recognised as a commercial invoice, packing list or bill of lading, so it was not used.', sources: [e.fileName], action: 'Check the file or upload the right document.' });
  }
  if (!invoices.length) add({ id: 'missing-invoice', severity: 'blocker', title: 'No commercial invoice uploaded', detail: 'Values, quantities, tariff codes and the seller come from the commercial invoice, so the entry has no lines without it.', sources: [], action: 'Upload the commercial invoice.' });
  if (!bol) add({ id: 'missing-bol', severity: 'blocker', title: 'No bill of lading uploaded', detail: 'The manifest section (bill numbers, carrier, container, vessel) comes from the bill of lading.', sources: [], action: 'Upload the house or master bill of lading.' });
  if (!pl) add({ id: 'missing-pl', severity: 'review', title: 'No packing list uploaded', detail: 'Line weights, carton counts and sample origin notes come from the packing list. The entry can still be built, but weights will be missing.', sources: [], action: 'Upload the packing list.' });
  if (invoices.length > 1) add({ id: 'multi-invoice', severity: 'info', title: `${invoices.length} commercial invoices found`, detail: 'Each invoice becomes its own invoice block in the entry. Cross-checks against the packing list and bill of lading use all invoices together.', sources: invoices.map((i) => i.file) });
  if (pls.length > 1 || bols.length > 1) add({ id: 'multi-pl-bol', severity: 'review', title: 'More than one packing list or bill of lading', detail: 'Only the first packing list and first bill of lading were used.', sources: [...pls, ...bols].map((x) => x.file), action: 'Check that all documents belong to the same shipment.' });

  const inv0 = invoices[0]?.d ?? null;

  /* ---------- Containers ---------- */
  const containers: ContainerModel[] = [];
  for (const c of bol?.containers ?? []) {
    const p = checkContainer(c.numberPrinted);
    const h = checkContainer(c.numberHandwritten);
    let chosen = h && h.wellFormed && h.checkDigitOk ? h : p && p.wellFormed && p.checkDigitOk ? p : (h ?? p);
    if (!chosen) continue;
    const valid = chosen.wellFormed && chosen.checkDigitOk;
    if (h) {
      const printedNote = p ? `The printed number ${p.value} ${p.wellFormed ? (p.checkDigitOk ? 'has a valid check digit' : `has an invalid check digit (it should end in ${p.expectedDigit})`) : 'is not a valid container number format'}.` : '';
      const handNote = `The handwritten correction reads ${h.value}${h.wellFormed ? (h.checkDigitOk ? ', which has a valid check digit' : `, which has an invalid check digit (it should end in ${h.expectedDigit})`) : ', which is not a valid container number format'}${c.handwrittenLegible === false ? ' (the handwriting is hard to read)' : ''}.`;
      add({
        id: `container-amended-${chosen.value}`,
        severity: valid ? 'review' : 'blocker',
        title: 'Container number was changed by hand on the bill of lading',
        detail: `${printedNote} ${handNote} The entry uses ${chosen.value}${valid ? '' : ', but it does not pass the ISO 6346 check'}.`,
        sources: ['bill of lading'],
        action: 'Confirm the final container number with the carrier or forwarder before filing.',
      });
    } else if (!valid) {
      add({ id: `container-invalid-${chosen.value}`, severity: 'blocker', title: `Container number ${chosen.value} fails the ISO 6346 check`, detail: 'The format or the check digit is wrong.', sources: ['bill of lading'], action: 'Confirm the container number with the carrier.' });
    }
    const sizeType = clean(c.sizeType);
    const size = /20/.test(sizeType) ? '20 ft' : /45/.test(sizeType) ? '45 ft' : /40/.test(sizeType) ? '40 ft' : /53/.test(sizeType) ? '53 ft' : null;
    const hc = /HC|HQ/i.test(sizeType) && size ? `${size} HC` : size;
    containers.push({ number: chosen.value, size: hc, type: /GP|DV|DRY/i.test(sizeType) ? 'Dry' : null, seal: c.seal });
  }

  /* ---------- Manifest ---------- */
  let manifest: Model['manifest'] = null;
  if (bol) {
    const masterScac = normKey(bol.oceanCarrierScac) || '';
    const houseScac = normKey(bol.carrierScac) || '';
    const unitKey = clean(bol.packageUnit).toUpperCase();
    const unit = UNIT_MAP[unitKey] ?? (unitKey ? unitKey.replace(/[^A-Z]/g, '').slice(0, 5) : 'PKG');
    manifest = {
      masterScac,
      masterBill: stripPrefix(bol.masterBl, masterScac),
      houseScac,
      houseBill: stripPrefix(bol.blNumber, houseScac),
      quantity: Math.round(bol.packages ?? 0),
      unit,
    };
    if (masterScac || houseScac) {
      add({ id: 'bill-split', severity: 'info', title: 'Bill numbers were split from their carrier codes', detail: `Printed master bill ${bol.masterBl ?? 'n/a'} became carrier code ${masterScac || 'n/a'} + bill ${manifest.masterBill}; printed house bill ${bol.blNumber ?? 'n/a'} became ${houseScac || 'n/a'} + ${manifest.houseBill}. This follows the usual convention that the first letters are the carrier's SCAC.`, sources: ['bill of lading'], action: 'Check against the AMS/ACE manifest record if the bill numbers are rejected.' });
    }
    if (!masterScac) add({ id: 'no-master-scac', severity: 'review', title: 'Ocean carrier code not found', detail: 'The master bill needs the ocean carrier\'s SCAC code and the document does not show one.', sources: ['bill of lading'] });
    if (/TBA|TBD/i.test(bol.notifyParty?.address ?? '')) {
      add({ id: 'broker-tba', severity: 'info', title: 'Customs broker is not named yet', detail: 'The notify party on the bill of lading lists the customs broker as "TBA".', sources: ['bill of lading'], action: 'Make sure the filing broker is confirmed and that the carrier/forwarder has their details.' });
    }
  }

  /* ---------- Header basics ---------- */
  const poe = bol?.portOfDischarge ?? inv0?.portOfDischarge ?? null;
  const looked = lookupUsPort(poe);
  const entryPort = inputs.entryPort?.trim() || looked?.code || '';
  if (!entryPort) {
    add({ id: 'entry-port', severity: 'blocker', title: 'Entry port code is missing', detail: `The port of discharge (${poe ?? 'not found'}) could not be matched to a US port code.`, sources: ['bill of lading'], action: 'Enter the 4-digit Schedule D port code.' });
  } else if (!inputs.entryPort?.trim() && looked && !looked.verified) {
    add({ id: 'entry-port-unverified', severity: 'review', title: `Port code ${entryPort} is a best guess`, detail: `${looked.name} was matched to ${entryPort} from a built-in list that has not been checked against an official source.`, sources: ['bill of lading'], action: 'Confirm the Schedule D code.' });
  }
  const processingPort = inputs.processingPort?.trim() || entryPort;
  if (!inputs.processingPort?.trim()) {
    add({ id: 'processing-port', severity: 'info', title: 'Processing port was set to the entry port', detail: 'The processing port is the broker\'s own filing port and is not on any shipping document.', sources: [], action: 'Change it in the form if your office files elsewhere.' });
  }

  const etaParsed = parseDate(inv0?.etaRaw, inv0?.etaIso);
  const arrivalDate = etaParsed.iso ?? '';
  const entryDate = inputs.entryDate?.trim() || arrivalDate || new Date().toISOString().slice(0, 10);
  if (!inputs.entryDate?.trim()) {
    add({
      id: 'entry-date',
      severity: arrivalDate ? 'info' : 'blocker',
      title: arrivalDate ? 'Entry date was set to the estimated arrival date' : 'No arrival date found, so today\'s date was used',
      detail: arrivalDate ? `The invoice gives an estimated arrival of ${arrivalDate}. The real entry date depends on when the broker files.` : 'The entry date is required.',
      sources: arrivalDate ? ['invoice'] : [],
      action: 'Set the entry date when you file.',
    });
  }

  const entryType = inputs.entryType?.trim() || '01';
  if (!inputs.entryType?.trim()) {
    add({ id: 'entry-type', severity: 'review', title: 'Entry type 01 (consumption, free and dutiable) was assumed', detail: 'The documents do not say how the goods are being entered. Type 01 is the usual choice for commercial imports but it is an assumption.', sources: [], action: 'Confirm the entry type.' });
  }

  const importerTaxId = inputs.importerTaxId?.trim() ?? '';
  if (!importerTaxId && entryType !== '86') {
    add({ id: 'importer-tax-id', severity: 'blocker', title: 'Importer tax ID is needed', detail: 'No shipping document carries the importer of record\'s EIN or CBP-assigned number, and NetCHB needs it to find the importer.', sources: [], action: 'Enter the importer\'s tax ID (for example 12-3456789).' });
  } else if (importerTaxId && !/^(\d{2}-\d{7}[0-9A-Za-z]{0,2}|\d{6}-\d{5}|\d{3}-\d{2}-\d{4})$/.test(importerTaxId)) {
    add({ id: 'importer-tax-id-format', severity: 'blocker', title: 'Importer tax ID is not in a format NetCHB accepts', detail: `"${importerTaxId}" does not match 12-3456789, 123456-12345 or 123-45-6789.`, sources: [], action: 'Correct the tax ID.' });
  }
  const importerName = inputs.importerName?.trim() || inv0?.buyer?.name || pl?.consignee?.name || '';
  if (!inputs.importerName?.trim() && importerName) {
    add({ id: 'importer-assumed', severity: 'review', title: `${importerName} was assumed to be the importer of record`, detail: 'The documents name the buyer and notify party but never say who is the importer of record.', sources: ['invoice'], action: 'Confirm the importer of record.' });
  }
  const ultimateConsigneeName = inputs.ultimateConsigneeName?.trim() || importerName;
  const shipToName = inv0?.shipTo?.name || bol?.consignee?.name;
  if (!inputs.ultimateConsigneeName?.trim() && shipToName && importerName && normKey(shipToName) !== normKey(importerName)) {
    add({ id: 'consignee-split', severity: 'review', title: 'Goods are delivered to a different company than the buyer', detail: `The bill of lading consignee and the invoice ship-to are ${shipToName}, delivering "for account of" ${importerName}. The ultimate consignee was set to ${importerName}, and ${shipToName} is treated as the warehouse.`, sources: ['invoice', 'bill of lading'], action: 'Confirm which company is the ultimate consignee.' });
  }
  if (!inputs.bondType?.trim()) {
    add({ id: 'bond', severity: 'blocker', title: 'Bond information is needed', detail: 'Bond type and surety code are not on any shipping document. Most consumption entries need a continuous or single-transaction bond.', sources: [], action: 'Enter the bond type (08 continuous, 09 single transaction) and surety code.' });
  }

  const stateMatch = (inv0?.shipTo?.address ?? bol?.consignee?.address ?? '').toUpperCase().match(/\b([A-Z]{2})\s+\d{5}\b/);
  const stateDestination = stateMatch ? stateMatch[1] : '';

  /* ---------- Cross-document reference checks ---------- */
  const refChecks: { label: string; values: { src: string; v: string | null }[] }[] = [
    { label: 'Invoice number', values: [{ src: 'invoice', v: inv0?.invoiceNumber ?? null }, { src: 'packing list', v: pl?.invoiceRef ?? null }, { src: 'bill of lading', v: bol?.invoiceRef ?? null }] },
    { label: 'Purchase order', values: [{ src: 'invoice', v: inv0?.poNumber ?? null }, { src: 'packing list', v: pl?.poNumber ?? null }, { src: 'bill of lading', v: bol?.poRef ?? null }] },
    { label: 'Vessel', values: [{ src: 'invoice', v: inv0?.vessel ?? null }, { src: 'packing list', v: pl?.vessel ?? null }, { src: 'bill of lading', v: bol?.vessel ?? null }] },
    { label: 'Voyage', values: [{ src: 'invoice', v: inv0?.voyage ?? null }, { src: 'packing list', v: pl?.voyage ?? null }, { src: 'bill of lading', v: bol?.voyage ?? null }] },
    { label: 'Bill of lading number', values: [{ src: 'invoice', v: inv0?.blNumber ?? null }, { src: 'bill of lading', v: bol?.blNumber ?? null }] },
  ];
  for (const rc of refChecks) {
    const present = rc.values.filter((x) => normKey(x.v));
    if (new Set(present.map((x) => normKey(x.v))).size > 1) {
      add({ id: `ref-${rc.label}`, severity: 'review', title: `${rc.label} differs between documents`, detail: present.map((x) => `${x.src}: ${x.v}`).join('; '), sources: present.map((x) => x.src), action: 'Check that the documents belong to the same shipment.' });
    }
  }

  /* ---------- Invoices -> lines ---------- */
  const invoiceModels: Model['invoices'] = [];
  const plLines = pl?.lines ?? [];
  const allLines: { line: LineModel; src: InvoiceLine; inv: InvoiceDoc }[] = [];
  let totalPrintedFreightInsurance = 0;

  invoices.forEach(({ d: inv }, idx) => {
    const rawNo = clean(inv.invoiceNumber) || `INV${idx + 1}`;
    let no = rawNo.replace(/[^A-Za-z0-9-]/g, '');
    if (no.length > 17) {
      add({ id: `invno-long-${idx}`, severity: 'review', title: `Invoice number ${rawNo} is too long for NetCHB`, detail: 'NetCHB accepts at most 17 characters. The last 17 were kept.', sources: ['invoice'] });
      no = no.slice(-17);
    }
    if (no !== rawNo) {
      add({ id: `invno-changed-${idx}`, severity: 'info', title: `Invoice number written as ${no}`, detail: `NetCHB only accepts letters, digits and hyphens (up to 17 characters), so ${rawNo} was shortened to ${no}.`, sources: ['invoice'], action: 'Keep the original invoice number in your own records.' });
    }

    const dateParsed = parseDate(inv.invoiceDateRaw, inv.invoiceDateIso);
    if (inv.invoiceDateRaw && /^\d{1,2}[/.-]\d{1,2}[/.-]\d{4}/.test(inv.invoiceDateRaw) && dateParsed.ambiguous) {
      add({ id: `date-ambiguous-${idx}`, severity: 'info', title: `Invoice date ${inv.invoiceDateRaw} was read as day/month`, detail: `Read as ${dateParsed.iso}. The other dates on the shipment use day-month-year formats, and a month-first reading would put the invoice after the vessel sailed.`, sources: ['invoice'] });
    }

    const commercial = inv.lines.filter((l) => !l.isSample && !l.noCommercialValue);
    const computed = (l: InvoiceLine) => (l.quantity != null && l.unitPrice != null ? round2(l.quantity * l.unitPrice) : l.amount ?? 0);
    const printedSum = round2(sum(commercial.map((l) => l.amount ?? 0)));
    const computedSum = round2(sum(commercial.map(computed)));
    const stated = inv.totalFob;
    const mismatched = commercial.filter((l) => l.amount != null && Math.abs(computed(l) - l.amount) > 0.01);
    let useComputed = false;
    if (stated != null) {
      if (Math.abs(printedSum - stated) <= 0.01) {
        if (mismatched.length) add({ id: `line-math-${idx}`, severity: 'review', title: 'A line amount does not equal quantity x unit price', detail: mismatched.map((l) => `${l.styleNo}: ${l.quantity} x ${l.unitPrice} = ${money(computed(l))}, but the line shows ${money(l.amount ?? 0)}`).join('; ') + '. The printed lines do add up to the stated total, so the printed amounts were kept.', sources: ['invoice'], action: 'Ask the seller which figure is right.' });
      } else if (Math.abs(computedSum - stated) <= 0.01) {
        useComputed = true;
        add({ id: `line-typo-${idx}`, severity: 'review', title: 'An invoice line amount looks mistyped', detail: `${mismatched.map((l) => `${l.styleNo} shows ${money(l.amount ?? 0)} but ${l.quantity} x ${l.unitPrice} = ${money(computed(l))}`).join('; ')}. The printed lines add up to ${money(printedSum)}, but the invoice total of ${money(stated)} only works with the recalculated amount, so the entry uses ${money(computed(mismatched[0] ?? commercial[0]))}.`, sources: ['invoice'], action: 'Ask the seller to confirm the corrected line amount.' });
      } else {
        add({ id: `total-mismatch-${idx}`, severity: 'blocker', title: 'Invoice lines do not add up to the invoice total', detail: `Printed lines add up to ${money(printedSum)}, quantity x price gives ${money(computedSum)}, but the invoice total says ${money(stated)}.`, sources: ['invoice'], action: 'Get a corrected invoice from the seller.' });
      }
    } else if (mismatched.length) {
      add({ id: `line-math-${idx}`, severity: 'review', title: 'A line amount does not equal quantity x unit price', detail: mismatched.map((l) => `${l.styleNo}: ${money(computed(l))} expected, ${money(l.amount ?? 0)} printed`).join('; '), sources: ['invoice'] });
    }

    if (inv.subtotalCarriedForward != null && inv.lines.length) {
      const firstPage = inv.lines.slice(0, 3);
      const sub = round2(sum(firstPage.map((l) => (useComputed ? computed(l) : l.amount ?? 0))));
      if (Math.abs(sub - inv.subtotalCarriedForward) > 0.01 && firstPage.length === 3) {
        add({ id: `subtotal-${idx}`, severity: 'review', title: 'The page-one subtotal does not match the first three lines', detail: `Lines add up to ${money(sub)}, the invoice shows ${money(inv.subtotalCarriedForward)}.`, sources: ['invoice'] });
      }
    }

    const fi = round2((inv.freight ?? 0) + (inv.insurance ?? 0));
    totalPrintedFreightInsurance += fi;
    if (inv.totalCif != null && stated != null && fi > 0 && Math.abs(stated + fi - inv.totalCif) > 0.01) {
      add({ id: `cif-${idx}`, severity: 'review', title: 'CIF total does not equal goods + freight + insurance', detail: `${money(stated)} + ${money(fi)} = ${money(stated + fi)}, but the invoice shows ${money(inv.totalCif)}.`, sources: ['invoice'] });
    }
    if (/CIF|CFR|CIP|CPT/i.test(inv.incoterm ?? '') && fi > 0) {
      add({ id: `incoterm-${idx}`, severity: 'info', title: 'Goods are sold CIF, so freight and insurance are kept out of entered value', detail: `Entered values use the goods-only total (${stated != null ? money(stated) : 'sum of lines'}). Freight and insurance of ${money(fi)} are reported as header charges, as an assumption about how NetCHB uses that field.`, sources: ['invoice'], action: 'Check the header charges field against your office practice.' });
    }

    const lines: LineModel[] = [];
    inv.lines.forEach((l, li) => {
      const key = `i${idx + 1}l${l.lineNo ?? li + 1}`;
      const ov = inputs.lines?.[key] ?? {};
      const plLine = plLines.find((x) => normKey(x.styleNo) && normKey(x.styleNo) === normKey(l.styleNo));
      const plNote = pl?.originNotes.find((n) => normKey(n.styleNo) === normKey(l.styleNo) && n.country);

      // origin
      let origin = toIso2(ov.origin);
      let originSource = origin ? 'entered by you' : '';
      if (!origin && l.originNote) { origin = toIso2(l.originNote); if (origin) originSource = 'invoice line note'; }
      if (!origin && plNote) { origin = toIso2(plNote.country); if (origin) originSource = 'packing list remark'; }
      if (!origin && inv.countryOfOrigin) { origin = toIso2(inv.countryOfOrigin); if (origin) originSource = 'invoice declaration'; }
      if (!origin && bol?.madeIn) { origin = toIso2(bol.madeIn); if (origin) originSource = 'bill of lading marks'; }
      if (!origin) add({ id: `origin-${key}`, severity: 'blocker', title: `Country of origin missing for ${l.styleNo ?? key}`, detail: 'No document states where this style was made.', sources: ['invoice'], action: 'Enter the 2-letter country code.' });

      // tariff
      const hsPrinted = clean(l.hsCode);
      const ovDigits = (ov.hts ?? '').replace(/\D/g, '');
      const printedDigits = hsPrinted.replace(/\D/g, '');
      const tariffNo = /^\d{10}$/.test(ovDigits) ? ovDigits : printedDigits;

      // value
      const isSample = !!(l.isSample || l.noCommercialValue);
      let entered = 0;
      let basis: LineView['valueBasis'] = 'printed';
      if (isSample) {
        entered = l.customsValueTotal ?? (l.customsValueUnit != null && l.quantity != null ? round2(l.customsValueUnit * l.quantity) : 0);
        basis = 'customs-value';
        if (!entered) add({ id: `sample-value-${key}`, severity: 'blocker', title: `No customs value for samples ${l.styleNo ?? key}`, detail: 'The line is marked as having no commercial value and no customs value is stated.', sources: ['invoice'], action: 'Enter a value for customs purposes.' });
      } else if (useComputed && mismatched.includes(l)) {
        entered = computed(l);
        basis = 'recomputed';
      } else {
        entered = l.amount ?? computed(l);
      }
      const assist = inv.assists.find((a) => a.value && normKey(a.appliesToStyle) && normKey(a.appliesToStyle) === normKey(l.styleNo));
      if (assist?.value && inputs.applyAssistToValue) { entered = round2(entered + assist.value); basis = 'assist-added'; }

      const manufacturerName = plNote?.manufacturerName || pl?.shipper?.name || bol?.shipper?.name || '';
      const grossKg = plLine ? plLine.totalGrossKg ?? (plLine.cartons != null && plLine.grossKgPerCarton != null ? plLine.cartons * plLine.grossKgPerCarton : null) : null;
      const description = clean(l.description);
      const model: LineModel = {
        key, invoiceIndex: idx, invoiceNo: no, styleNo: clean(l.styleNo), description, hsPrinted,
        tariffNo, tariffDigits: tariffNo.length, origin: origin ?? '', originSource,
        manufacturerName, manufacturerId: ov.mid?.trim() ?? '',
        quantity: l.quantity, unit: clean(l.unit) || 'PCS', printedAmount: l.amount, enteredValue: round2(entered), valueBasis: basis, grossKg,
        commercialDescription: truncateWords([description, clean(l.composition)].filter(Boolean).join(', ').toUpperCase(), 200),
      };
      lines.push(model);
      allLines.push({ line: model, src: l, inv });
    });
    invoiceModels.push({ no, lines });
  });

  /* ---------- Per-line compliance flags ---------- */
  const lineModels = allLines.map((x) => x.line);

  // tariff codes
  const shortHts = lineModels.filter((l) => l.tariffDigits < 10);
  if (shortHts.length) {
    add({ id: 'hts-short', severity: 'blocker', title: `${shortHts.length} tariff code${shortHts.length > 1 ? 's' : ''} need the full 10-digit HTSUS number`, detail: `The documents only give 6-digit HS codes (${[...new Set(shortHts.map((l) => l.hsPrinted))].join(', ')}). US entries need the 10-digit HTSUS code, which depends on details like gender, fibre content and knit versus woven. The entry currently carries the 6-digit codes.`, sources: ['invoice', 'bill of lading'], action: 'Have the broker confirm the 10-digit HTSUS code for each line, then enter it in the form.' });
  }
  if (inputs.lines) {
    for (const [k, v] of Object.entries(inputs.lines)) {
      if (v.hts && !/^\d{10}$/.test(v.hts.replace(/\D/g, ''))) add({ id: `hts-bad-${k}`, severity: 'blocker', title: `The tariff code entered for ${k} is not 10 digits`, detail: `"${v.hts}" was ignored.`, sources: [], action: 'Enter exactly 10 digits.' });
    }
  }

  // manufacturer IDs
  const needMid = lineModels.filter((l) => !l.manufacturerId);
  if (needMid.length) {
    const names = [...new Set(needMid.map((l) => l.manufacturerName).filter(Boolean))];
    add({ id: 'mid', severity: 'blocker', title: 'Manufacturer ID (MID) is needed for each producer', detail: `The MID is a CBP code built from the factory's name and address. It is not printed on any document. ${names.length ? `Factories seen: ${names.join('; ')}.` : ''} ${names.length > 1 ? 'The sample garments come from a different factory in a different country, so they need their own MID.' : ''}`.trim(), sources: ['packing list', 'bill of lading'], action: 'Enter the MID for each line in the form.' });
  }

  // mixed origin
  const origins = [...new Set(lineModels.map((l) => l.origin).filter(Boolean))];
  if (origins.length > 1) {
    const declared = [inv0?.countryOfOrigin ? `invoice declaration: ${inv0.countryOfOrigin}` : '', bol?.madeIn ? `bill of lading marks: made in ${bol.madeIn}` : ''].filter(Boolean).join('; ');
    const odd = lineModels.filter((l) => l.origin !== (toIso2(inv0?.countryOfOrigin) ?? ''));
    add({ id: 'mixed-origin', severity: 'review', title: 'Goods come from more than one country', detail: `${odd.map((l) => `${l.styleNo} is ${l.origin} (${l.originSource})`).join('; ')}, while the rest of the shipment is ${toIso2(inv0?.countryOfOrigin) ?? 'another country'}. Shipment-wide statements say otherwise (${declared}). The entry uses line-level origin, because origin drives duty rates.`, sources: ['invoice', 'packing list', 'bill of lading'], action: 'Confirm the origin of each style with the seller. The invoice declaration and bill of lading marks should be corrected if they are wrong.' });
  }

  // samples
  const sampleLines = allLines.filter((x) => x.src.isSample || x.src.noCommercialValue);
  if (sampleLines.length) {
    add({ id: 'samples', severity: 'info', title: 'Free samples are included', detail: `${sampleLines.map((x) => `${x.line.styleNo} (${x.line.quantity} pcs)`).join(', ')} are free of charge. They were entered at the stated customs value (${sampleLines.map((x) => '$' + money(x.line.enteredValue)).join(', ')}) and kept out of the invoice total, as the invoice says.`, sources: ['invoice'], action: 'Confirm how your office treats free samples.' });
  }

  // assists
  for (const x of allLines.filter((y, i, arr) => arr.findIndex((z) => z.inv === y.inv) === i)) {
    for (const a of x.inv.assists) {
      if (!a.value) continue;
      const target = lineModels.find((l) => normKey(l.styleNo) === normKey(a.appliesToStyle));
      add({
        id: `assist-${normKey(a.appliesToStyle)}`,
        severity: 'review',
        title: `Possible assist: ${money(a.value)} of buyer-supplied material`,
        detail: `${a.description ?? 'Material'}${a.reference ? ` (${a.reference})` : ''} was supplied free by the buyer and is not in the invoice price. US customs rules generally treat materials the buyer supplies to the producer as an assist that can be added to the dutiable value.${target ? ` ${inputs.applyAssistToValue ? `It was added: ${target.styleNo} is entered at ${money(target.enteredValue)}.` : `It was not added: ${target.styleNo} is entered at ${money(target.enteredValue)}; adding it would make ${money(round2(target.enteredValue + a.value))}.`}` : ''}`,
        sources: ['invoice', 'packing list'],
        action: 'Decide with the broker whether to add the assist, then use the toggle in the form.',
      });
    }
  }

  // fibre content vs packing list
  if (pl) {
    for (const x of allLines) {
      const plLine = plLines.find((p) => normKey(p.styleNo) === normKey(x.src.styleNo));
      if (!plLine) continue;
      const inv = percents(clean(x.src.composition));
      const plr = ratios(clean(plLine.description));
      const plp = percents(clean(plLine.description));
      const plSet = plr.length >= 2 ? plr : plp;
      if (inv.length >= 2 && plSet.length >= 2 && !sameSet(inv, plSet)) {
        add({ id: `fibre-${normKey(x.src.styleNo)}`, severity: 'review', title: `Fibre content differs for ${x.src.styleNo}`, detail: `The invoice says ${clean(x.src.composition).split(',')[0]} (${inv.join('/')}); the packing list says "${clean(plLine.description)}" (${plSet.join('/')}).${/\bTC\b/i.test(plLine.description ?? '') ? ' "TC" normally means polyester-cotton, usually with polyester first.' : ''} Fibre content can change the tariff code, for example cotton versus man-made fibre.`, sources: ['invoice', 'packing list'], action: 'Ask the factory for the actual fabric composition before choosing the HTSUS code.' });
      }
    }
  }

  // NetCHB's own warnings, mirrored so brokers see them first
  for (const l of lineModels) {
    if (l.grossKg != null && l.enteredValue > 0 && l.grossKg / l.enteredValue > 1) {
      add({ id: `ratio-${l.key}`, severity: 'review', title: `${l.styleNo}: weight to value ratio is above 1 kg per dollar`, detail: `${l.grossKg} kg for ${money(l.enteredValue)}. NetCHB warns when this ratio is over 1.`, sources: ['packing list', 'invoice'] });
    }
    if (GENERIC_DESCRIPTIONS.includes(l.description.toUpperCase().replace(/[^A-Z ]/g, '').trim())) {
      add({ id: `generic-${l.key}`, severity: 'review', title: `${l.styleNo}: description is too generic`, detail: `NetCHB warns about generic descriptions like "${l.description}".`, sources: ['invoice'], action: 'Use a specific description.' });
    }
  }
  const byDesc = new Map<string, Set<string>>();
  for (const l of lineModels) {
    const d = l.commercialDescription;
    byDesc.set(d, (byDesc.get(d) ?? new Set()).add(l.tariffNo));
  }
  for (const [d, set] of byDesc) if (set.size > 1) add({ id: `dup-desc-${normKey(d).slice(0, 20)}`, severity: 'review', title: 'The same description is used for different tariff codes', detail: `"${d}" appears under ${[...set].join(', ')}. NetCHB warns about this.`, sources: ['invoice'], action: 'Make each tariff description unique.' });

  // relationship + seller vs maker
  if (lineModels.length) {
    add({ id: 'related-party', severity: 'info', title: 'Buyer and seller relationship is not stated', detail: 'The entry asks whether buyer and seller are related. The documents do not say, so the field was left out.', sources: [], action: 'Confirm whether the parties are related.' });
    const sellerName = inv0?.seller?.name;
    const mfrs = [...new Set(lineModels.map((l) => l.manufacturerName).filter(Boolean))];
    if (sellerName && mfrs.length && mfrs.every((m) => normKey(m) !== normKey(sellerName))) {
      add({ id: 'seller-not-maker', severity: 'info', title: 'The seller is not the manufacturer', detail: `${sellerName} (Hong Kong sourcing office) invoices goods made by ${mfrs.join(' and ')}. The MID and country of origin describe the maker, not the seller.`, sources: ['invoice', 'packing list'] });
    }
  }

  /* ---------- Packing list checks ---------- */
  if (pl) {
    const plPcs = sum(plLines.map((l) => l.totalPcs ?? 0));
    const plCtns = sum(plLines.map((l) => l.cartons ?? 0));
    const plNet = round2(sum(plLines.map((l) => l.totalNetKg ?? 0)));
    const plGross = round2(sum(plLines.map((l) => l.totalGrossKg ?? 0)));
    const selfIssues: string[] = [];
    if (pl.totalCartons != null && plCtns !== pl.totalCartons) selfIssues.push(`carton rows add up to ${plCtns}, total says ${pl.totalCartons}`);
    if (pl.totalPcs != null && plPcs !== pl.totalPcs) selfIssues.push(`piece rows add up to ${plPcs}, total says ${pl.totalPcs}`);
    if (pl.totalNetKg != null && Math.abs(plNet - pl.totalNetKg) > 0.05) selfIssues.push(`net weights add up to ${plNet}, total says ${pl.totalNetKg}`);
    if (pl.totalGrossKg != null && Math.abs(plGross - pl.totalGrossKg) > 0.05) selfIssues.push(`gross weights add up to ${plGross}, total says ${pl.totalGrossKg}`);
    for (const l of plLines) if (l.cartons != null && l.pcsPerCarton != null && l.totalPcs != null && l.cartons * l.pcsPerCarton !== l.totalPcs) selfIssues.push(`${l.styleNo}: ${l.cartons} x ${l.pcsPerCarton} is not ${l.totalPcs}`);
    let cbm = 0;
    let cbmOk = true;
    for (const l of plLines) {
      const m = clean(l.cartonDimensionsCm).match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
      if (!m || l.cartons == null) { cbmOk = false; break; }
      cbm += (Number(m[1]) * Number(m[2]) * Number(m[3]) / 1e6) * l.cartons;
    }
    if (cbmOk && pl.totalCbm != null && plLines.length && Math.abs(cbm - pl.totalCbm) / pl.totalCbm > 0.01) selfIssues.push(`carton dimensions give ${round2(cbm)} CBM, total says ${pl.totalCbm}`);
    if (selfIssues.length) add({ id: 'pl-self', severity: 'review', title: 'The packing list does not add up on its own', detail: selfIssues.join('; ') + '.', sources: ['packing list'] });

    // per-style quantity vs invoice
    const diffs: string[] = [];
    const invQtyByStyle = new Map<string, { qty: number; price: number | null; style: string }>();
    for (const x of allLines) invQtyByStyle.set(normKey(x.src.styleNo), { qty: x.src.quantity ?? 0, price: x.src.unitPrice, style: x.src.styleNo ?? '' });
    for (const [k, v] of invQtyByStyle) {
      const p = plLines.find((l) => normKey(l.styleNo) === k);
      if (!p) { diffs.push(`${v.style} is on the invoice but not on the packing list`); continue; }
      if ((p.totalPcs ?? 0) !== v.qty) {
        const d = (p.totalPcs ?? 0) - v.qty;
        diffs.push(`${v.style}: invoice ${v.qty} pcs, packing list ${p.totalPcs} pcs (${d > 0 ? '+' : ''}${d}${v.price != null ? `, about ${money(Math.abs(d) * v.price)} at the invoice price` : ''})`);
      }
    }
    for (const p of plLines) if (!invQtyByStyle.has(normKey(p.styleNo))) diffs.push(`${p.styleNo} is on the packing list but not on the invoice`);
    if (diffs.length) {
      const invTotalEx = sum(allLines.filter((x) => !x.src.isSample && !x.src.noCommercialValue).map((x) => x.src.quantity ?? 0));
      const coincidence = pl.totalPcs != null && (pl.totalPcs === invTotalEx || pl.totalPcs === sum(allLines.map((x) => x.src.quantity ?? 0)))
        ? ` The overall piece totals look equal (${pl.totalPcs}), but only because the missing pieces offset the free samples. The totals agree even though the styles do not.` : '';
      add({ id: 'qty-mismatch', severity: 'review', title: 'Quantities differ between invoice and packing list', detail: diffs.join('; ') + '.' + coincidence + ' The entry uses the invoice quantity and price.', sources: ['invoice', 'packing list'], action: 'Confirm what was actually shipped. If fewer pieces shipped, the entered value changes too.' });
    }

    // cartons across docs
    const cartonCounts = [
      { src: 'invoice', v: invoices[0]?.d.totalPackages ?? null },
      { src: 'packing list', v: pl.totalCartons },
      { src: 'bill of lading', v: bol?.packages ?? null },
    ].filter((x) => x.v != null) as { src: string; v: number }[];
    if (new Set(cartonCounts.map((x) => x.v)).size > 1) add({ id: 'carton-count', severity: 'review', title: 'Carton counts differ', detail: cartonCounts.map((x) => `${x.src}: ${x.v}`).join('; '), sources: cartonCounts.map((x) => x.src) });

    // gross weight vs B/L
    if (bol?.grossWeightKg != null && pl.totalGrossKg != null && Math.abs(bol.grossWeightKg - pl.totalGrossKg) / pl.totalGrossKg > 0.005) {
      add({ id: 'gross-weight', severity: 'review', title: 'Gross weight differs between bill of lading and packing list', detail: `Bill of lading: ${bol.grossWeightKg} kg. Packing list: ${pl.totalGrossKg} kg (${round2(bol.grossWeightKg - pl.totalGrossKg)} kg more on the bill of lading). Cartons are not palletised, so pallets do not explain it. The entry header uses the bill of lading weight, as that is what the carrier manifested.`, sources: ['bill of lading', 'packing list'], action: 'Ask the forwarder whether the bill of lading includes packaging or a different weighing.' });
    }
    if (bol?.measurementCbm != null && pl.totalCbm != null && Math.abs(bol.measurementCbm - pl.totalCbm) > 0.01) {
      add({ id: 'cbm', severity: 'review', title: 'Volume differs between bill of lading and packing list', detail: `Bill of lading ${bol.measurementCbm} CBM, packing list ${pl.totalCbm} CBM.`, sources: ['bill of lading', 'packing list'] });
    }
  }

  /* ---------- Steps outside the documents ---------- */
  if (bol) {
    if (/importer|agent/i.test(bol.isfFiledBy ?? '')) {
      add({ id: 'isf', severity: 'info', title: 'Check that the importer security filing (ISF) is on file', detail: `The bill of lading says the ISF is filed by "${bol.isfFiledBy}". US ocean imports need an ISF before loading${bol.shippedOnBoardIso ? ` (this cargo was loaded on ${bol.shippedOnBoardIso})` : ''}, and NetCHB warns before transmitting if none is found.`, sources: ['bill of lading'], action: 'Confirm the ISF with the importer or their agent.' });
    }
    if (/TELEX|SURRENDER/i.test(bol.releaseNote ?? '')) {
      add({ id: 'telex', severity: 'info', title: 'Bill of lading is telex released', detail: 'Original bills were surrendered at origin, so the cargo can be released without paper originals.', sources: ['bill of lading'] });
    }
  }
  add({ id: 'duties', severity: 'info', title: 'Duties and fees are not calculated here', detail: 'NetCHB calculates duties and fees from the tariff codes unless the entry is flagged as precalculated. This tool leaves that to NetCHB.', sources: [] });
  add({ id: 'no-transmit', severity: 'info', title: 'The entry is not set to transmit to customs', detail: 'The XML has no transmit tag, so nothing is sent to CBP when it is uploaded.', sources: [] });

  /* ---------- Assemble header ---------- */
  const goods = cleanGoodsDescription(bol?.descriptionOfGoods);
  const description = truncateWords(goods.length >= 8 ? goods : [...new Set(lineModels.map((l) => l.description))].join(', '), 70);
  const grossKg = bol?.grossWeightKg ?? pl?.totalGrossKg ?? null;
  const totalEntryValue = round2(sum(lineModels.map((l) => l.enteredValue)));
  const model: Model = {
    importerName,
    importerTaxId,
    ultimateConsigneeName,
    entryType,
    bondType: inputs.bondType?.trim() ?? '',
    suretyCode: inputs.suretyCode?.trim() ?? '',
    processingPort,
    entryPort,
    unladingPort: entryPort,
    entryDate,
    arrivalDate,
    description,
    stateDestination,
    vesselName: (bol?.vessel ?? inv0?.vessel ?? '').slice(0, 20),
    voyageNo: (bol?.voyage ?? inv0?.voyage ?? '').slice(0, 5),
    modeTransport: containers.length ? '11' : '10',
    carrierCode: normKey(bol?.oceanCarrierScac) || '',
    customerRef: truncateWords(inputs.customerReference?.trim() || inv0?.poNumber || bol?.poRef || '', 50),
    grossKg: grossKg != null ? Math.round(grossKg) : null,
    charges: totalPrintedFreightInsurance > 0 ? Math.round(totalPrintedFreightInsurance) : null,
    totalEntryValue,
    manifest,
    containers,
    invoices: invoiceModels,
    packages: bol?.packages ?? pl?.totalCartons ?? null,
  };

  const order = { blocker: 0, review: 1, info: 2 } as const;
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return { model, issues, fileTypes };
}
