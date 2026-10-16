const tabRoutes = [
  '/pages/players/index',
  '/pages/leagues/index',
  '/pages/profile/index',
] as const

export function tabIndexForRoute(route: string): number {
  const normalized = route.startsWith('/') ? route : `/${route}`
  const index = tabRoutes.indexOf(normalized as typeof tabRoutes[number])
  return index < 0 ? 0 : index
}

export function tabRouteForIndex(index: number): typeof tabRoutes[number] | null {
  return tabRoutes[index] ?? null
}
