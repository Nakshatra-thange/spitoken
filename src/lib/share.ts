import { type Session } from "./session"

export function encodeSessionToUrl(session: Session): string {
  const json = JSON.stringify(session)
  const encoded = btoa(json)
  return `#spi=${encodeURIComponent(encoded)}`
}

export function decodeSessionFromUrl(): Session | null {
  const hash = window.location.hash

  if (!hash.startsWith("#spi=")) return null

  try {
    const encoded = decodeURIComponent(hash.replace("#spi=", ""))
    const json = atob(encoded)
    return JSON.parse(json)
  } catch {
    return null
  }
}