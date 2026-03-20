//import { type ProgramSchema } from "../types/idl"
import { type InstructionInstance } from "../store/builderStore"

export interface Session {
  idl: unknown
  instructions: InstructionInstance[]
  timestamp: number
}

export function serializeSession(session: Session): string {
  return JSON.stringify(session, null, 2)
}

export function deserializeSession(json: string): Session {
  return JSON.parse(json) as Session
}

export async function loadSessionFile(file: File): Promise<Session> {
    const text = await file.text()
    return deserializeSession(text)
  }
// ─── DOWNLOAD ─────────────────────────────────────────

export function downloadSession(session: Session): void {
  const blob = new Blob([serializeSession(session)], {
    type: "application/json",
  })

  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")

  a.href = url
  a.download = `session-${Date.now()}.spi.json`
  a.click()

  URL.revokeObjectURL(url)
}