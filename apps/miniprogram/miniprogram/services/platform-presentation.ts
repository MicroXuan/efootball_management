import type { PlatformPresentation } from '@efm/contracts'
import { api } from './api'

export const platformPresentationApi = {
  get() {
    return api.request<PlatformPresentation>({
      path: '/platform-presentation',
      skipAuth: true,
    })
  },
}
