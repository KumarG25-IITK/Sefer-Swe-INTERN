# Writeup

## What I built
A web app that reads a commercial invoice, packing list and bill of lading with Gemini and produces an entry XML for NetCHB's `uploadEntry` service. The XML is checked against NetCHB's published `entry.xsd`, and a findings list says what to fix, review, or note. Duties are not calculated and nothing is sent to customs.

## How I found the format
The docs page I could reach only linked the status-query schema, which is a different file. The WSDL showed the entry travels as an XML string, so the schema is not in the WSDL. I ruled out the page source, the Network tab and Wayback, then tested guessed URLs and found the upload schema one folder over (`/xml/entry/entry.xsd`). It imports `data_type.xsd` (the field patterns); every entry is validated against both.

## Key decisions
1. **The model reads; code decides.** Gemini copies values as printed. Reconciliation, check digits, origin and value rules are deterministic code with tests.
2. **Never silently correct.** Where documents disagree, the app applies a documented default and says so.
3. **Unknown means flagged, not guessed.** Importer tax ID, bond, 10-digit tariff codes and manufacturer IDs are not in the documents, so the app asks for them.

## What the sample shipment contained
The documents carry deliberate problems, and the app flags each: a mistyped line amount (6,480 printed; 2,400 x 2.85 = 6,840, which the invoice total needs); a handwritten container correction (the printed number fails the ISO 6346 check, the correction passes); 1,200 hoodies invoiced vs 1,176 packed, hidden because the totals offset the free samples; "TC 65/35" on the packing list vs 60/40 cotton-polyester on the invoice; free samples made in Bangladesh in a shipment declared Vietnam; buyer-supplied fabric (a possible assist); 1,930 kg on the bill of lading vs 1,888 kg packed; and an invoice number with slashes that NetCHB's pattern rejects.

## Checking my own work
I built a second, simpler version with Gemini (one call for all documents, no schema check) and compared the two. Run through NetCHB's schema, its XML failed in four places, and it flagged none of the planted problems above. I also checked Gemini's written comparison against both codebases; several of its claims were wrong.

## What I did not do or could not verify
- **Live extraction on all three PDFs.** Gemini read the real scanned bill of lading, handwriting included. On my first attempt the invoice and packing list hit "high demand" errors, so I added retries and backup models. Accuracy beyond this one shipment is unmeasured.
- **Submission to NetCHB**, which needs broker credentials.
- **Port codes** other than Tacoma, which come from memory and are flagged in the app.
- **A few field meanings** follow customs practice, not NetCHB's docs.
The 19 tests and the schema pass use a hand transcription of the documents, so they reproduce without an API key.

## How I used AI
I worked with Claude to plan, analyse the documents and schema, and write the code and tests, and used Gemini for reading documents inside the app and for the comparison version. I ran everything, tested guessed URLs, reported failures, and decided what to keep.