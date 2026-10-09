export type Severity = 'blocker' | 'review' | 'info';

export interface Issue {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  /** Which documents the finding comes from, e.g. ["invoice", "packing list"]. */
  sources: string[];
  /** What the user (or broker) should do. */
  action?: string;
}

/** Values a broker supplies because the documents never contain them. */
export interface BrokerInputs {
  importerTaxId?: string;
  importerName?: string;
  ultimateConsigneeName?: string;
  entryType?: string;
  bondType?: string;
  suretyCode?: string;
  entryPort?: string;
  processingPort?: string;
  entryDate?: string;
  customerReference?: string;
  applyAssistToValue?: boolean;
  /** keyed by LineView.key */
  lines?: Record<string, { hts?: string; mid?: string; origin?: string }>;
}

export interface LineView {
  key: string;
  invoiceNo: string;
  styleNo: string;
  description: string;
  hsPrinted: string;
  tariffNo: string;
  tariffDigits: number;
  origin: string;
  originSource: string;
  manufacturerName: string;
  manufacturerId: string;
  quantity: number | null;
  unit: string;
  printedAmount: number | null;
  enteredValue: number;
  valueBasis: 'printed' | 'recomputed' | 'customs-value' | 'assist-added';
  grossKg: number | null;
}

export interface EntrySummary {
  documents: { fileName: string; type: string }[];
  importer: string;
  seller: string;
  shipTo: string;
  vessel: string;
  voyage: string;
  masterBill: string;
  houseBill: string;
  container: string;
  portOfLoading: string;
  portOfDischarge: string;
  entryPort: string;
  arrival: string;
  packages: number | null;
  grossKg: number | null;
  charges: number | null;
  enteredValueTotal: number;
  lines: LineView[];
}

export interface EntryResult {
  xml: string;
  xsd: { valid: boolean; errors: string[] };
  issues: Issue[];
  summary: EntrySummary;
}
