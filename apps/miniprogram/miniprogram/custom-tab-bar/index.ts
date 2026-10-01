import { tabIndexForRoute, tabRouteForIndex } from './tabbar.viewmodel'

type TabEvent = { currentTarget: { dataset: { index?: number } } }

Component({
  data: {
    selected: 0,
    items: [
      { text: '球员', icon: '/assets/icons/player.png', activeIcon: '/assets/icons/player-active.png' },
      { text: '联赛', icon: '/assets/icons/competition.png', activeIcon: '/assets/icons/competition-active.png' },
      { text: '我的', icon: '/assets/icons/profile.png', activeIcon: '/assets/icons/profile-active.png' },
    ],
  },

  lifetimes: {
    attached() {
      const pages = getCurrentPages()
      const current = pages[pages.length - 1]
      this.setData({ selected: tabIndexForRoute(current?.route ?? '') })
    },
  },

  methods: {
    switchTab(event: TabEvent) {
      const index = Number(event.currentTarget.dataset.index)
      const url = tabRouteForIndex(index)
      if (!url || index === this.data.selected) return
      this.setData({ selected: index })
      wx.switchTab({ url })
    },
  },
})
