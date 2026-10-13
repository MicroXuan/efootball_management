import { resolveImageSource } from '../../services/image-source'

Component({
  properties: {
    src: { type: String, value: '' },
    fallback: { type: String, value: '球' },
    shape: { type: String, value: 'square' },
  },

  data: { displaySrc: '', requestedSrc: '', imageFailed: false },

  observers: {
    src(src: string) {
      this.setData({ displaySrc: '', requestedSrc: src, imageFailed: false })
      if (!src) return
      void resolveImageSource(src, (options) => wx.downloadFile(options)).then((displaySrc) => {
        if (this.data.requestedSrc === src) this.setData({ displaySrc })
      }).catch(() => {
        if (this.data.requestedSrc === src) this.setData({ imageFailed: true })
      })
    },
  },

  methods: {
    onImageError() {
      this.setData({ imageFailed: true })
    },
  },
})
