import type { PlayerCardViewModel } from '../../pages/players/players.viewmodel'

Component({
  properties: {
    card: {
      type: Object,
      value: null as unknown as PlayerCardViewModel,
    },
  },

  data: { imageFailed: false },

  observers: {
    card() {
      this.setData({ imageFailed: false })
    },
  },

  methods: {
    onImageError() {
      this.setData({ imageFailed: true })
    },

    onTap() {
      this.triggerEvent('cardtap', { id: this.data.card.id })
    },
  },
})
