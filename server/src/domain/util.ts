export const round2 = (n: number) => Math.round(n * 100) / 100;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const normKey = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
export const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function truncateWords(s: string, max: number): string {
  const t = clean(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const i = cut.lastIndexOf(' ');
  return (i > 20 ? cut.slice(0, i) : cut).trim();
}

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** Parse a date as printed. Numeric d/m/y dates with both parts <= 12 are flagged ambiguous (read as DD/MM). */
export function parseDate(raw?: string | null, iso?: string | null): { iso: string | null; ambiguous: boolean } {
  if (iso && /^\d{4}-\d{2}-\d{2}$/.test(iso)) return { iso, ambiguous: false };
  const s = clean(raw);
  if (!s) return { iso: null, ambiguous: false };
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, ambiguous: false };
  m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/,]*(\d{4})/);
  if (m && MONTHS[m[2].toUpperCase()]) return { iso: `${m[3]}-${MONTHS[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`, ambiguous: false };
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12) return { iso: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, ambiguous: false };
    if (b > 12) return { iso: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`, ambiguous: false };
    return { iso: `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`, ambiguous: a !== b };
  }
  return { iso: null, ambiguous: false };
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** Strip container and carton wording that bills of lading put in front of the goods description. */
export function cleanGoodsDescription(s: string | null | undefined): string {
  let t = clean(s);
  t = t.replace(/^\d+\s*X\s*\d+'?\s*\w{0,3}\s+CONTAINER\s*(?:S\.?T\.?C\.?)?\s*:?\s*/i, '');
  t = t.replace(/^\d+\s+(?:CARTONS?|CTNS?|PACKAGES?|PKGS?|PALLETS?)\s+OF\s+/i, '');
  return t.trim();
}
