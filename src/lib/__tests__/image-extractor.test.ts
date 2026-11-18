/**
 * image-extractor tests.
 *
 * `extractImagePlaceholders(text, pageNumber)` should detect "Figure X"
 * mentions (case-insensitive, supports "Fig." / "Fig" / "Figure" prefixes),
 * dedupe repeat mentions on the same page, and build a placeholder
 * description that references the page number.
 */
import { test, expect, describe } from 'bun:test'
import { extractImagePlaceholders } from '../image-extractor'

describe('extractImagePlaceholders', () => {
  test('detects "Figure N" mentions and returns one placeholder per unique label', () => {
    const text =
      'As shown in Figure 1, the pipeline has three stages. ' +
      'Figure 1 also has a variant. Figure 2 shows the deployment view.'
    const out = extractImagePlaceholders(text, 5)
    expect(out.length).toBe(2)
    expect(out[0].figureLabel).toBe('Figure 1')
    expect(out[0].pageNumber).toBe(5)
    expect(out[1].figureLabel).toBe('Figure 2')
    expect(out[1].pageNumber).toBe(5)
  })

  test('placeholder description references the page number', () => {
    const out = extractImagePlaceholders('see Figure 3 below', 7)
    expect(out[0].descriptionPlaceholder).toContain('Figure 3')
    expect(out[0].descriptionPlaceholder).toContain('page 7')
  })

  test('supports "Fig." and "Fig" abbreviations (case-insensitive)', () => {
    const out = extractImagePlaceholders('see Fig. 4 and fig 9 for details', 1)
    const labels = out.map((p) => p.figureLabel)
    expect(labels).toContain('Figure 4')
    expect(labels).toContain('Figure 9')
  })

  test('empty input -> []', () => {
    expect(extractImagePlaceholders('', 1)).toEqual([])
    expect(extractImagePlaceholders('No figures mentioned here', 1)).toEqual([])
  })

  test('defaults page number to 1 when not provided', () => {
    const out = extractImagePlaceholders('see Figure 1')
    expect(out[0].pageNumber).toBe(1)
  })

  test('placeholder preview includes a snippet of surrounding text', () => {
    const out = extractImagePlaceholders(
      'Long preamble about the experiment. As shown in Figure 5, results improve. Continued text follows.',
      2,
    )
    expect(out[0].descriptionPlaceholder).toContain('shown')
    expect(out[0].descriptionPlaceholder).toContain('results')
  })

  test('does not pick up "Figure" without a number', () => {
    const out = extractImagePlaceholders('Figure without number. Figure 1 real.', 1)
    expect(out.length).toBe(1)
    expect(out[0].figureLabel).toBe('Figure 1')
  })
})
