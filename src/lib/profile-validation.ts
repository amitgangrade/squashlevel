import { isValidCityName, normalizeCountry } from './places'

export interface ProfileFieldDraft {
  birthYear?: string
  country?: string
  city?: string
}

export interface ProfileFieldsParsed {
  birthYear?: number
  country?: string
  city?: string
}

/**
 * Validates the optional country / city / year-of-birth fields shared by
 * onboarding, profile edit, and the admin roster form. Returns the parsed
 * values on success or a single user-facing error message on failure.
 *
 * Empty inputs are treated as "not provided" and pass validation.
 */
export function parseProfileFields(
  draft: ProfileFieldDraft,
): { ok: true; values: ProfileFieldsParsed } | { ok: false; error: string } {
  const out: ProfileFieldsParsed = {}

  const yearStr = draft.birthYear?.trim() ?? ''
  if (yearStr) {
    const y = Number(yearStr)
    const thisYear = new Date().getFullYear()
    if (!Number.isInteger(y) || y < 1900 || y > thisYear) {
      return { ok: false, error: `Year of birth must be between 1900 and ${thisYear}` }
    }
    out.birthYear = y
  }

  const countryStr = draft.country?.trim() ?? ''
  if (countryStr) {
    const c = normalizeCountry(countryStr)
    if (!c) {
      return {
        ok: false,
        error: `"${countryStr}" is not a recognized country. Please pick one from the list.`,
      }
    }
    out.country = c
  }

  const cityStr = draft.city?.trim() ?? ''
  if (cityStr) {
    if (!isValidCityName(cityStr)) {
      return {
        ok: false,
        error: 'City name looks invalid. Use letters, spaces, hyphens or apostrophes.',
      }
    }
    out.city = cityStr
  }

  return { ok: true, values: out }
}
