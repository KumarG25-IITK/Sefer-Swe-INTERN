export const EXTRACTION_PROMPT = `You are reading ONE trade document that is part of a US import shipment. It is either a commercial invoice, a packing list, or a bill of lading. It may be a scan with stamps, handwriting and strike-throughs.

Return ONLY a JSON object (no markdown) with this shape:
{
  "documentType": "commercial_invoice" | "packing_list" | "bill_of_lading" | "unknown",
  "extractionNotes": [string],            // anything unclear, illegible, or surprising
  "invoice": null | { ...see INVOICE },
  "packingList": null | { ...see PACKING LIST },
  "billOfLading": null | { ...see BILL OF LADING }
}
Fill only the object that matches documentType; set the other two to null.

RULES
- Copy values exactly as printed. Do NOT recalculate, correct, or "fix" anything. If a line amount looks wrong, report what is printed.
- Use null for anything not on the document. Never guess.
- Numbers must be plain numbers (no currency symbols or thousands separators).
- Keep codes as printed (for example hsCode "6109.10").
- Dates: give the printed text in the *Raw field. Give an ISO date (YYYY-MM-DD) in the *Iso field only when the day and month are unambiguous from the document's own conventions; otherwise null.
- Handwriting, stamps and strike-throughs: record them. For a struck-through printed value with a handwritten replacement, report BOTH, and say in extractionNotes how legible the handwriting is.
- Samples or free-of-charge goods: set isSample / noCommercialValue true and capture any "value for customs purposes" figures.
- Notes about who supplied materials, who made which style, or where goods were made belong in the notes / originNote fields.

INVOICE fields: invoiceNumber, invoiceDateRaw, invoiceDateIso, seller{name,address,country,taxId}, buyer{...}, shipTo{...}, poNumber, incoterm, paymentTerms, currency, portOfLoading, portOfDischarge, vessel, voyage, blNumber, etdRaw, etaRaw, etaIso, countryOfOrigin (declared for the whole invoice), lines[ {lineNo, styleNo, description, composition, hsCode, quantity, unit, unitPrice, amount, isSample, noCommercialValue, customsValueUnit, customsValueTotal, originNote, notes} ], subtotalCarriedForward, totalFob, freight, insurance, totalCif, totalQuantity, totalPackages, assists[ {description, value, currency, reference, appliesToStyle} ] (materials or items the buyer supplied free of charge), notes[]

PACKING LIST fields: packingListNumber, dateRaw, shipper{...}, consignee{...}, invoiceRef, poNumber, vessel, voyage, lines[ {cartonRange, styleNo, description, cartons, pcsPerCarton, totalPcs, netKgPerCarton, grossKgPerCarton, totalNetKg, totalGrossKg, cartonDimensionsCm} ], totalCartons, totalPcs, totalNetKg, totalGrossKg, totalCbm, originNotes[ {styleNo, country, manufacturerName, manufacturerAddress, note} ], remarks[]

BILL OF LADING fields: blNumber, carrierName, carrierScac (issuer of THIS bill), masterBl, oceanCarrierName, oceanCarrierScac, bookingNo, shipper{...}, consignee{...}, notifyParty{...}, vessel, voyage, placeOfReceipt, portOfLoading, portOfDischarge, placeOfDelivery, containers[ {numberPrinted, numberHandwritten, handwrittenLegible, seal, sizeType} ], packages, packageUnit, grossWeightKg, measurementCbm, descriptionOfGoods, hsCodes[], invoiceRef, poRef, madeIn, freightTerms, issueDateRaw, issueDateIso, shippedOnBoardIso, releaseNote, isfFiledBy, amsFiledBy, handwrittenNotes[]
`;
