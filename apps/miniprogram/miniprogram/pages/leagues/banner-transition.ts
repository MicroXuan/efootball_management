export const BANNER_CLEAR_FRAME_DELAY_MS = 34

export function clearBannerBeforeTabSwitch(input: {
  clear: (done: () => void) => void
  nextTick: (done: () => void) => void
  schedule: (done: () => void, delayMs: number) => unknown
  continueSwitch: () => void
}) {
  input.clear(() => {
    input.nextTick(() => {
      input.schedule(input.continueSwitch, BANNER_CLEAR_FRAME_DELAY_MS)
    })
  })
}
