/**
 * simulator.ts  (Day 3 Evening — updated)
 *
 * Additions vs Day 3 Morning:
 *  - AccountDiff now carries rawDataBefore / rawDataAfter (Uint8Array)
 *    so the diff UI can decode them via borshDecoder
 *  - simulateAndParse accepts a SnapshotMap for before-state
 *  - buildAccountDiffs merges snapshot data with simulation response data
 *  - SimulationResult adds translatedError field
 *
 * Log parsing, CU parsing, priority fees unchanged.
 */

import {
  Connection,
  VersionedTransaction,
  type SimulatedTransactionResponse,
} from "@solana/web3.js"
import { type SnapshotMap } from "./accountSnapshot"

// ─── RESULT TYPES ─────────────────────────────────────────────────────────────
const LOG_RE  = /^Program log: (.+)$/
const DATA_RE = /^Program data: (.+)$/
export interface CpiFrame {
  programId: string
  depth: number
  unitsAtEntry: number | null
  unitsAtExit: number | null
  unitsConsumed: number | null
  logs: string[]
  children: CpiFrame[]
  success: boolean
  failReason: string | null
  dataLines: string[]
}

export interface PerInstructionResult {
  index: number
  programId: string
  unitsConsumed: number | null
  success: boolean
  failReason: string | null
  logs: string[]
  cpiTree: CpiFrame[]
}

export interface AccountDiff {
  address: string
  // ── before (from snapshot, may be null if account didn't exist) ───────────
  dataBefore: string | null           // base64
  rawDataBefore: Uint8Array | null    // raw bytes for IDL decoding
  lamportsBefore: number | null
  ownerBefore: string | null
  existedBefore: boolean
  // ── after (from simulateTransaction response) ─────────────────────────────
  dataAfter: string | null            // base64
  rawDataAfter: Uint8Array | null     // raw bytes for IDL decoding
  lamportsAfter: number | null
  ownerAfter: string | null
  // ── derived ───────────────────────────────────────────────────────────────
  /** created = didn't exist before, exists after */
  wasCreated: boolean
  /** closed = had lamports before, zero lamports after */
  wasClosed: boolean
  /** did any data bytes change? */
  dataChanged: boolean
  /** lamport delta (positive = gained, negative = spent) */
  lamportDelta: number | null
}

export interface ComputeRecommendation {
  consumed: number
  recommended: number
  headroom: number
}

export interface PriorityFeeTier {
  label: "slow" | "normal" | "fast"
  microLamportsPerCu: number
  estimatedFeeSol: string
}

export interface SimulationResult {
  success: boolean
  rpcError: string | null
  programError: string | null
  /** The raw err value from the RPC (for errorTranslator) */
  rawErr: unknown
  logs: string[]
  totalUnitsConsumed: number | null
  instructions: PerInstructionResult[]
  accountDiffs: AccountDiff[]
  computeRecommendation: ComputeRecommendation | null
  priorityFees: PriorityFeeTier[] | null
  raw: SimulatedTransactionResponse | null
}

// ─── LOG PARSER ───────────────────────────────────────────────────────────────

const INVOKE_RE   = /^Program (\S+) invoke \[(\d+)\]$/
const SUCCESS_RE  = /^Program (\S+) success$/
const FAILED_RE   = /^Program (\S+) failed: (.+)$/
const CONSUMED_RE = /^Program consumption: (\d+) units remaining$/

export function parseLogsIntoTree(logs: string[]): CpiFrame[] {
  const stack: CpiFrame[] = []
  const roots: CpiFrame[] = []
  let lastConsumed: number | null = null

  for (const line of logs) {
    let m: RegExpMatchArray | null

    if ((m = INVOKE_RE.exec(line)) !== null) {
      const frame: CpiFrame = {
        programId: m[1] ?? "",
        depth: parseInt(m[2] ?? "1", 10),
        unitsAtEntry: null,
        unitsAtExit: null,
        unitsConsumed: null,
        logs: [],
        dataLines: [], 
        children: [],
        success: false,
        failReason: null,
      }
      if (stack.length === 0) roots.push(frame)
      else stack[stack.length - 1]?.children.push(frame)
      stack.push(frame)
      lastConsumed = null
      continue
    }

    if ((m = SUCCESS_RE.exec(line)) !== null) {
      const frame = stack.pop()
      if (frame !== undefined) {
        frame.success = true
        frame.unitsAtExit = lastConsumed
        if (frame.unitsAtEntry !== null && lastConsumed !== null) {
          frame.unitsConsumed = frame.unitsAtEntry - lastConsumed
        }
      }
      lastConsumed = null
      continue
    }

    if ((m = FAILED_RE.exec(line)) !== null) {
      const frame = stack.pop()
      if (frame !== undefined) {
        frame.success = false
        frame.failReason = m[2] ?? null
        frame.unitsAtExit = lastConsumed
        if (frame.unitsAtEntry !== null && lastConsumed !== null) {
          frame.unitsConsumed = frame.unitsAtEntry - lastConsumed
        }
      }
      lastConsumed = null
      continue
    }

    if ((m = CONSUMED_RE.exec(line)) !== null) {
      const remaining = parseInt(m[1] ?? "0", 10)
    
      const current = stack[stack.length - 1]
    
      if (current !== undefined) {
        if (current.unitsAtEntry === null) {
          current.unitsAtEntry = remaining
        } else {
          current.unitsAtExit = remaining
          current.unitsConsumed =
            current.unitsAtEntry - current.unitsAtExit
        }
      }
    
      lastConsumed = remaining
    }

    const current = stack[stack.length - 1]

if (current !== undefined) {
  current.logs.push(line)

  let match: RegExpMatchArray | null

  // ── EVENT DATA ─────────────────────
  if ((match = DATA_RE.exec(line)) !== null) {
    current.dataLines.push(match[1] ?? "")
  }
}
  }

  return roots
}

function groupByInstruction(
  roots: CpiFrame[],
  programIds: string[]
): PerInstructionResult[] {
  return roots.map((frame, i) => ({
    index: i,
    programId: programIds[i] ?? frame.programId,
    unitsConsumed: frame.unitsConsumed,
    success: frame.success,
    failReason: frame.failReason,
    logs: frame.logs,
    cpiTree: frame.children,
  }))
}

// ─── ACCOUNT DIFFS ────────────────────────────────────────────────────────────

function buildAccountDiffs(
  response: SimulatedTransactionResponse,
  writableAddresses: string[],
  snapshots: SnapshotMap
): AccountDiff[] {
  const accounts = response.accounts ?? []

  return writableAddresses.map((address, i) => {
    const snapshot = snapshots.get(address) ?? null
    const postAcct = accounts[i] ?? null

    // Before state
    const existedBefore = snapshot?.exists ?? false
    const dataBefore = snapshot?.dataBase64 ?? null
    const rawDataBefore = snapshot?.data ?? null
    const lamportsBefore = snapshot?.exists ? (snapshot.lamports) : null
    const ownerBefore = snapshot?.exists ? snapshot.owner : null

    // After state
    let dataAfter: string | null = null
    let rawDataAfter: Uint8Array | null = null
    let lamportsAfter: number | null = null
    let ownerAfter: string | null = null

    if (postAcct !== null) {
      dataAfter = Array.isArray(postAcct.data) ? postAcct.data[0] ?? null : null
      lamportsAfter = postAcct.lamports
      ownerAfter = postAcct.owner

      // Decode base64 → Uint8Array for diff
      if (dataAfter !== null) {
        try {
          const bin = atob(dataAfter)
          rawDataAfter = new Uint8Array(bin.length)
          for (let j = 0; j < bin.length; j++) rawDataAfter[j] = bin.charCodeAt(j)
        } catch { rawDataAfter = null }
      }
    }

    // Derived flags
    const wasCreated = !existedBefore && lamportsAfter !== null && lamportsAfter > 0
    const wasClosed = existedBefore && lamportsBefore !== null && lamportsBefore > 0
      && lamportsAfter !== null && lamportsAfter === 0
    const dataChanged = dataBefore !== dataAfter && !(dataBefore === null && dataAfter === null)
    const lamportDelta =
      lamportsBefore !== null && lamportsAfter !== null
        ? lamportsAfter - lamportsBefore
        : lamportsBefore === null && lamportsAfter !== null
        ? lamportsAfter
        : null

    return {
      address,
      dataBefore,
      rawDataBefore: rawDataBefore ?? null,
      lamportsBefore,
      ownerBefore,
      existedBefore,
      dataAfter,
      rawDataAfter,
      lamportsAfter,
      ownerAfter,
      wasCreated,
      wasClosed,
      dataChanged,
      lamportDelta,
    }
  })
}

// ─── COMPUTE RECOMMENDATION ───────────────────────────────────────────────────

function buildComputeRecommendation(consumed: number): ComputeRecommendation {
  const rawRecommended = Math.ceil(consumed * 1.15)
  const recommended = Math.ceil(rawRecommended / 1000) * 1000
  return { consumed, recommended, headroom: (recommended - consumed) / recommended }
}

// ─── PRIORITY FEE ─────────────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((p / 100) * sorted.length)
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0
}

// ─── MAIN FUNCTION ────────────────────────────────────────────────────────────

export async function simulateAndParse(
  connection: Connection,
  transaction: VersionedTransaction,
  writableAddresses: string[],
  programIds: string[],
  snapshots: SnapshotMap = new Map()
): Promise<SimulationResult> {
  // ── simulateTransaction ────────────────────────────────────────────────────
  let simResponse: Awaited<ReturnType<typeof connection.simulateTransaction>>

  try {
    simResponse = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: writableAddresses.length > 0
        ? { encoding: "base64", addresses: writableAddresses }
        : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      rpcError: msg,
      programError: null,
      rawErr: null,
      logs: [],
      totalUnitsConsumed: null,
      instructions: [],
      accountDiffs: [],
      computeRecommendation: null,
      priorityFees: null,
      raw: null,
    }
  }

  const { value: simValue } = simResponse
  const logs = simValue.logs ?? []
  const unitsConsumed = simValue.unitsConsumed ?? null

  const roots = parseLogsIntoTree(logs)
  const instructions = groupByInstruction(roots, programIds)
  const accountDiffs = buildAccountDiffs(simValue, writableAddresses, snapshots)

  let programError: string | null = null
  const rawErr: unknown = simValue.err ?? null
  if (rawErr !== null) {
    programError = typeof rawErr === "string" ? rawErr : JSON.stringify(rawErr)
  }

  const computeRecommendation =
    unitsConsumed !== null && unitsConsumed > 0
      ? buildComputeRecommendation(unitsConsumed)
      : null

  // ── Priority fees ──────────────────────────────────────────────────────────
  let priorityFees: PriorityFeeTier[] | null = null
  try {
    const feeData = await connection.getRecentPrioritizationFees()
    if (feeData.length > 0) {
      const feesPerCu = feeData.map((f) => f.prioritizationFee).sort((a, b) => a - b)
      const p25 = percentile(feesPerCu, 25)
      const p75 = percentile(feesPerCu, 75)
      const p90 = percentile(feesPerCu, 90)
      const cuLimit = computeRecommendation?.recommended ?? 200_000
      const feeInSol = (μL: number): string => {
        const sol = μL * cuLimit / 1e15
        return sol < 1e-6 ? "< 0.000001 SOL" : `${sol.toFixed(7)} SOL`
      }
      priorityFees = [
        { label: "slow",   microLamportsPerCu: p25,                estimatedFeeSol: feeInSol(p25) },
        { label: "normal", microLamportsPerCu: p75,                estimatedFeeSol: feeInSol(p75) },
        { label: "fast",   microLamportsPerCu: Math.ceil(p90*1.1), estimatedFeeSol: feeInSol(Math.ceil(p90*1.1)) },
      ]
    }
  } catch { priorityFees = null }

  return {
    success: rawErr === null,
    rpcError: null,
    programError,
    rawErr,
    logs,
    totalUnitsConsumed: unitsConsumed,
    instructions,
    accountDiffs,
    computeRecommendation,
    priorityFees,
    raw: simValue,
  }
}