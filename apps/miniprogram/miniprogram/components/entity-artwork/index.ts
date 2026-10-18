import { cacheImageSource } from '../../services/image-source'

Component({
  properties: {
    src: { type: String, value: '' },
    fallback: { type: String, value: '球' },
    shape: { type: String, value: 'square' },
    surface: { type: String, value: 'dark' },
  },

  data: { displaySrc: '', requestedSrc: '', imageFailed: false },

  observers: {
    src(src: string) {
      this.setData({ displaySrc: '', requestedSrc: src, imageFailed: false })
      if (!src) return
      void cacheImageSource(src, {
        downloadHttp: (options) => wx.downloadFile(options),
        downloadCloud: (options) => wx.cloud.downloadFile(options),
      }).then((displaySrc) => {
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
