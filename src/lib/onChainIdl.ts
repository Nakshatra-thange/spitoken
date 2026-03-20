import { Connection, PublicKey } from "@solana/web3.js"
import * as pako from "pako"

// ─── RPC SETUP ──────────────────────────────────────────────────────────────

const RPC_ENDPOINT =
  (import.meta as { env?: Record<string, string> }).env?.["VITE_RPC_ENDPOINT"] ??
  "https://api.devnet.solana.com"

let _connection: Connection | null = null

export function getConnection(): Connection {
  if (_connection === null) {
    _connection = new Connection(RPC_ENDPOINT, "confirmed")
  }
  return _connection
}

export function setRpcEndpoint(endpoint: string): void {
  _connection = new Connection(endpoint, "confirmed")
}

export { RPC_ENDPOINT }


// ─── ERROR CLASS ─────────────────────────────────────────────────────────────

export class OnChainIdlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OnChainIdlError"
  }
}


// ─── VALIDATION ──────────────────────────────────────────────────────────────

export function isValidPublicKey(value: string): boolean {
  try {
    new PublicKey(value)
    return true
  } catch {
    return false
  }
}


// ─── PDA DERIVATION ──────────────────────────────────────────────────────────

function deriveIdlAddress(programId: PublicKey): PublicKey {
  const seed = Buffer.from("anchor:idl")
  const [pda] = PublicKey.findProgramAddressSync([seed], programId)
  return pda
}


// ─── FETCH + DECODE IDL ──────────────────────────────────────────────────────

export async function fetchIdlFromChain(
  programIdStr: string,
  connection: Connection = getConnection()
): Promise<unknown> {

  if (!isValidPublicKey(programIdStr)) {
    throw new OnChainIdlError("Invalid program ID")
  }

  const programId = new PublicKey(programIdStr)
  const idlAddress = deriveIdlAddress(programId)

  const accountInfo = await connection.getAccountInfo(idlAddress)

  if (!accountInfo || !accountInfo.data) {
    throw new OnChainIdlError("IDL account not found on chain")
  }

  try {
    // Anchor IDL format:
    // 8 bytes discriminator + compressed data
    const compressed = accountInfo.data.slice(8)

    const decompressed = pako.inflate(compressed)

    const jsonStr = new TextDecoder().decode(decompressed)

    return JSON.parse(jsonStr)

  } catch (err) {
    throw new OnChainIdlError(
      err instanceof Error ? err.message : "Failed to decode IDL"
    )
  }
}