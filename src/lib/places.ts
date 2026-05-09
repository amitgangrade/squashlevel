/**
 * Country list (ISO 3166-1 English short names) + helpers to validate and
 * normalize free-text country/city/club inputs across onboarding, profile,
 * and roster forms.
 *
 * Goals:
 * - Country must be a real country — typed value matches the canonical list.
 * - City accepts anything reasonable (letters, spaces, hyphens, apostrophes…)
 *   but rejects garbage like "asdf123".
 * - Club autocompletes from values already in the database to discourage
 *   typo-driven duplicates ("SCC" vs "S.C.C." vs "Scc Club").
 */

export const COUNTRIES: string[] = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
  'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria',
  'Burkina Faso', 'Burundi', 'Cambodia', 'Cameroon', 'Canada', 'Cape Verde',
  'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros',
  'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark',
  'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador',
  'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji',
  'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece',
  'Grenada', 'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras',
  'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland',
  'Israel', 'Italy', 'Ivory Coast', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan',
  'Kenya', 'Kiribati', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon',
  'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau',
  'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands',
  'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia',
  'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal',
  'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea',
  'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama',
  'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal',
  'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
  'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe',
  'Saudi Arabia', 'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore',
  'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa', 'South Korea',
  'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland',
  'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo',
  'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Tuvalu',
  'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States',
  'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam',
  'Yemen', 'Zambia', 'Zimbabwe',
]

const COUNTRY_INDEX = new Map<string, string>(
  COUNTRIES.map((c) => [c.toLowerCase(), c]),
)

// Common aliases users actually type.
const COUNTRY_ALIASES: Record<string, string> = {
  'usa': 'United States',
  'us': 'United States',
  'u.s.': 'United States',
  'u.s.a.': 'United States',
  'america': 'United States',
  'united states of america': 'United States',
  'uk': 'United Kingdom',
  'u.k.': 'United Kingdom',
  'great britain': 'United Kingdom',
  'britain': 'United Kingdom',
  'england': 'United Kingdom',
  'scotland': 'United Kingdom',
  'wales': 'United Kingdom',
  'northern ireland': 'United Kingdom',
  'uae': 'United Arab Emirates',
  'south korea': 'South Korea',
  'korea': 'South Korea',
  'russia': 'Russia',
  'czechia': 'Czech Republic',
  'côte d\'ivoire': 'Ivory Coast',
  'cote d\'ivoire': 'Ivory Coast',
  'burma': 'Myanmar',
  'cape verde': 'Cape Verde',
  'cabo verde': 'Cape Verde',
  'swaziland': 'Eswatini',
  'east timor': 'Timor-Leste',
  'macedonia': 'North Macedonia',
  'holy see': 'Vatican City',
  'vatican': 'Vatican City',
}

/**
 * Normalize a free-text country to its canonical name. Returns `null` when
 * the input doesn't match any known country (caller should reject and ask
 * the user to pick from the suggestion list).
 */
export function normalizeCountry(input: string): string | null {
  const t = input.trim().toLowerCase()
  if (!t) return null
  if (COUNTRY_INDEX.has(t)) return COUNTRY_INDEX.get(t)!
  if (COUNTRY_ALIASES[t]) return COUNTRY_ALIASES[t]
  return null
}

// Letters (any script), spaces, hyphens, apostrophes, periods, commas.
// 2–80 chars. Rejects "asdf123", emoji-only, etc.
const PLACE_NAME_RE = /^[\p{L}][\p{L}\p{M}\s'\-.,]{1,79}$/u

export function isValidCityName(input: string): boolean {
  const t = input.trim()
  return PLACE_NAME_RE.test(t)
}

/**
 * Distinct, sorted, non-empty values for a given player field. Used to seed
 * <datalist> autocomplete so users converge on existing entries instead of
 * coining slight typo variants.
 */
export function distinctValues<T extends { club?: string; city?: string; country?: string }>(
  players: T[],
  field: 'club' | 'city' | 'country',
): string[] {
  const seen = new Map<string, string>() // key = lowercased, value = first-seen casing
  for (const p of players) {
    const v = (p[field] ?? '').trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (!seen.has(key)) seen.set(key, v)
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b))
}
