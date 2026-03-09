/**
 * simulator.ts
 *
 * Sends an assembled transaction to simulateTransaction, parses the response,
 * and extracts structured simulation results.
 *
 * Also handles getRecentPrioritizationFees for the priority fee recommender.
 *
 * Log parsing:
 *   Solana logs follow this structure per instruction and CPI:
 *     "Program <id> invoke [<depth>]"      ← instruction start
 *     "Program log: <message>"             ← user logs
 *     "Program consumption: <N> units remaining"
 *     "Program <id> success"               ← instruction end (success)
 *     "Program <id> failed: <reason>"      ← instruction end (failure)
 *
 *   We walk the log array building a call tree, tracking units remaining
 *   at entry and exit of each frame to compute units consumed per frame.
 */

import {
  Connection,
  VersionedTransaction,
  type SimulatedTransactionResponse,
} from "@solana/web3.js"

// ─── RESULT TYPES ─────────────────────────────────────────────────────────────

export interface CpiFrame {
  programId: string
  depth: number
  /** Units remaining at the start of this frame (from the consumption log) */
  unitsAtEntry: number | null
  /** Units remaining at the end of this frame */
  unitsAtExit: number | null
  /** unitsAtEntry - unitsAtExit */
  unitsConsumed: number | null
  logs: string[]
  children: CpiFrame[]
  success: boolean
  failReason: string | null
}

export interface PerInstructionResult {
  /** 0-based index matching the instruction list */
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
  /** Base64-encoded account data before simulation */
  dataBefore: string | null
  /** Base64-encoded account data after simulation */
  dataAfter: string | null
  lamportsBefore: number | null
  lamportsAfter: number | null
  ownerBefore: string | null
  ownerAfter: string | null
  changed: boolean
}

export interface ComputeRecommendation {
  /** Actual units consumed */
  consumed: number
  /** Recommended limit: consumed × 1.15, rounded to nearest 1000 */
  recommended: number
  /** Headroom fraction: (recommended - consumed) / recommended */
  headroom: number
}

export interface PriorityFeeTier {
  label: "slow" | "normal" | "fast"
  microLamportsPerCu: number
  /** Estimated total fee in SOL for the recommended CU limit */
  estimatedFeeSol: string
}

export interface SimulationResult {
  success: boolean
  /** Top-level error, if the simulation itself failed to run */
  rpcError: string | null
  /** Program error code / message if the transaction failed */
  programError: string | null
  /** All logs returned by the RPC */
  logs: string[]
  /** Total units consumed across all instructions */
  totalUnitsConsumed: number | null
  /** Per-instruction breakdown */
  instructions: PerInstructionResult[]
  /** Account state diffs for writable accounts */
  accountDiffs: AccountDiff[]
  /** Compute unit recommendation */
  computeRecommendation: ComputeRecommendation | null
  /** Priority fee tiers from getRecentPrioritizationFees */
  priorityFees: PriorityFeeTier[] | null
  /** Raw RPC response for debugging */
  raw: SimulatedTransactionResponse | null
}

// ─── LOG PARSER ───────────────────────────────────────────────────────────────

const INVOKE_RE = /^Program (\S+) invoke \[(\d+)\]$/
const SUCCESS_RE = /^Program (\S+) success$/
const FAILED_RE = /^Program (\S+) failed: (.+)$/
const CONSUMED_RE = /^Program consumption: (\d+) units remaining$/
const LOG_RE = /^Program log: (.+)$/
const DATA_RE = /^Program data: (.+)$/

function parseLogsIntoTree(logs: string[]): CpiFrame[] {
  const stack: CpiFrame[] = []
  const roots: CpiFrame[] = []
  let lastConsumed: number | null = null

  for (const line of logs) {
    let m: RegExpMatchArray | null

    if ((m = INVOKE_RE.exec(line)) !== null) {
      const frame: CpiFrame = {
        programId: m[1] ?? "",
        depth: parseInt(m[2] ?? "1", 10),
        unitsAtEntry: lastConsumed,
        unitsAtExit: null,
        unitsConsumed: null,
        logs: [],
        children: [],
        success: false,
        failReason: null,
      }
      if (stack.length === 0) {
        roots.push(frame)
      } else {
        stack[stack.length - 1]?.children.push(frame)
      }
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
      lastConsumed = parseInt(m[1] ?? "0", 10)
      stack[stack.length - 1]?.logs.push(line)
      continue
    }

    // Regular log line — attach to current frame
    const currentFrame = stack[stack.length - 1]
    if (currentFrame !== undefined) {
      currentFrame.logs.push(line)
    }
  }

  return roots
}

// Group the top-level frames (depth=1) into per-instruction results.
// Each TransactionInstruction produces exactly one depth=1 frame.
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
  writableAddresses: string[]
): AccountDiff[] {
  const accounts = response.accounts ?? []

  return writableAddresses.map((address, i) => {
    const acct = accounts[i]
    if (acct == null) {
      return {
        address,
        dataBefore: null,
        dataAfter: null,
        lamportsBefore: null,
        lamportsAfter: null,
        ownerBefore: null,
        ownerAfter: null,
        changed: false,
      }
    }

    const dataAfter = Array.isArray(acct.data) ? acct.data[0] ?? null : null
    return {
      address,
      dataBefore: null, // we don't prefetch — could add in a future version
      dataAfter,
      lamportsBefore: null,
      lamportsAfter: acct.lamports,
      ownerBefore: null,
      ownerAfter: acct.owner,
      changed: true,
    }
  })
}

// ─── COMPUTE RECOMMENDATION ───────────────────────────────────────────────────

function buildComputeRecommendation(consumed: number): ComputeRecommendation {
  const rawRecommended = Math.ceil(consumed * 1.15)
  const recommended = Math.ceil(rawRecommended / 1000) * 1000
  return {
    consumed,
    recommended,
    headroom: (recommended - consumed) / recommended,
  }
}

// ─── PRIORITY FEE PERCENTILE ──────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.floor((p / 100) * sorted.length)
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0
}

// ─── MAIN SIMULATE FUNCTION ───────────────────────────────────────────────────

export async function simulateAndParse(
  connection: Connection,
  transaction: VersionedTransaction,
  writableAddresses: string[],
  programIds: string[]
): Promise<SimulationResult> {
  // ── 1. simulateTransaction ────────────────────────────────────────────────
  let simResponse: Awaited<ReturnType<typeof connection.simulateTransaction>>

  try {
    simResponse = await connection.simulateTransaction(transaction, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
      accounts: writableAddresses.length > 0
        ? {
            encoding: "base64",
            addresses: writableAddresses,
          }
        : undefined,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      rpcError: msg,
      programError: null,
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

  // ── 2. Parse logs ─────────────────────────────────────────────────────────
  const roots = parseLogsIntoTree(logs)
  const instructions = groupByInstruction(roots, programIds)

  // ── 3. Account diffs ──────────────────────────────────────────────────────
  const accountDiffs = buildAccountDiffs(simValue, writableAddresses)

  // ── 4. Program error ──────────────────────────────────────────────────────
  let programError: string | null = null
  if (simValue.err !== null && simValue.err !== undefined) {
    programError = typeof simValue.err === "string"
      ? simValue.err
      : JSON.stringify(simValue.err)
  }

  // ── 5. Compute recommendation ─────────────────────────────────────────────
  const computeRecommendation =
    unitsConsumed !== null && unitsConsumed > 0
      ? buildComputeRecommendation(unitsConsumed)
      : null

  // ── 6. Priority fees ──────────────────────────────────────────────────────
  let priorityFees: PriorityFeeTier[] | null = null
  try {
    const feeData = await connection.getRecentPrioritizationFees()
    if (feeData.length > 0) {
      const feesPerCu = feeData
        .map((f) => f.prioritizationFee)
        .sort((a, b) => a - b)

      const p25 = percentile(feesPerCu, 25)
      const p75 = percentile(feesPerCu, 75)
      const p90 = percentile(feesPerCu, 90)

      const cuLimit = computeRecommendation?.recommended ?? 200_000
      const solPerMicroLamport = 1 / 1_000_000 / 1_000_000_000

      const feeInSol = (microLamportsPerCu: number): string => {
        const totalMicroLamports = microLamportsPerCu * cuLimit
        const sol = totalMicroLamports * solPerMicroLamport
        return sol < 0.000001 ? "< 0.000001 SOL" : `${sol.toFixed(7)} SOL`
      }

      priorityFees = [
        { label: "slow", microLamportsPerCu: p25, estimatedFeeSol: feeInSol(p25) },
        { label: "normal", microLamportsPerCu: p75, estimatedFeeSol: feeInSol(p75) },
        { label: "fast", microLamportsPerCu: Math.ceil(p90 * 1.1), estimatedFeeSol: feeInSol(Math.ceil(p90 * 1.1)) },
      ]
    }
  } catch {
    // Priority fee fetch is best-effort — don't fail the whole simulation
    priorityFees = null
  }

  return {
    success: programError === null,
    rpcError: null,
    programError,
    logs,
    totalUnitsConsumed: unitsConsumed,
    instructions,
    accountDiffs,
    computeRecommendation,
    priorityFees,
    raw: simValue,
  }
}

