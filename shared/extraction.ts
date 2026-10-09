import { z } from 'zod';

/* Lenient primitives: LLM output is messy, so coerce instead of failing the whole document. */
const toNum = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.replace(/[,\s$]/g, '').replace(/^\((.*)\)$/, '$1');
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const toBool = (v: unknown): boolean | null => {
  if (v === true || v === 'true' || v === 'yes') return true;
  if (v === false || v === 'false' || v === 'no') return false;
  return null;
};
const str = z.preprocess((v) => (v === null || v === undefined || v === '' ? null : String(v).trim()), z.string().nullable());
const num = z.preprocess(toNum, z.number().nullable());
const bool = z.preprocess(toBool, z.boolean().nullable());
const list = <T extends z.ZodTypeAny>(t: T) => z.preprocess((v) => (Array.isArray(v) ? v : []), z.array(t));
const obj = <T extends z.ZodRawShape>(shape: T) =>
  z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {}), z.object(shape));

export const PartySchema = obj({ name: str, address: str, country: str, taxId: str });
export type Party = z.infer<typeof PartySchema>;

/* ---------- Commercial invoice ---------- */
export const InvoiceLineSchema = obj({
  lineNo: num,
  styleNo: str,
  description: str,
  composition: str, // fibre content / construction as printed
  hsCode: str, // exactly as printed, e.g. "6109.10"
  quantity: num,
  unit: str,
  unitPrice: num,
  amount: num, // line amount exactly as printed (do not recompute)
  isSample: bool,
  noCommercialValue: bool,
  customsValueUnit: num, // "value for customs purposes only" per unit
  customsValueTotal: num,
  originNote: str, // any line-level origin statement, e.g. "Bangladesh"
  notes: str,
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const AssistSchema = obj({ description: str, value: num, currency: str, reference: str, appliesToStyle: str });

export const InvoiceDocSchema = obj({
  invoiceNumber: str,
  invoiceDateRaw: str,
  invoiceDateIso: str,
  seller: PartySchema,
  buyer: PartySchema,
  shipTo: PartySchema,
  poNumber: str,
  incoterm: str,
  paymentTerms: str,
  currency: str,
  portOfLoading: str,
  portOfDischarge: str,
  vessel: str,
  voyage: str,
  blNumber: str,
  etdRaw: str,
  etaRaw: str,
  etaIso: str,
  countryOfOrigin: str, // as declared for the whole invoice
  lines: list(InvoiceLineSchema),
  subtotalCarriedForward: num,
  totalFob: num,
  freight: num,
  insurance: num,
  totalCif: num,
  totalQuantity: num,
  totalPackages: num,
  assists: list(AssistSchema),
  notes: list(z.preprocess((v) => (v == null ? '' : String(v)), z.string())),
});
export type InvoiceDoc = z.infer<typeof InvoiceDocSchema>;

/* ---------- Packing list ---------- */
export const PackingLineSchema = obj({
  cartonRange: str,
  styleNo: str,
  description: str,
  cartons: num,
  pcsPerCarton: num,
  totalPcs: num,
  netKgPerCarton: num,
  grossKgPerCarton: num,
  totalNetKg: num,
  totalGrossKg: num,
  cartonDimensionsCm: str, // e.g. "60x40x35"
});
export const OriginNoteSchema = obj({ styleNo: str, country: str, manufacturerName: str, manufacturerAddress: str, note: str });

export const PackingDocSchema = obj({
  packingListNumber: str,
  dateRaw: str,
  shipper: PartySchema,
  consignee: PartySchema,
  invoiceRef: str,
  poNumber: str,
  vessel: str,
  voyage: str,
  lines: list(PackingLineSchema),
  totalCartons: num,
  totalPcs: num,
  totalNetKg: num,
  totalGrossKg: num,
  totalCbm: num,
  originNotes: list(OriginNoteSchema),
  remarks: list(z.preprocess((v) => (v == null ? '' : String(v)), z.string())),
});
export type PackingDoc = z.infer<typeof PackingDocSchema>;
export type PackingLine = z.infer<typeof PackingLineSchema>;

/* ---------- Bill of lading ---------- */
export const ContainerSchema = obj({
  numberPrinted: str, // as originally printed (even if struck through)
  numberHandwritten: str, // handwritten correction if any
  handwrittenLegible: bool,
  seal: str,
  sizeType: str, // e.g. "1 X 20'GP"
});
export type ContainerRef = z.infer<typeof ContainerSchema>;

export const BolDocSchema = obj({
  blNumber: str,
  carrierName: str,
  carrierScac: str, // SCAC of the party issuing this (house) B/L
  masterBl: str,
  oceanCarrierName: str,
  oceanCarrierScac: str,
  bookingNo: str,
  shipper: PartySchema,
  consignee: PartySchema,
  notifyParty: PartySchema,
  vessel: str,
  voyage: str,
  placeOfReceipt: str,
  portOfLoading: str,
  portOfDischarge: str,
  placeOfDelivery: str,
  containers: list(ContainerSchema),
  packages: num,
  packageUnit: str,
  grossWeightKg: num,
  measurementCbm: num,
  descriptionOfGoods: str,
  hsCodes: list(z.preprocess((v) => (v == null ? '' : String(v)), z.string())),
  invoiceRef: str,
  poRef: str,
  madeIn: str,
  freightTerms: str,
  issueDateRaw: str,
  issueDateIso: str,
  shippedOnBoardIso: str,
  releaseNote: str, // e.g. "TELEX RELEASED 25-SEP-2026"
  isfFiledBy: str,
  amsFiledBy: str,
  handwrittenNotes: list(z.preprocess((v) => (v == null ? '' : String(v)), z.string())),
});
export type BolDoc = z.infer<typeof BolDocSchema>;

/* ---------- One extraction per uploaded file ---------- */
export const DOC_TYPES = ['commercial_invoice', 'packing_list', 'bill_of_lading', 'unknown'] as const;
export const ExtractionSchema = z.object({
  fileName: z.string().default(''),
  documentType: z.preprocess((v) => (DOC_TYPES.includes(v as never) ? v : 'unknown'), z.enum(DOC_TYPES)),
  extractionNotes: list(z.preprocess((v) => (v == null ? '' : String(v)), z.string())),
  invoice: z.preprocess((v) => (v && typeof v === 'object' ? v : null), InvoiceDocSchema.nullable()),
  packingList: z.preprocess((v) => (v && typeof v === 'object' ? v : null), PackingDocSchema.nullable()),
  billOfLading: z.preprocess((v) => (v && typeof v === 'object' ? v : null), BolDocSchema.nullable()),
});
export type Extraction = z.infer<typeof ExtractionSchema>;
