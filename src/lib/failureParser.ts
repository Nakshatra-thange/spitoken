import { type ParsedTransactionWithMeta } from "@solana/web3.js"
import { parseLogsIntoTree } from "./simulator" // export this!

export interface FailureAnalysis {
  failed: boolean
  logs: string[]
  cpiTree: ReturnType<typeof parseLogsIntoTree>
  error: string | null
}

export function analyzeFailure(
  tx: ParsedTransactionWithMeta | null
): FailureAnalysis {
  if (!tx || !tx.meta) {
    return {
      failed: true,
      logs: [],
      cpiTree: [],
      error: "Transaction not found",
    }
  }

  const logs = tx.meta.logMessages ?? []
  const err = tx.meta.err

  return {
    failed: err !== null,
    logs,
    cpiTree: parseLogsIntoTree(logs),
    error: err ? JSON.stringify(err) : null,
  }
}