import { describe, expect, it } from 'vitest'
import { explainPreview } from '../explain'

const base = {
  levelA: 1500,
  levelB: 1500,
  preview: { deltaA: 12, deltaB: -12, expected: 0.5, actual: 0.62 },
  matchType: 'friendly' as const,
  provisionalA: false,
  provisionalB: false,
  playerAName: 'Amit',
  playerBName: 'Rochit',
}

describe('explainPreview', () => {
  it('flags a no-change outcome explicitly', () => {
    const lines = explainPreview({
      ...base,
      preview: { deltaA: 0, deltaB: 0, expected: 0.71, actual: 0.71 },
    })
    expect(lines[0]).toMatch(/matched the prediction/i)
    expect(lines[0]).toContain('71%')
  })

  it('credits the over-performer when actual beats expected', () => {
    const lines = explainPreview(base)
    expect(lines[0]).toMatch(/larger share/i)
    expect(lines[0]).toContain('Amit')
    expect(lines[0]).toContain('62%')
    expect(lines[0]).toContain('50%')
  })

  it('credits the opponent when actual is below expected', () => {
    const lines = explainPreview({
      ...base,
      preview: { deltaA: -8, deltaB: 8, expected: 0.7, actual: 0.4 },
    })
    expect(lines[0]).toMatch(/smaller share/i)
    expect(lines[0]).toMatch(/Rochit.*rises/i)
  })

  it('mentions tournament weighting as larger than friendly', () => {
    const lines = explainPreview({ ...base, matchType: 'tournament' })
    expect(lines.some((l) => /tournament/i.test(l) && /largest/i.test(l))).toBe(true)
  })

  it('contrasts a friendly to a hypothetical tournament', () => {
    const lines = explainPreview(base)
    expect(lines.some((l) => /friendly/i.test(l) && /tournament/i.test(l))).toBe(true)
  })

  it('notes when only one side is provisional, naming the locked side', () => {
    const lines = explainPreview({ ...base, provisionalA: true })
    expect(lines.some((l) => /Amit is provisional/i.test(l) && /Rochit/.test(l))).toBe(true)
  })

  it('omits the provisional caveat when neither side is provisional', () => {
    const lines = explainPreview(base)
    expect(lines.some((l) => /provisional/i.test(l))).toBe(false)
  })

  it('omits the provisional caveat when both sides are provisional', () => {
    const lines = explainPreview({ ...base, provisionalA: true, provisionalB: true })
    expect(lines.some((l) => /provisional/i.test(l))).toBe(false)
  })
})
