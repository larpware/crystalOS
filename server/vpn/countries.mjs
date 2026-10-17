/*
 * CrystalOS — the countries a connection can be asked to exit from
 *
 * ## Why a list and not a discovery call
 *
 * Public proxy sources are filtered by ISO-3166 alpha-2 code, and the code is
 * the whole request: `?country=DE` is answered by the source, or it is not. So
 * "which countries can I pick" is a question this file can answer without the
 * network, and answering it offline means the picker never renders from a
 * half-fetched response.
 *
 * ## What the list promises, and what it does not
 *
 * A code in this list means "CrystalOS will ask the sources for a proxy that
 * geolocates to this country". It does **not** promise that one is reachable at
 * the moment you ask: the pool health-tests every candidate, and an empty result
 * is reported as "nothing in <country> answered", never as a silent fallback to
 * another country. Falling back would make the picker a lie — the user asked for
 * a specific exit.
 *
 * The set is the busy half of the world plus the countries the sources actually
 * carry, chosen because a picker with 250 near-empty entries is worse than one
 * with 30 that usually work. An unlisted code is still accepted if it is a
 * well-formed alpha-2 code, so the list is a convenience, not a cage.
 */

/** `{ code, name }` in the order the picker shows them. */
export const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "NL", name: "Netherlands" },
  { code: "SE", name: "Sweden" },
  { code: "CH", name: "Switzerland" },
  { code: "PL", name: "Poland" },
  { code: "ES", name: "Spain" },
  { code: "IT", name: "Italy" },
  { code: "RO", name: "Romania" },
  { code: "RU", name: "Russia" },
  { code: "UA", name: "Ukraine" },
  { code: "TR", name: "Türkiye" },
  { code: "IN", name: "India" },
  { code: "SG", name: "Singapore" },
  { code: "JP", name: "Japan" },
  { code: "KR", name: "South Korea" },
  { code: "HK", name: "Hong Kong" },
  { code: "AU", name: "Australia" },
  { code: "BR", name: "Brazil" },
  { code: "AR", name: "Argentina" },
  { code: "MX", name: "Mexico" },
  { code: "ZA", name: "South Africa" },
  { code: "AE", name: "United Arab Emirates" },
  { code: "ID", name: "Indonesia" },
  { code: "VN", name: "Vietnam" },
  { code: "TH", name: "Thailand" },
  { code: "PH", name: "Philippines" },
];

const BY_CODE = new Map(COUNTRIES.map((entry) => [entry.code, entry]));

/**
 * Validates a country code.
 *
 * Returns the canonical upper-case code, or `null` for "no country asked for".
 * Throws for something that is not an alpha-2 code at all, so a typo is
 * reported rather than quietly turned into a worldwide scan.
 */
export function normaliseCountry(value) {
  if (value === null || value === undefined) return null;
  const code = String(value).trim().toUpperCase();
  if (code === "" || code === "ANY" || code === "ALL" || code === "ANYWHERE") return null;
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error("A country is a two-letter code such as US or DE.");
  }
  return code;
}

/** The display name for a code, falling back to the code itself. */
export function countryName(code) {
  if (!code) return null;
  return BY_CODE.get(String(code).toUpperCase())?.name ?? String(code).toUpperCase();
}

/** The picker's list, incl. a leading "any country" entry. */
export function listCountries() {
  return [{ code: "", name: "Fastest anywhere" }, ...COUNTRIES.map((entry) => ({ ...entry }))];
}
