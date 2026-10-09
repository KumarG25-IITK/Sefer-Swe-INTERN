/**
 * US Schedule D port codes. Only Tacoma (3002) was verified against a published source while building this
 * (FDA's Washington ports-of-entry page). The others are from memory: treat them as suggestions and confirm.
 */
export interface UsPort { code: string; name: string; match: RegExp; verified: boolean }
export const US_PORTS: UsPort[] = [
  { code: '3002', name: 'Tacoma, WA', match: /TACOMA/i, verified: true },
  { code: '3001', name: 'Seattle, WA', match: /SEATTLE/i, verified: false },
  { code: '2704', name: 'Los Angeles/Long Beach, CA', match: /LOS ANGELES|LONG BEACH/i, verified: false },
  { code: '2809', name: 'Oakland, CA', match: /OAKLAND/i, verified: false },
  { code: '4601', name: 'New York/Newark, NY/NJ', match: /NEW YORK|NEWARK/i, verified: false },
  { code: '1703', name: 'Savannah, GA', match: /SAVANNAH/i, verified: false },
  { code: '5301', name: 'Houston, TX', match: /HOUSTON/i, verified: false },
  { code: '1601', name: 'Charleston, SC', match: /CHARLESTON/i, verified: false },
  { code: '1401', name: 'Norfolk, VA', match: /NORFOLK/i, verified: false },
];

export function lookupUsPort(text: string | null | undefined): UsPort | null {
  if (!text) return null;
  return US_PORTS.find((p) => p.match.test(text)) ?? null;
}
