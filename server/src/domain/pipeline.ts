import type { Extraction } from '../../../shared/extraction';
import type { BrokerInputs, EntryResult, EntrySummary } from '../../../shared/result';
import { analyze } from './analyze';
import { buildEntryXml } from './xml';
import { validateAgainstXsd } from './xsd';

/** Pure function of (extractions, broker inputs): re-run it whenever the user edits a field. */
export async function buildEntry(extractions: Extraction[], inputs: BrokerInputs = {}): Promise<EntryResult> {
  const { model, issues, fileTypes } = analyze(extractions, inputs);
  const xml = buildEntryXml(model);
  const xsd = await validateAgainstXsd(xml);
  if (!xsd.valid) {
    issues.unshift({
      id: 'xsd-invalid', severity: 'blocker', title: 'The generated XML does not pass NetCHB\'s schema',
      detail: xsd.errors.slice(0, 3).join(' | '), sources: [], action: 'Fix the values mentioned, or report this as a bug in the tool.',
    });
  }
  const bol = extractions.find((e) => e.billOfLading)?.billOfLading;
  const inv = extractions.find((e) => e.invoice)?.invoice;
  const summary: EntrySummary = {
    documents: fileTypes,
    importer: model.importerName,
    seller: inv?.seller?.name ?? '',
    shipTo: inv?.shipTo?.name ?? bol?.consignee?.name ?? '',
    vessel: model.vesselName,
    voyage: model.voyageNo,
    masterBill: model.manifest ? `${model.manifest.masterScac} ${model.manifest.masterBill}`.trim() : '',
    houseBill: model.manifest ? `${model.manifest.houseScac} ${model.manifest.houseBill}`.trim() : '',
    container: model.containers.map((c) => c.number).join(', '),
    portOfLoading: bol?.portOfLoading ?? inv?.portOfLoading ?? '',
    portOfDischarge: bol?.portOfDischarge ?? inv?.portOfDischarge ?? '',
    entryPort: model.entryPort,
    arrival: model.arrivalDate,
    packages: model.packages,
    grossKg: model.grossKg,
    charges: model.charges,
    enteredValueTotal: model.totalEntryValue,
    lines: model.invoices.flatMap((i) => i.lines),
  };
  return { xml, xsd, issues, summary };
}
