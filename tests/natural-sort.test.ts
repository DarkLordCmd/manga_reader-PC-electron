import { describe, it, expect } from 'vitest'
import { naturalCompare } from '../src/main/services/natural-sort'

describe('naturalCompare', () => {
  it('orders numeric chunks numerically', () => {
    const files = ['page10.jpg', 'page2.jpg', 'page1.jpg']
    expect([...files].sort(naturalCompare)).toEqual(['page1.jpg', 'page2.jpg', 'page10.jpg'])
  })
  it('handles mixed alpha-numeric', () => {
    expect(naturalCompare('ch1_2', 'ch1_10')).toBeLessThan(0)
  })
})