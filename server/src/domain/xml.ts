import type { Model } from './analyze';
import { xmlEscape } from './util';

const NS = 'http://www.netchb.com/xml/entry';

/** Builds the entry XML for NetCHB's uploadEntry. Element order follows entry.xsd (entry-level order is enforced). */
export function buildEntryXml(m: Model): string {
  const out: string[] = [];
  const el = (depth: number, name: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === '') return;
    out.push(`${'  '.repeat(depth)}<${name}>${xmlEscape(String(value))}</${name}>`);
  };
  const open = (depth: number, name: string) => out.push(`${'  '.repeat(depth)}<${name}>`);
  const close = (depth: number, name: string) => out.push(`${'  '.repeat(depth)}</${name}>`);
  const money = (n: number) => n.toFixed(2);

  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(`<entry xmlns="${NS}">`);
  open(1, 'entry-no'); out.push('    <system-generated/>'); close(1, 'entry-no');

  open(1, 'header');
  el(2, 'importer-tax-id', m.importerTaxId);
  el(2, 'importer-name', m.importerName);
  if (m.ultimateConsigneeName) { open(2, 'ultimate-consignee'); el(3, 'consignee-name', m.ultimateConsigneeName); close(2, 'ultimate-consignee'); }
  el(2, 'processing-port', m.processingPort);
  el(2, 'entry-port', m.entryPort);
  el(2, 'entry-date', m.entryDate);
  el(2, 'entry-type', m.entryType);
  el(2, 'bond-type', m.bondType);
  el(2, 'charges', m.charges);
  el(2, 'gross-weight', m.grossKg);
  el(2, 'total-entry-value', m.totalEntryValue >= 1 ? Math.round(m.totalEntryValue) : null);
  el(2, 'description', m.description);
  el(2, 'surety-code', m.suretyCode);
  el(2, 'state-destination', m.stateDestination);
  el(2, 'vessel-name', m.vesselName);
  el(2, 'mode-transportation', m.modeTransport);
  el(2, 'unlading-port', m.unladingPort);
  el(2, 'arrival-date', m.arrivalDate);
  el(2, 'carrier-code', m.carrierCode);
  el(2, 'customer-reference-no', m.customerRef);
  el(2, 'voyage-no', m.voyageNo);
  close(1, 'header');

  open(1, 'manifest');
  if (m.manifest) {
    open(2, 'bill-of-lading');
    el(3, 'master-scac', m.manifest.masterScac);
    el(3, 'master-bill', m.manifest.masterBill);
    el(3, 'house-scac', m.manifest.houseScac);
    el(3, 'house-bill', m.manifest.houseBill);
    el(3, 'quantity', m.manifest.quantity);
    el(3, 'unit', m.manifest.unit);
    close(2, 'bill-of-lading');
  }
  close(1, 'manifest');

  if (m.containers.length) {
    open(1, 'containers');
    for (const c of m.containers) {
      open(2, 'container');
      el(3, 'container-number', c.number);
      el(3, 'container-size', c.size);
      el(3, 'container-type', c.type);
      el(3, 'seal-numbers', c.seal);
      close(2, 'container');
    }
    close(1, 'containers');
  }

  open(1, 'invoices');
  for (const inv of m.invoices) {
    open(2, 'invoice');
    el(3, 'invoice-no', inv.no);
    open(3, 'line-items');
    for (const l of inv.lines) {
      open(4, 'line-item');
      el(5, 'country-origin', l.origin);
      el(5, 'manufacturer-id', l.manufacturerId);
      el(5, 'gross-weight', l.grossKg != null ? Math.round(l.grossKg) : null);
      open(5, 'tariffs');
      open(6, 'tariff');
      el(7, 'tariff-no', l.tariffNo);
      el(7, 'value', money(l.enteredValue));
      close(6, 'tariff');
      close(5, 'tariffs');
      el(5, 'commercial-description', l.commercialDescription);
      el(5, 'invoice-quantity', l.quantity);
      close(4, 'line-item');
    }
    close(3, 'line-items');
    close(2, 'invoice');
  }
  close(1, 'invoices');
  out.push('</entry>');
  return out.join('\n') + '\n';
}
