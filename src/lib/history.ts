export interface TxHistoryEntry {
    signature: string
    timestamp: number
    success: boolean
    computeUnits: number | null
    instructions: string[]
  }
  
  const KEY = "spi_tx_history"
  
  export function loadHistory(): TxHistoryEntry[] {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]")
    } catch {
      return []
    }
  }
  
  export function saveHistory(entry: TxHistoryEntry): void {
    const current = loadHistory()
  
    const updated = [entry, ...current].slice(0, 20)
  
    localStorage.setItem(KEY, JSON.stringify(updated))
  }