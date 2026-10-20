let myLeaguesRequested = false

export function requestMyLeaguesTab() {
  myLeaguesRequested = true
}

export function consumeMyLeaguesTabRequest(): boolean {
  const requested = myLeaguesRequested
  myLeaguesRequested = false
  return requested
}
