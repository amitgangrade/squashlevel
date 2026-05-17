import { isValidCityName, normalizeCountry } from './places'

/**
 * Boast signs in via Google only (2026-05-17). The auth flow will
 * never produce a session for a non-Google account, so any stub
 * registered with a non-Gmail email could never claim itself — the
 * `ensure_player_for_profile` email match in onboarding won't fire.
 * Both `gmail.com` and `googlemail.com` are accepted because they
 * route to the same Google mailbox (and `norm_email` canonicalises
 * them to the same key on the server). When we add more providers,
 * flip this off — the constraint is intentionally narrow rather
 * than a generic configurable allow-list.
 */
export function isSupportedSigninEmail(email: string): boolean {
  return /@(?:gmail|googlemail)\.com$/i.test(email.trim())
}

export const SIGNIN_EMAIL_HINT =
  'Boast signs in via Google — only @gmail.com / @googlemail.com addresses work today.'

export const SIGNIN_EMAIL_ERROR =
  'Email must be @gmail.com or @googlemail.com. Boast signs in via Google, so other providers can\'t claim the account.'

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
