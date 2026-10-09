# Entry prep: shipping documents to a NetCHB entry draft

Upload a commercial invoice, packing list and bill of lading. The app reads them with Gemini, cross-checks them, builds the XML for NetCHB's `uploadEntry` web service, validates that XML against NetCHB's published `entry.xsd`, and lists what still needs a person.

TypeScript throughout: Express API, React UI, Gemini for reading documents.

![status](https://img.shields.io/badge/tests-19%20passing-brightgreen) ![schema](https://img.shields.io/badge/sample%20XML-passes%20entry.xsd-blue)

## Quick start (Windows, macOS or Linux)

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env       # on Windows Command Prompt: copy .env.example .env
```

Open `.env` and set `GEMINI_API_KEY`. Then list the models your key can use and pick one:

```bash
npm run models             # prints model names; choose a "flash" model
```

Put the name in `GEMINI_MODEL` in `.env`, then start the app:

```bash
npm run dev                # UI: http://localhost:5173   API: http://localhost:8787
npm test                   # 19 tests
```

**No API key?** Click **Try the sample shipment**. It uses `fixtures/sample-extractions.json` (a hand transcription of the three sample documents) and runs the same checks and XML builder, with no model call.

To serve everything from one process: `npm run build && npm start`.

## What you get

For the sample shipment (see `sample-output/`):

- `sample-entry.xml`: the generated entry, which passes `entry.xsd`.
- `sample-findings.md`: 27 findings, sorted into **fix before filing** (4), **review** (10) and **good to know** (13).

## How it works

```
upload ──► Gemini (one call per file; reads PDFs and scans directly; returns JSON)
              │  Zod validates and coerces the reply
              ▼
        analyze()  deterministic code, no model: merge, reconcile, cross-check, findings
              │
              ▼
        buildEntryXml() ──► xmllint-wasm checks it against schemas/entry.xsd
```

- **The model only reads; code decides.** The prompt tells Gemini to copy values exactly as printed and never to correct them. Arithmetic, check digits, origin rules and which figure to trust are plain TypeScript in `server/src/domain/analyze.ts`, so they are testable and explainable.
- **Two-step API.** `/api/extract` is slow (model calls) and runs once. `/api/entry` is a pure function of `(extractions, broker inputs)`, so editing a field in the UI rebuilds the XML instantly with no model call.
- **The real schema.** `schemas/entry.xsd` and `schemas/data_type.xsd` are NetCHB's published upload schemas. `entry.original.xsd` is the untouched download; the working copy only points its import at the local `data_type.xsd`.
- **Resilient model calls.** Busy-model errors (429, 500, 502, 503, 504) are retried with growing waits, at most two calls run at once, and `GEMINI_FALLBACK_MODELS` names backups to try if the main model stays unavailable.

## What it checks

Invoice number against NetCHB's pattern; line amount vs quantity x price vs invoice total; quantities per style across invoice and packing list; carton, weight and volume totals; fibre content across documents; container number ISO 6346 check digit and handwritten corrections; line-level country of origin; free samples; buyer-supplied materials (possible assist); and the items the documents never contain (importer tax ID, bond, 10-digit HTSUS code, manufacturer ID). It also mirrors NetCHB's own warnings (generic or duplicate descriptions, weight-to-value ratio).

## Decisions worth knowing about

- When a line amount disagrees with quantity x price, the app uses the figure that makes the invoice's own totals work, and says so. It never changes a value silently.
- The assist (buyer-supplied fabric) is flagged but **not** added to value by default. A checkbox applies it.
- Unknown values are left out and flagged, not invented. Assumptions (entry type 01, importer = buyer, processing port = entry port, entry date = estimated arrival) are listed as findings.
- Duties are not calculated; NetCHB does that from tariff codes unless an entry is flagged precalculated.
- The XML never contains a `transmit` tag, so uploading it sends nothing to CBP.

## What is verified, and what is not

**Verified**
- The XML for the sample shipment passes NetCHB's `entry.xsd`; the same schema check runs inside the app on every build.
- 19 automated tests (sample shipment behaviour, retry logic, helpers); type-check and production build pass.
- Gemini read the real scanned bill of lading live, including the stamps and the handwritten container correction.

**Not verified or limited**
- **Live extraction of all three documents.** On the first attempt the invoice and packing list were blocked by Gemini "high demand" (503) errors, not by parsing. Retries and fallback models were added after that. Run your own PDFs and check the result before relying on it; extraction accuracy has not been measured on more than this one shipment.
- **Submission to NetCHB.** Needs broker credentials. The WSDL shows `uploadEntry(username, password, entryXml)`; this tool stops at generating and validating the XML.
- **Port codes.** Only Tacoma (3002) was checked against a published source (FDA's port list). The other codes in `server/src/domain/ports.ts` are from memory and flagged as guesses in the UI.
- **Some field meanings** (for example header `charges`) follow common customs practice, not NetCHB documentation. A broker should confirm them.
- **Tariff codes.** The documents only give 6-digit HS codes. The entry carries them as printed and flags that 10-digit HTSUS codes are needed.

## Troubleshooting

- **Browser says it cannot connect:** `npm run dev` must still be running. Do not press Ctrl+C in that terminal.
- **"model is no longer available":** run `npm run models` and set `GEMINI_MODEL` to a name from the list. Restart after editing `.env`.
- **503 "high demand":** wait a minute and upload again; the app already retries and tries `GEMINI_FALLBACK_MODELS`.
- **Your `.env` seems ignored:** it must sit in the project root (next to `package.json`). The server loads it from there regardless of where it starts.
- **Never commit `.env`.** It is in `.gitignore`.

## With more time

HTSUS lookup with suggested 10-digit codes and units (shown only as suggestions); manufacturer ID derivation and CBP MID lookup; port codes from an official table; extraction accuracy measured on many document layouts, with per-field confidence; multiple packing lists and bills of lading; additional-duty rules by origin; sending to `uploadEntry` behind an explicit confirmation.

## Layout

```
shared/        Zod schemas (what the model must return) and result types, used by both sides
server/        Express API, extraction, analysis, XML builder, XSD check, tests
web/           React UI
schemas/       NetCHB entry.xsd and data_type.xsd
fixtures/      hand-transcribed sample extraction
sample-output/ generated XML and findings for the sample shipment
ai-history/    exported AI chats and an index (see below)
WRITEUP.md     one-page writeup
```

## How AI was used

Most of this code was written with Claude (planning, schema analysis, code, tests), directed and run by me. A second, simpler version was built with Gemini (Next.js) and compared against this one; its XML failed NetCHB's schema in four places, which is why this version was kept.