/**
 * pdaCalculator.ts
 *
 * Derives Program Derived Addresses from a program ID and an ordered list of
 * seeds. Each seed can be one of three types:
 *
 *   "string"  → UTF-8 encode the text → seed bytes
 *   "hex"     → parse hex string → seed bytes
 *   "pubkey"  → decode base58 public key → 32-byte seed
 *
 * PublicKey.findProgramAddressSync iterates bump from 255 down to 0, hashing
 * [seed0, seed1, ..., seedN, programId, "ProgramDerivedAddress"] with SHA-256
 * until it finds a point not on the ed25519 curve. The first valid address and
 * its bump are returned.
 *
 * Note: findProgramAddressSync runs synchronously and is CPU-bound for a few
 * milliseconds. That's fine for interactive use — no need to web-worker it.
 */

import { PublicKey } from "@solana/web3.js"

// ─── SEED TYPES ───────────────────────────────────────────────────────────────

export type SeedKind = "string" | "hex" | "pubkey"

export interface SeedInput {
  id: string           // stable React key
  kind: SeedKind
  value: string        // raw user input
}

export interface SeedValidation {
  valid: boolean
  errorMessage: string | null
  /** The actual bytes this seed resolves to, null if invalid */
  bytes: Buffer | null
}

export interface PdaResult {
  address: string
  bump: number
  seedBytes: string[]  // hex representation of each seed's bytes (for display)
}

// ─── SEED VALIDATION ──────────────────────────────────────────────────────────

export function validateSeed(seed: SeedInput): SeedValidation {
  const { kind, value } = seed

  if (value.trim() === "") {
    return { valid: false, errorMessage: "Seed value is required", bytes: null }
  }

  switch (kind) {
    case "string": {
      const bytes = Buffer.from(value, "utf8")
      if (bytes.length > 32) {
        return {
          valid: false,
          errorMessage: `String seed is ${bytes.length} bytes — seeds must be ≤32 bytes`,
          bytes: null,
        }
      }
      return { valid: true, errorMessage: null, bytes }
    }

    case "hex": {
      const cleaned = value.replace(/\s/g, "").replace(/^0x/i, "")
      if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
        return { valid: false, errorMessage: "Contains non-hex characters", bytes: null }
      }
      if (cleaned.length % 2 !== 0) {
        return { valid: false, errorMessage: "Odd number of hex digits", bytes: null }
      }
      const bytes = Buffer.from(cleaned, "hex")
      if (bytes.length > 32) {
        return {
          valid: false,
          errorMessage: `Hex seed is ${bytes.length} bytes — seeds must be ≤32 bytes`,
          bytes: null,
        }
      }
      return { valid: true, errorMessage: null, bytes }
    }

    case "pubkey": {
      try {
        const pk = new PublicKey(value.trim())
        return { valid: true, errorMessage: null, bytes: Buffer.from(pk.toBytes()) }
      } catch {
        return { valid: false, errorMessage: "Not a valid base58 public key", bytes: null }
      }
    }
  }
}

// ─── MAIN DERIVATION ──────────────────────────────────────────────────────────

export class PdaDerivationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "PdaDerivationError"
  }
}

export function derivePda(
  programIdStr: string,
  seeds: SeedInput[]
): PdaResult {
  // 1. Validate program ID
  let programId: PublicKey
  try {
    programId = new PublicKey(programIdStr.trim())
  } catch {
    throw new PdaDerivationError(`"${programIdStr}" is not a valid program ID`)
  }

  // 2. Validate and resolve all seeds
  const seedBuffers: Buffer[] = []
  const seedBytesDisplay: string[] = []

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i]
    if (seed === undefined) continue
    const validation = validateSeed(seed)
    if (!validation.valid || validation.bytes === null) {
      throw new PdaDerivationError(
        `Seed ${i + 1} (${seed.kind}): ${validation.errorMessage ?? "invalid"}`
      )
    }
    seedBuffers.push(validation.bytes)
    seedBytesDisplay.push(
      Array.from(validation.bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    )
  }

  // 3. Derive
  let address: PublicKey
  let bump: number
  try {
    ;[address, bump] = PublicKey.findProgramAddressSync(seedBuffers, programId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new PdaDerivationError(`Derivation failed: ${msg}`)
  }

  return {
    address: address.toBase58(),
    bump,
    seedBytes: seedBytesDisplay,
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

let _nextId = 0
export function newSeedId(): string {
  return `seed_${++_nextId}`
}

export function emptyStringInput(id?: string): SeedInput {
  return { id: id ?? newSeedId(), kind: "string", value: "" }
}