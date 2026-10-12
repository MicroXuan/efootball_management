import { describe, expect, it, vi } from 'vitest'
import { BANNER_CLEAR_FRAME_DELAY_MS, clearBannerBeforeTabSwitch } from './banner-transition'

describe('league banner tab transition', () => {
  it('does not navigate until the cleared banner has crossed the render boundary', () => {
    let afterClear: (() => void) | undefined
    let afterNextTick: (() => void) | undefined
    let scheduledSwitch: (() => void) | undefined
    const continueSwitch = vi.fn()
    const schedule = vi.fn((done: () => void) => { scheduledSwitch = done })

    clearBannerBeforeTabSwitch({
      clear: (done) => { afterClear = done },
      nextTick: (done) => { afterNextTick = done },
      schedule,
      continueSwitch,
    })

    expect(continueSwitch).not.toHaveBeenCalled()
    afterClear?.()
    expect(continueSwitch).not.toHaveBeenCalled()
    afterNextTick?.()
    expect(schedule).toHaveBeenCalledWith(continueSwitch, BANNER_CLEAR_FRAME_DELAY_MS)
    expect(continueSwitch).not.toHaveBeenCalled()
    scheduledSwitch?.()
    expect(continueSwitch).toHaveBeenCalledOnce()
  })
})
