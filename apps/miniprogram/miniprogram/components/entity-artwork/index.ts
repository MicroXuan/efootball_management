import { cacheImageSource } from '../../services/image-source'

Component({
  properties: {
    src: { type: String, value: '' },
    fallback: { type: String, value: '球' },
    shape: { type: String, value: 'square' },
    surface: { type: String, value: 'dark' },
    directHttps: { type: Boolean, value: false },
  },

  data: { displaySrc: '', requestedSrc: '', requestedDirectHttps: false, imageFailed: false },

  observers: {
    'src, directHttps'(src: string, directHttps: boolean) {
      this.setData({
        displaySrc: '', requestedSrc: src, requestedDirectHttps: directHttps, imageFailed: false,
      })
      if (!src) return
      if (directHttps && /^https:\/\//i.test(src)) {
        this.setData({ displaySrc: src })
        return
      }
      void cacheImageSource(src, {
        downloadHttp: (options) => wx.downloadFile(options),
        downloadCloud: (options) => wx.cloud.downloadFile(options),
      }).then((displaySrc) => {
        if (this.data.requestedSrc === src && this.data.requestedDirectHttps === directHttps) {
          this.setData({ displaySrc })
        }
      }).catch(() => {
        if (this.data.requestedSrc === src && this.data.requestedDirectHttps === directHttps) {
          this.setData({ imageFailed: true })
        }
      })
    },
  },

  methods: {
    onImageError() {
      this.setData({ imageFailed: true })
    },
  },
})
