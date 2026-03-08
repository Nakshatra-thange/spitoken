/**
 * accountResolver.ts
 *
 * The auto-resolution cascade for account slots.
 *
 * For each slot in an instruction, it tries to fill the address automatically:
 *   1. Well-known constants  (System Program, Token Program, etc.)
 *   2. PDA derivation        (if seeds are all "const" kind — no user input needed)
 *   3. Wallet signer         (if isSigner and no PDA)
 *
 * After deriving, it validates against the chain (checks existence, owner).
 * Returns a stream of updates via a callback so the UI can update per-slot.
 */

import { Connection, PublicKey } from "@solana/web3.js"
import {
  type AccountSlot,
  type ProgramSchema,
} from "../types/idl"
import {
  type AccountResolutionStatus,
  type ResolutionSource,
} from "../types/builder"

// ─── WELL-KNOWN CONSTANTS ─────────────────────────────────────────────────────

const KNOWN_CONSTANTS: Record<string, string> = {
  systemProgram:          "11111111111111111111111111111111",
  system_program:         "11111111111111111111111111111111",
  tokenProgram:           "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token_program:          "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  token2022Program:       "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  token_2022_program:     "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  associatedTokenProgram: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bG",
  associated_token_program: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bG",
  ataProgram:             "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bG",
  rent:                   "SysvarRent111111111111111111111111111111111",
  clock:                  "SysvarC1ock11111111111111111111111111111111",
  recentBlockhashes:      "SysvarRecentB1ockHashes11111111111111111111",
  instructions:           "Sysvar1nstructions1111111111111111111111111",
  slotHashes:             "SysvarS1otHashes111111111111111111111111111",
  stakeHistory:           "SysvarStakeHistory1111111111111111111111111",
  epochSchedule:          "SysvarEpochSchedu1e111111111111111111111111",
}

function resolveConstant(slotName: string): string | null {
  const lower = slotName.toLowerCase().replace(/[-_]/g, "")

  // Direct match first
  if (KNOWN_CONSTANTS[slotName] !== undefined) return KNOWN_CONSTANTS[slotName] ?? null

  // Fuzzy match: strip underscores/camelCase
  for (const [key, addr] of Object.entries(KNOWN_CONSTANTS)) {
    if (key.toLowerCase().replace(/[-_]/g, "") === lower) return addr
  }
  return null
}

// ─── PDA RESOLUTION ───────────────────────────────────────────────────────────
// Only attempt derivation when ALL seeds are "const" kind (no runtime inputs needed).

function tryDerivePda(
  slot: AccountSlot,
  schema: ProgramSchema
): string | null {
  if (slot.pda === null) return null

  const seeds: Buffer[] = []

  for (const seed of slot.pda.seeds) {
    if (seed.kind === "const") {
      if (seed.constBytes !== undefined) {
        seeds.push(Buffer.from(seed.constBytes))
      } else if (seed.path !== undefined) {
        seeds.push(Buffer.from(seed.path, "utf8"))
      } else {
        return null // can't resolve this seed without more info
      }
    } else {
      // "arg" or "account" seeds need runtime values — can't auto-derive
      return null
    }
  }

  let programId: PublicKey
  try {
    programId = new PublicKey(schema.address ?? "11111111111111111111111111111111")
  } catch {
    return null
  }

  try {
    const [address] = PublicKey.findProgramAddressSync(seeds, programId)
    return address.toBase58()
  } catch {
    return null
  }
}

// ─── CHAIN VALIDATION ─────────────────────────────────────────────────────────

async function validateOnChain(
  connection: Connection,
  address: string,
  slot: AccountSlot,
  schema: ProgramSchema
): Promise<{ valid: boolean; message: string | null }> {
  let pubkey: PublicKey
  try {
    pubkey = new PublicKey(address)
  } catch {
    return { valid: false, message: "Invalid public key" }
  }

  let info: Awaited<ReturnType<Connection["getAccountInfo"]>>
  try {
    info = await connection.getAccountInfo(pubkey, "confirmed")
  } catch {
    // Network error — treat as warning, not failure (account may still be valid)
    return { valid: true, message: "Could not validate on-chain (network error)" }
  }

  if (info === null) {
    // Account doesn't exist yet — may be newly created by this tx (e.g. init)
    // Return warning rather than error since it might be expected
    return { valid: true, message: "Account not found on-chain (may be created by this tx)" }
  }

  // If the IDL declares an owner (via the loaded program), check ownership
  if (schema.address !== null && slot.pda !== null) {
    const expectedOwner = schema.address
    const actualOwner = info.owner.toBase58()
    if (actualOwner !== expectedOwner) {
      return {
        valid: false,
        message: `Wrong owner: expected ${expectedOwner.slice(0, 6)}… got ${actualOwner.slice(0, 6)}…`,
      }
    }
  }

  return { valid: true, message: null }
}

// ─── MAIN RESOLUTION FUNCTION ─────────────────────────────────────────────────

export type ResolutionUpdate = {
  slotIndex: number
  status: AccountResolutionStatus
}

export async function resolveAccountSlots(
  slots: AccountSlot[],
  schema: ProgramSchema,
  walletAddress: string | null,
  connection: Connection,
  onUpdate: (update: ResolutionUpdate) => void
): Promise<void> {
  // Run all slot resolutions in parallel
  await Promise.all(
    slots.map(async (slot, index) => {
      // ── Step 1: constant check ─────────────────────────────────────────────
      const constantAddr = resolveConstant(slot.name)
      if (constantAddr !== null) {
        onUpdate({
          slotIndex: index,
          status: { kind: "resolved", address: constantAddr, source: "constant" },
        })
        return
      }

      // ── Step 2: PDA derivation (const-seeds only) ─────────────────────────
      if (slot.pda !== null) {
        onUpdate({ slotIndex: index, status: { kind: "resolving" } })
        const derived = tryDerivePda(slot, schema)
        if (derived !== null) {
          // Validate on-chain in the background
          const validation = await validateOnChain(connection, derived, slot, schema)
          if (validation.valid && validation.message === null) {
            onUpdate({
              slotIndex: index,
              status: { kind: "resolved", address: derived, source: "pda" },
            })
          } else if (validation.valid) {
            onUpdate({
              slotIndex: index,
              status: {
                kind: "warning",
                address: derived,
                source: "pda",
                message: validation.message ?? "",
              },
            })
          } else {
            onUpdate({
              slotIndex: index,
              status: { kind: "error", message: validation.message ?? "Validation failed" },
            })
          }
          return
        }
        // PDA seeds need runtime values — leave as idle for manual input
        onUpdate({ slotIndex: index, status: { kind: "idle" } })
        return
      }

      // ── Step 3: wallet signer ──────────────────────────────────────────────
      if (slot.isSigner && walletAddress !== null) {
        onUpdate({
          slotIndex: index,
          status: { kind: "resolved", address: walletAddress, source: "wallet" },
        })
        return
      }

      // ── Step 4: nothing matched — wait for manual input ───────────────────
      onUpdate({ slotIndex: index, status: { kind: "idle" } })
    })
  )
}

// ─── VALIDATE A MANUALLY ENTERED ADDRESS ─────────────────────────────────────

export async function validateManualAddress(
  connection: Connection,
  address: string,
  slot: AccountSlot,
  schema: ProgramSchema
): Promise<AccountResolutionStatus> {
  if (address.trim() === "") {
    return { kind: "idle" }
  }

  let pubkey: PublicKey
  try {
    pubkey = new PublicKey(address.trim())
  } catch {
    return { kind: "error", message: "Not a valid public key" }
  }

  const validation = await validateOnChain(connection, pubkey.toBase58(), slot, schema)

  if (validation.valid && validation.message === null) {
    return { kind: "manual", address: pubkey.toBase58() }
  }
  if (validation.valid && validation.message !== null) {
    return {
      kind: "warning",
      address: pubkey.toBase58(),
      source: "constant",
      message: validation.message,
    }
  }
  return { kind: "error", message: validation.message ?? "Validation failed" }
}