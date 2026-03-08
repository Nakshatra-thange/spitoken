/**
 * accountFetcher.ts
 *
 * Fetches an on-chain account, runs discriminator detection against the loaded
 * IDL's accountRegistry, and returns a rich AccountInspectResult for the UI.
 *
 * Flow:
 *   address string
 *     → getAccountInfo (RPC)
 *     → match first 8 bytes against accountRegistry discriminators
 *     → if match: decode via borshDecoder
 *     → return AccountInspectResult
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js"
import { type ProgramSchema, type AccountDefinition } from "../types/idl"
import {
  decodeAccountData,
  toHex,
  toHexSpaced,
  toBase64,
  type DecodeResult,
  BorshDecodeError,
} from "./borshDecoder"

// ─── RESULT TYPES ─────────────────────────────────────────────────────────────

export interface RawAccountInfo {
  /** base58 address */
  address: string
  /** SOL balance */
  lamports: number
  solBalance: string
  /** Owning program address (base58) */
  owner: string
  /** Well-known name for the owner program, if we recognise it */
  ownerName: string | null
  executable: boolean
  rentEpoch: number
  dataLength: number
  /** Full hex dump with ASCII side-panel, grouped in 16-byte rows */
  hexDump: string
  /** Continuous hex string (no spaces) */
  hexRaw: string
  /** Base64 encoded data */
  base64: string
  /** The raw bytes */
  raw: Uint8Array
}

export type DiscriminatorMatch =
  | { matched: true; accountDef: AccountDefinition; decodeResult: DecodeResult; decodeError: null }
  | { matched: true; accountDef: AccountDefinition; decodeResult: null; decodeError: string }
  | { matched: false }

export interface AccountInspectResult {
  raw: RawAccountInfo
  discriminatorMatch: DiscriminatorMatch
}

// ─── WELL-KNOWN PROGRAM NAMES ─────────────────────────────────────────────────

const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111":           "System Program",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token Program",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token-2022 Program",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJe8bG": "Associated Token Program",
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s": "Metaplex Token Metadata",
  "namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX": "Name Service",
  "BPFLoaderUpgradeab1e11111111111111111111111":  "BPF Upgradeable Loader",
  "ComputeBudget111111111111111111111111111111":  "Compute Budget Program",
  "Sysvar1111111111111111111111111111111111111":  "Sysvar",
  "SysvarRent111111111111111111111111111111111":  "Sysvar: Rent",
  "SysvarC1ock11111111111111111111111111111111":  "Sysvar: Clock",
  "Vote111111111111111111111111111111111111111h": "Vote Program",
  "Stake11111111111111111111111111111111111111":  "Stake Program",
}

function ownerName(address: string): string | null {
  return KNOWN_PROGRAMS[address] ?? null
}

// ─── DISCRIMINATOR MATCHING ───────────────────────────────────────────────────

function matchDiscriminator(
  data: Uint8Array,
  schema: ProgramSchema
): AccountDefinition | null {
  if (data.length < 8) return null

  for (const [, accountDef] of schema.accountRegistry) {
    const disc = accountDef.discriminator
    let match = true
    for (let i = 0; i < 8; i++) {
      if (data[i] !== disc[i]) {
        match = false
        break
      }
    }
    if (match) return accountDef
  }
  return null
}

// ─── MAIN FETCHER ─────────────────────────────────────────────────────────────

export class AccountFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccountFetchError"
  }
}

export async function fetchAndInspectAccount(
  connection: Connection,
  addressStr: string,
  schema: ProgramSchema | null
): Promise<AccountInspectResult> {
  // ── 1. Parse address ────────────────────────────────────────────────────────
  let pubkey: PublicKey
  try {
    pubkey = new PublicKey(addressStr.trim())
  } catch {
    throw new AccountFetchError(`"${addressStr}" is not a valid Solana public key`)
  }

  // ── 2. Fetch from chain ──────────────────────────────────────────────────────
  let info: Awaited<ReturnType<Connection["getAccountInfo"]>>
  try {
    info = await connection.getAccountInfo(pubkey, "confirmed")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new AccountFetchError(`RPC error: ${msg}`)
  }

  if (info === null) {
    throw new AccountFetchError(
      `Account ${addressStr} does not exist on this cluster`
    )
  }

  const raw = info.data instanceof Uint8Array ? info.data : new Uint8Array(info.data)
  const ownerAddr = info.owner.toBase58()

  const rawInfo: RawAccountInfo = {
    address: pubkey.toBase58(),
    lamports: info.lamports,
    solBalance: (info.lamports / LAMPORTS_PER_SOL).toFixed(9),
    owner: ownerAddr,
    ownerName: ownerName(ownerAddr),
    executable: info.executable,
    rentEpoch: Number(info.rentEpoch ?? 0),
    dataLength: raw.length,
    hexDump: toHexSpaced(raw),
    hexRaw: toHex(raw),
    base64: toBase64(raw),
    raw,
  }

  // ── 3. Discriminator match ────────────────────────────────────────────────────
  if (schema === null) {
    return { raw: rawInfo, discriminatorMatch: { matched: false } }
  }

  const accountDef = matchDiscriminator(raw, schema)
  if (accountDef === null) {
    return { raw: rawInfo, discriminatorMatch: { matched: false } }
  }

  // ── 4. Borsh decode ───────────────────────────────────────────────────────────
  try {
    const decodeResult = decodeAccountData(raw, accountDef.fields, schema.typeRegistry, 8)
    return {
      raw: rawInfo,
      discriminatorMatch: {
        matched: true,
        accountDef,
        decodeResult,
        decodeError: null,
      },
    }
  } catch (err) {
    const msg =
      err instanceof BorshDecodeError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err)
    return {
      raw: rawInfo,
      discriminatorMatch: {
        matched: true,
        accountDef,
        decodeResult: null,
        decodeError: msg,
      },
    }
  }
}