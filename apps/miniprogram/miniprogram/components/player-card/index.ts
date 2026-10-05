import type { PlayerCardViewModel } from '../../pages/players/players.viewmodel'

Component({
  properties: {
    card: {
      type: Object,
      value: null as unknown as PlayerCardViewModel,
    },
  },

  data: { imageFailed: false, imageLoaded: false },

  observers: {
    card() {
      this.setData({ imageFailed: false, imageLoaded: false })
    },
  },

  methods: {
    onImageLoad() {
      this.setData({ imageLoaded: true })
    },

    onImageError() {
      this.setData({ imageFailed: true, imageLoaded: false })
    },

    onTap() {
      this.triggerEvent('cardtap', { id: this.data.card.id })
    },
  },
})
