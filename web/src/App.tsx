import { useEffect, useRef, useState } from 'react';
import type { Extraction } from '../../shared/extraction';
import type { BrokerInputs, EntryResult, Issue, LineView } from '../../shared/result';
import { buildEntry, extractFiles, getHealth, getSample } from './api';

const TYPE_LABEL: Record<string, string> = {
  commercial_invoice: 'Commercial invoice',
  packing_list: 'Packing list',
  bill_of_lading: 'Bill of lading',
  unknown: 'Not recognised',
};
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function App() {
  const [extractions, setExtractions] = useState<Extraction[] | null>(null);
  const [inputs, setInputs] = useState<BrokerInputs>({});
  const [result, setResult] = useState<EntryResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [health, setHealth] = useState<{ geminiConfigured: boolean; model: string } | null>(null);
  const [isSample, setIsSample] = useState(false);

  useEffect(() => { getHealth().then(setHealth).catch(() => setHealth(null)); }, []);

  // Rebuild the entry whenever the documents or the broker's inputs change (fast: no model call).
  useEffect(() => {
    if (!extractions) return;
    const t = setTimeout(() => {
      buildEntry(extractions, inputs).then(setResult).catch((e: Error) => setError(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [extractions, inputs]);

  const reset = () => { setExtractions(null); setResult(null); setInputs({}); setError(null); setNotes([]); setIsSample(false); };

  async function onFiles(files: File[]) {
    if (!files.length) return;
    setError(null); setNotes([]); setBusy(`Reading ${files.length} document${files.length > 1 ? 's' : ''}…`);
    try {
      const r = await extractFiles(files);
      setExtractions(r.extractions); setNotes(r.errors); setIsSample(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function useSample() {
    setError(null); setBusy('Loading the sample shipment…');
    try { const r = await getSample(); setExtractions(r.extractions); setIsSample(true); setNotes([]); }
    catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }

  const patch = (p: Partial<BrokerInputs>) => setInputs((prev) => ({ ...prev, ...p }));
  const patchLine = (key: string, p: { hts?: string; mid?: string; origin?: string }) =>
    setInputs((prev) => ({ ...prev, lines: { ...prev.lines, [key]: { ...prev.lines?.[key], ...p } } }));

  return (
    <div className="shell">
      <header className="top">
        <div>
          <h1>Entry prep</h1>
          <p className="lede">Upload the commercial invoice, packing list and bill of lading. Get a NetCHB entry draft and a list of what still needs a person.</p>
        </div>
        {extractions && <button className="ghost" onClick={reset}>Start over</button>}
      </header>

      {error && <div className="banner error" role="alert">{error}</div>}
      {notes.length > 0 && <div className="banner warn">{notes.map((n) => <div key={n}>{n}</div>)}</div>}

      {!extractions ? (
        <Landing busy={busy} health={health} onFiles={onFiles} onSample={useSample} />
      ) : (
        <>
          {isSample && <div className="banner note">This is the sample shipment from the assignment, transcribed by hand. No AI model was called.</div>}
          <main className="work">
            <section className="col inputs" aria-label="Documents and missing details">
              <Documents result={result} extractions={extractions} />
              <MissingDetails inputs={inputs} patch={patch} />
              <LineTable lines={result?.summary.lines ?? []} inputs={inputs} patchLine={patchLine} />
            </section>
            <section className="col findings" aria-label="Findings">
              <Findings issues={result?.issues ?? []} loading={!result} />
            </section>
            <section className="col xml" aria-label="Entry XML">
              <XmlPane result={result} />
            </section>
          </main>
        </>
      )}
    </div>
  );
}

/* ---------- Landing ---------- */
function Landing({ busy, health, onFiles, onSample }: { busy: string | null; health: { geminiConfigured: boolean; model: string } | null; onFiles: (f: File[]) => void; onSample: () => void }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="landing">
      <div
        className={`drop${over ? ' over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(Array.from(e.dataTransfer.files)); }}
      >
        <p className="drop-title">{busy ?? 'Drop your shipment documents here'}</p>
        <p className="muted">PDF, PNG or JPEG. Scans, stamps and handwriting are fine. Any order, up to 8 files.</p>
        <div className="row">
          <button className="primary" disabled={!!busy || health?.geminiConfigured === false} onClick={() => input.current?.click()}>Choose files</button>
          <button className="ghost" disabled={!!busy} onClick={onSample}>Try the sample shipment</button>
        </div>
        <input ref={input} type="file" multiple accept="application/pdf,image/png,image/jpeg,image/webp" hidden onChange={(e) => onFiles(Array.from(e.target.files ?? []))} />
        {health?.geminiConfigured === false && <p className="muted small">Add GEMINI_API_KEY to your .env file to read your own documents. The sample works without it.</p>}
        {health === null && <p className="muted small">The server is not reachable. Start it with npm run dev.</p>}
      </div>
    </div>
  );
}

/* ---------- Left column ---------- */
function Documents({ result, extractions }: { result: EntryResult | null; extractions: Extraction[] }) {
  const docs = result?.summary.documents ?? extractions.map((e) => ({ fileName: e.fileName, type: e.documentType }));
  const s = result?.summary;
  return (
    <div className="card">
      <h2>Documents</h2>
      <ul className="docs">
        {docs.map((d) => (
          <li key={d.fileName}><span className={`dot ${d.type === 'unknown' ? 'bad' : 'ok'}`} /><div><div>{TYPE_LABEL[d.type] ?? d.type}</div><div className="muted small">{d.fileName}</div></div></li>
        ))}
      </ul>
      {s && (
        <dl className="facts">
          <dt>Importer</dt><dd>{s.importer || '—'}</dd>
          <dt>Seller</dt><dd>{s.seller || '—'}</dd>
          <dt>Deliver to</dt><dd>{s.shipTo || '—'}</dd>
          <dt>Vessel</dt><dd>{s.vessel} {s.voyage}</dd>
          <dt>Route</dt><dd>{s.portOfLoading} to {s.portOfDischarge}</dd>
          <dt>Container</dt><dd className="mono">{s.container || '—'}</dd>
          <dt>Entered value</dt><dd>${money(s.enteredValueTotal)}</dd>
        </dl>
      )}
    </div>
  );
}

function Field({ label, hint, value, onChange, placeholder }: { label: string; hint?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function MissingDetails({ inputs, patch }: { inputs: BrokerInputs; patch: (p: Partial<BrokerInputs>) => void }) {
  return (
    <div className="card">
      <h2>What the documents don't say</h2>
      <p className="muted small">The broker supplies these. The entry updates as you type.</p>
      <Field label="Importer tax ID" placeholder="12-3456789" value={inputs.importerTaxId ?? ''} onChange={(v) => patch({ importerTaxId: v })} />
      <div className="two">
        <Field label="Bond type" placeholder="08" value={inputs.bondType ?? ''} onChange={(v) => patch({ bondType: v })} />
        <Field label="Surety code" placeholder="123" value={inputs.suretyCode ?? ''} onChange={(v) => patch({ suretyCode: v })} />
      </div>
      <div className="two">
        <Field label="Entry type" placeholder="01" value={inputs.entryType ?? ''} onChange={(v) => patch({ entryType: v })} />
        <Field label="Entry port" placeholder="3002" value={inputs.entryPort ?? ''} onChange={(v) => patch({ entryPort: v })} />
      </div>
      <Field label="Entry date" placeholder="2026-10-14" value={inputs.entryDate ?? ''} onChange={(v) => patch({ entryDate: v })} />
      <label className="check">
        <input type="checkbox" checked={!!inputs.applyAssistToValue} onChange={(e) => patch({ applyAssistToValue: e.target.checked })} />
        <span>Add buyer-supplied material (assist) to the blouse value</span>
      </label>
    </div>
  );
}

function LineTable({ lines, inputs, patchLine }: { lines: LineView[]; inputs: BrokerInputs; patchLine: (k: string, p: { hts?: string; mid?: string; origin?: string }) => void }) {
  if (!lines.length) return null;
  return (
    <div className="card">
      <h2>Lines</h2>
      <p className="muted small">Tariff codes need 10 digits. Each producer needs a manufacturer ID.</p>
      <div className="lines">
        {lines.map((l) => (
          <div className="line" key={l.key}>
            <div className="line-head">
              <strong>{l.styleNo}</strong>
              <span className="muted small">${money(l.enteredValue)} · {l.quantity ?? '?'} {l.unit} · origin {l.origin || '?'}</span>
            </div>
            <div className="muted small clip" title={l.description}>{l.description}</div>
            <div className="two">
              <Field label={`Tariff code (printed ${l.hsPrinted || 'none'})`} placeholder="10 digits" value={inputs.lines?.[l.key]?.hts ?? ''} onChange={(v) => patchLine(l.key, { hts: v })} />
              <Field label="Manufacturer ID" placeholder="MID" hint={l.manufacturerName} value={inputs.lines?.[l.key]?.mid ?? ''} onChange={(v) => patchLine(l.key, { mid: v })} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Middle column ---------- */
function Findings({ issues, loading }: { issues: Issue[]; loading: boolean }) {
  if (loading) return <div className="card"><h2>Findings</h2><p className="muted">Checking the documents…</p></div>;
  const by = (s: Issue['severity']) => issues.filter((i) => i.severity === s);
  const b = by('blocker'), r = by('review'), n = by('info');
  const summary = [
    b.length ? `${b.length} to fix before filing` : 'Nothing blocks filing',
    `${r.length} to review`,
    `${n.length} notes`,
  ].join(', ');
  return (
    <div className="card flush">
      <div className="pad"><h2>Findings</h2><p className="summary">{summary}.</p></div>
      <Group title="Fix before filing" tone="blocker" items={b} open />
      <Group title="Review" tone="review" items={r} open />
      <Group title="Good to know" tone="info" items={n} />
    </div>
  );
}

function Group({ title, tone, items, open }: { title: string; tone: Issue['severity']; items: Issue[]; open?: boolean }) {
  if (!items.length) return null;
  return (
    <div className="group">
      <h3 className={tone}>{title}</h3>
      {items.map((i) => (
        <details key={i.id} className={`issue ${tone}`} open={open && tone === 'blocker'}>
          <summary>{i.title}</summary>
          <p>{i.detail}</p>
          {i.action && <p className="action"><strong>Next:</strong> {i.action}</p>}
          {i.sources.length > 0 && <p className="muted small">From: {i.sources.join(', ')}</p>}
        </details>
      ))}
    </div>
  );
}

/* ---------- Right column ---------- */
function XmlPane({ result }: { result: EntryResult | null }) {
  const [copied, setCopied] = useState(false);
  if (!result) return <div className="card"><h2>Entry XML</h2><p className="muted">Building…</p></div>;
  const ok = result.xsd.valid;
  const copy = async () => { await navigator.clipboard.writeText(result.xml); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([result.xml], { type: 'application/xml' }));
    a.download = 'netchb-entry.xml';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="card flush">
      <div className="pad xml-head">
        <h2>Entry XML</h2>
        <div className="row">
          <button className="ghost" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button className="primary" onClick={download}>Download</button>
        </div>
      </div>
      <div className="pad stamp-row">
        <span className={`stamp ${ok ? 'ok' : 'bad'}`}>{ok ? 'Passes NetCHB schema' : 'Fails NetCHB schema'}</span>
        <span className="muted small">{ok ? 'Checked against entry.xsd. This does not mean the entry is complete.' : `${result.xsd.errors.length} problem${result.xsd.errors.length === 1 ? '' : 's'} found.`}</span>
      </div>
      {!ok && <ul className="errs">{result.xsd.errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>}
      <pre className="code" tabIndex={0}><code>{result.xml}</code></pre>
    </div>
  );
}
