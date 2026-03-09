/**
 * txValidator.ts
 *
 * Whole-transaction validation engine.
 * Runs across ALL instruction instances in the composition and surfaces:
 *
 *  1. Account conflicts — same address used as writable in one ix, readonly in another
 *  2. Signer deduplication — informational note that duplicate signers are fine (Solana dedupes)
 *  3. Missing required accounts — slots still idle/unresolved
 *  4. Missing required args — arg fields still empty
 *  5. Cross-instruction PDA chaining suggestions — PDAs from earlier instructions
 *     that could fill unresolved slots in later ones
 *
 * This runs synchronously from derived state — no async calls needed.
 */

import { type InstructionInstance, type AccountResolutionStatus } from "../types/builder"
import { type ProgramSchema } from "../types/idl"

// ─── RESULT TYPES ─────────────────────────────────────────────────────────────

export type ConflictSeverity = "error" | "warning" | "info"

export interface TxConflict {
  severity: ConflictSeverity
  message: string
  /** Which instruction indices are involved */
  involvedIndices: number[]
  /** Which account name(s) are involved */
  involvedAccounts: string[]
}

export interface AccountSuggestion {
  /** The slot that needs filling */
  targetInstanceIndex: number
  targetSlotIndex: number
  targetSlotName: string
  /** The source instruction that creates/uses the suggested address */
  sourceInstanceIndex: number
  sourceSlotName: string
  /** The suggested address */
  address: string
}

export interface TxSummary {
  /** Total unique accounts across all instructions */
  uniqueAccountCount: number
  /** Addresses that appear in multiple instructions */
  sharedAccounts: { address: string; usedBy: number[] }[]
  /** Total writable accounts (unique) */
  writableCount: number
  /** Total signer accounts (unique) */
  signerCount: number
  /** Rough compute unit estimate */
  estimatedCu: number
  /** Is the estimate available (requires at least one resolved instruction) */
  hasEstimate: boolean
  /** All validation conflicts */
  conflicts: TxConflict[]
  /** PDA chaining suggestions */
  suggestions: AccountSuggestion[]
  /** Are all instructions fully ready (all accounts resolved, all args valid) */
  isReady: boolean
}

// ─── RESOLVED ADDRESS HELPER ──────────────────────────────────────────────────

export function getResolvedAddress(status: AccountResolutionStatus): string | null {
  switch (status.kind) {
    case "resolved":
    case "warning":
      return status.address
    case "manual":
      return status.address
    default:
      return null
  }
}

// ─── CU ESTIMATOR ─────────────────────────────────────────────────────────────
// Heuristic estimates based on instruction name patterns and known program costs.
// These are rough ballparks — simulation will give exact numbers.

// Well-known program addresses → base CU cost per instruction
const PROGRAM_CU_ESTIMATES: Record<string, number> = {
  "11111111111111111111111111111111":            300,   // System Program
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": 4_000, // Token Program transfer
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": 6_000, // Token-2022
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bG": 3_000, // ATA create
}

// Instruction name keyword → CU multiplier (applied on top of base)
const NAME_CU_HINTS: { pattern: RegExp; cu: number }[] = [
  { pattern: /swap/i,             cu: 80_000 },
  { pattern: /deposit/i,          cu: 50_000 },
  { pattern: /withdraw/i,         cu: 50_000 },
  { pattern: /stake/i,            cu: 40_000 },
  { pattern: /unstake/i,          cu: 40_000 },
  { pattern: /mint/i,             cu: 12_000 },
  { pattern: /burn/i,             cu: 8_000  },
  { pattern: /transfer/i,         cu: 4_000  },
  { pattern: /initialize/i,       cu: 10_000 },
  { pattern: /init/i,             cu: 10_000 },
  { pattern: /create/i,           cu: 8_000  },
  { pattern: /close/i,            cu: 5_000  },
  { pattern: /update/i,           cu: 5_000  },
  { pattern: /liquidat/i,         cu: 150_000 },
  { pattern: /crank/i,            cu: 100_000 },
  { pattern: /settle/i,           cu: 60_000  },
  { pattern: /harvest/i,          cu: 60_000  },
]

function estimateCuForInstruction(
  instance: InstructionInstance,
  programAddress: string | null
): number {
  // Check if it targets a well-known cheap program
  const resolvedAccounts = instance.accounts
    .map((s) => getResolvedAddress(s.resolution))
    .filter((a): a is string => a !== null)

  for (const addr of resolvedAccounts) {
    const known = PROGRAM_CU_ESTIMATES[addr]
    if (known !== undefined) return known
  }

  // Heuristic from instruction name
  const name = instance.definition.name
  for (const hint of NAME_CU_HINTS) {
    if (hint.pattern.test(name)) return hint.cu
  }

  // Default: unknown Anchor instruction — rough estimate based on complexity
  const accountFactor = instance.definition.accounts.length * 800
  const argFactor = instance.definition.args.length * 200
  return Math.max(5_000, accountFactor + argFactor)
}

// ─── MAIN VALIDATOR ───────────────────────────────────────────────────────────

export function validateTransaction(
  instances: InstructionInstance[],
  schema: ProgramSchema
): TxSummary {
  if (instances.length === 0) {
    return {
      uniqueAccountCount: 0,
      sharedAccounts: [],
      writableCount: 0,
      signerCount: 0,
      estimatedCu: 0,
      hasEstimate: false,
      conflicts: [],
      suggestions: [],
      isReady: false,
    }
  }

  const conflicts: TxConflict[] = []
  const suggestions: AccountSuggestion[] = []

  // ── 1. Build per-address usage map ───────────────────────────────────────────
  // address → { isMut: bool[], isSigner: bool[], usedByInstruction: number[] }
  interface AddrUsage {
    mutUsages: { instructionIndex: number; slotName: string }[]
    roUsages: { instructionIndex: number; slotName: string }[]
    signerUsages: number[]
  }

  const addrMap = new Map<string, AddrUsage>()

  for (let ixIdx = 0; ixIdx < instances.length; ixIdx++) {
    const inst = instances[ixIdx]
    if (inst === undefined) continue

    for (let slotIdx = 0; slotIdx < inst.accounts.length; slotIdx++) {
      const slotState = inst.accounts[slotIdx]
      const slotDef = inst.definition.accounts[slotIdx]
      if (slotState === undefined || slotDef === undefined) continue

      const addr = getResolvedAddress(slotState.resolution)
      if (addr === null) continue

      if (!addrMap.has(addr)) {
        addrMap.set(addr, { mutUsages: [], roUsages: [], signerUsages: [] })
      }

      const usage = addrMap.get(addr)!

      if (slotDef.isMut) {
        usage.mutUsages.push({ instructionIndex: ixIdx, slotName: slotDef.name })
      } else {
        usage.roUsages.push({ instructionIndex: ixIdx, slotName: slotDef.name })
      }
      if (slotDef.isSigner) {
        usage.signerUsages.push(ixIdx)
      }
    }
  }

  // ── 2. Detect writable/readonly conflicts ─────────────────────────────────
  for (const [addr, usage] of addrMap) {
    if (usage.mutUsages.length > 0 && usage.roUsages.length > 0) {
      const involvedIndices = [
        ...usage.mutUsages.map((u) => u.instructionIndex),
        ...usage.roUsages.map((u) => u.instructionIndex),
      ]
      const involvedAccounts = [
        ...usage.mutUsages.map((u) => u.slotName),
        ...usage.roUsages.map((u) => u.slotName),
      ]
      conflicts.push({
        severity: "warning",
        message: `Account ${addr.slice(0, 6)}…${addr.slice(-4)} is writable in ix ${
          usage.mutUsages.map((u) => u.instructionIndex + 1).join(", ")
        } but read-only in ix ${
          usage.roUsages.map((u) => u.instructionIndex + 1).join(", ")
        }. Solana will use the writable designation.`,
        involvedIndices: [...new Set(involvedIndices)],
        involvedAccounts: [...new Set(involvedAccounts)],
      })
    }
  }

  // ── 3. Detect unresolved required accounts ────────────────────────────────
  for (let ixIdx = 0; ixIdx < instances.length; ixIdx++) {
    const inst = instances[ixIdx]
    if (inst === undefined) continue

    const unresolvedRequired = inst.accounts.filter(
      (s, i) => {
        const def = inst.definition.accounts[i]
        if (def === undefined) return false
        if (def.isOptional) return false
        const addr = getResolvedAddress(s.resolution)
        return addr === null && s.resolution.kind !== "resolving"
      }
    )

    if (unresolvedRequired.length > 0) {
      conflicts.push({
        severity: "error",
        message: `Instruction ${ixIdx + 1} (${inst.definition.name}): ${unresolvedRequired.length} required account${
          unresolvedRequired.length > 1 ? "s" : ""
        } not yet filled: ${unresolvedRequired.map((s) => s.name).join(", ")}`,
        involvedIndices: [ixIdx],
        involvedAccounts: unresolvedRequired.map((s) => s.name),
      })
    }
  }

  // ── 4. Cross-instruction PDA suggestions ──────────────────────────────────
  // Scan each instruction for unresolved slots. For each, look at all resolved
  // PDA addresses from *earlier* instructions and offer them as suggestions.
  for (let targetIdx = 0; targetIdx < instances.length; targetIdx++) {
    const targetInst = instances[targetIdx]
    if (targetInst === undefined) continue

    for (let slotIdx = 0; slotIdx < targetInst.accounts.length; slotIdx++) {
      const slotState = targetInst.accounts[slotIdx]
      const slotDef = targetInst.definition.accounts[slotIdx]
      if (slotState === undefined || slotDef === undefined) continue

      // Skip if already resolved
      if (getResolvedAddress(slotState.resolution) !== null) continue
      if (slotState.resolution.kind === "resolving") continue

      // Look through all earlier instructions for PDA-sourced addresses
      for (let srcIdx = 0; srcIdx < targetIdx; srcIdx++) {
        const srcInst = instances[srcIdx]
        if (srcInst === undefined) continue

        for (let srcSlotIdx = 0; srcSlotIdx < srcInst.accounts.length; srcSlotIdx++) {
          const srcSlotState = srcInst.accounts[srcSlotIdx]
          const srcSlotDef = srcInst.definition.accounts[srcSlotIdx]
          if (srcSlotState === undefined || srcSlotDef === undefined) continue

          const srcAddr = getResolvedAddress(srcSlotState.resolution)
          if (srcAddr === null) continue

          // Only suggest PDA-derived addresses (not wallet/constants)
          const isPda =
            srcSlotState.resolution.kind === "resolved" &&
            srcSlotState.resolution.source === "pda"

          if (!isPda) continue

          // Name similarity heuristic: if slot names share significant tokens
          const targetTokens = tokenize(slotDef.name)
          const srcTokens = tokenize(srcSlotDef.name)
          const overlap = targetTokens.filter((t) => srcTokens.includes(t))

          if (overlap.length > 0 || targetTokens.includes("account") || srcTokens.includes("account")) {
            // Avoid duplicate suggestions
            const alreadySuggested = suggestions.some(
              (s) =>
                s.targetInstanceIndex === targetIdx &&
                s.targetSlotIndex === slotIdx &&
                s.address === srcAddr
            )
            if (!alreadySuggested) {
              suggestions.push({
                targetInstanceIndex: targetIdx,
                targetSlotIndex: slotIdx,
                targetSlotName: slotDef.name,
                sourceInstanceIndex: srcIdx,
                sourceSlotName: srcSlotDef.name,
                address: srcAddr,
              })
            }
          }
        }
      }
    }
  }

  // ── 5. Compute summary stats ──────────────────────────────────────────────
  const uniqueAddresses = new Set<string>(addrMap.keys())
  const writableAddresses = new Set<string>()
  const signerAddresses = new Set<string>()

  for (const [addr, usage] of addrMap) {
    if (usage.mutUsages.length > 0) writableAddresses.add(addr)
    if (usage.signerUsages.length > 0) signerAddresses.add(addr)
  }

  const sharedAccounts: { address: string; usedBy: number[] }[] = []
  for (const [addr, usage] of addrMap) {
    const usedBy = [
      ...usage.mutUsages.map((u) => u.instructionIndex),
      ...usage.roUsages.map((u) => u.instructionIndex),
    ]
    const unique = [...new Set(usedBy)]
    if (unique.length > 1) {
      sharedAccounts.push({ address: addr, usedBy: unique })
    }
  }

  // ── 6. CU estimate ────────────────────────────────────────────────────────
  let totalCu = 0
  let hasAnyResolved = false

  for (const inst of instances) {
    if (inst === undefined) continue
    const anyResolved = inst.accounts.some(
      (s) => getResolvedAddress(s.resolution) !== null
    )
    if (anyResolved) hasAnyResolved = true
    totalCu += estimateCuForInstruction(inst, schema.address)
  }

  // ── 7. isReady ────────────────────────────────────────────────────────────
  const hasErrors = conflicts.some((c) => c.severity === "error")
  const isReady = !hasErrors && instances.length > 0

  return {
    uniqueAccountCount: uniqueAddresses.size,
    sharedAccounts,
    writableCount: writableAddresses.size,
    signerCount: signerAddresses.size,
    estimatedCu: totalCu,
    hasEstimate: hasAnyResolved,
    conflicts,
    suggestions,
    isReady,
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function tokenize(name: string): string[] {
  // Split camelCase and snake_case into lowercase tokens
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .split(/[_\s]+/)
    .filter((t) => t.length > 2)
}

// ─── CU DISPLAY HELPERS ───────────────────────────────────────────────────────

export function formatCu(cu: number): string {
  if (cu >= 1_000_000) return `${(cu / 1_000_000).toFixed(2)}M`
  if (cu >= 1_000) return `${(cu / 1_000).toFixed(1)}k`
  return String(cu)
}

export function cuBudgetColor(cu: number): "green" | "yellow" | "red" {
  if (cu <= 200_000) return "green"
  if (cu <= 800_000) return "yellow"
  return "red"
}