Component({
  properties: {
    src: { type: String, value: '' },
    fallback: { type: String, value: '球' },
    shape: { type: String, value: 'square' },
  },

  data: { imageFailed: false },

  observers: {
    src() {
      this.setData({ imageFailed: false })
    },
  },

  methods: {
    onImageError() {
      this.setData({ imageFailed: true })
    },
  },
})
