/**
 * Address suggestions as you type, from Photon (https://photon.komoot.io), a
 * free geocoder built on OpenStreetMap data. What the owner types is sent to
 * that public service; the dashboard says so next to the search box.
 */

export const PHOTON_URL = "https://photon.komoot.io/api/";

export interface AddressSuggestion {
  /** One line for the dropdown. */
  label: string;
  /** Mailing-address lines to fill in. */
  lines: string[];
  /** True when the result has no house number (only the street was found). */
  needsNumber: boolean;
}

type FetchLike = (url: string, init: { headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY", "Puerto Rico": "PR",
};

interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  town?: string;
  village?: string;
  district?: string;
  locality?: string;
  state?: string;
  postcode?: string;
  country?: string;
  countrycode?: string;
  type?: string;
}

/** Turns one Photon result into address lines. `typedNumber` fills a missing house number with what the owner typed. */
export function toSuggestion(p: PhotonProps, typedNumber: string | null): AddressSuggestion | null {
  const street = p.street ?? (p.type === "street" ? p.name : undefined);
  const city = p.city ?? p.town ?? p.village ?? p.locality ?? p.district;
  if (!street && !p.name) return null;
  if (!city && !p.postcode) return null;
  const number = p.housenumber ?? (street ? typedNumber : null);
  const line1 = street ? [number, street].filter(Boolean).join(" ") : (p.name as string);
  const isUS = (p.countrycode ?? "").toUpperCase() === "US";
  const state = p.state ? (isUS ? (US_STATES[p.state] ?? p.state) : p.state) : "";
  const line2 = [city, [state, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const lines = [line1, line2];
  if (!isUS && p.country) lines.push(p.country);
  // A named place (shop, building) with a street: put the street address first and the name above it.
  if (p.name && street && p.name !== street && p.type === "house" && !p.housenumber) lines.unshift(p.name);
  return { label: lines.join(", "), lines, needsNumber: !number && Boolean(street) };
}

export class AddressSearch {
  private readonly cache = new Map<string, { at: number; results: AddressSuggestion[] }>();

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly now: () => number = () => Date.now(),
  ) {}

  async suggest(query: string): Promise<AddressSuggestion[]> {
    const q = query.trim().replace(/\s+/g, " ");
    if (q.length < 4) return [];
    const key = q.toLowerCase();
    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < 10 * 60_000) return hit.results;

    const url = `${PHOTON_URL}?${new URLSearchParams({ q, limit: "6", lang: "en" }).toString()}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    let data: { features?: Array<{ properties?: PhotonProps }> };
    try {
      const res = await this.fetchImpl(url, { headers: { Accept: "application/json", "User-Agent": "agent-dashboard (self-hosted)" }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = (await res.json()) as typeof data;
    } finally {
      clearTimeout(timer);
    }
    const typedNumber = /^(\d+[A-Za-z]?)\b/.exec(q)?.[1] ?? null;
    const seen = new Set<string>();
    const results: AddressSuggestion[] = [];
    for (const f of data.features ?? []) {
      const s = f.properties ? toSuggestion(f.properties, typedNumber) : null;
      if (!s || seen.has(s.label)) continue;
      seen.add(s.label);
      results.push(s);
    }
    this.cache.set(key, { at: this.now(), results });
    if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value as string);
    return results;
  }
}
