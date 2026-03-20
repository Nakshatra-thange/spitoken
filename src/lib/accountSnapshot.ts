/**
 * accountSnapshot.ts
 *
 * Fetches the current on-chain state of a set of accounts immediately before
 * simulation. Returns a map from address → snapshot. Used to build before/after
 * diffs with the simulation response.
 *
 * We use getMultipleAccountsInfo (a single RPC call for up to 100 accounts)
 * rather than one request per account.
 */

import { Connection, PublicKey } from "@solana/web3.js"

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface AccountSnapshot {
  address: string
  /** null = account does not exist on-chain */
  exists: boolean
  lamports: number
  owner: string
  /** Raw account data bytes */
  data: Uint8Array
  /** base64-encoded data (for quick display without re-encoding) */
  dataBase64: string
  executable: boolean
  rentEpoch: number
}

export type SnapshotMap = Map<string, AccountSnapshot>

// ─── FETCH ────────────────────────────────────────────────────────────────────

/**
 * Fetch pre-simulation snapshots for the given addresses.
 * Addresses that don't exist on-chain are still included in the map with
 * `exists: false` — this lets the diff display show "Created" correctly.
 *
 * Returns a Map keyed by the original address string.
 */
export async function fetchAccountSnapshots(
  connection: Connection,
  addresses: string[]
): Promise<SnapshotMap> {
  const map: SnapshotMap = new Map()

  if (addresses.length === 0) return map

  // Deduplicate
  const unique = [...new Set(addresses)]

  // Convert to PublicKey[], skipping invalid ones
  const pubkeys: PublicKey[] = []
  const validAddresses: string[] = []

  for (const addr of unique) {
    try {
      pubkeys.push(new PublicKey(addr))
      validAddresses.push(addr)
    } catch {
      // Invalid pubkey — record as non-existent
      map.set(addr, makeNotFound(addr))
    }
  }

  if (pubkeys.length === 0) return map

  // Batch in chunks of 100 (getMultipleAccountsInfo limit)
  const CHUNK_SIZE = 100
  for (let i = 0; i < pubkeys.length; i += CHUNK_SIZE) {
    const chunk = pubkeys.slice(i, i + CHUNK_SIZE)
    const addrs = validAddresses.slice(i, i + CHUNK_SIZE)

    let results: Awaited<ReturnType<typeof connection.getMultipleAccountsInfo>>

    try {
      results = await connection.getMultipleAccountsInfo(chunk, "confirmed")
    } catch {
      // Network error — record all as not-found
      for (const addr of addrs) map.set(addr, makeNotFound(addr))
      continue
    }

    for (let j = 0; j < addrs.length; j++) {
      const addr = addrs[j]
      const info = results[j]

      if (addr === undefined) continue

      if (info === null || info === undefined) {
        map.set(addr, makeNotFound(addr))
        continue
      }

      const rawData: Uint8Array =
        info.data instanceof Buffer
          ? new Uint8Array(info.data)
          : info.data instanceof Uint8Array
          ? info.data
          : new Uint8Array(0)

      map.set(addr, {
        address: addr,
        exists: true,
        lamports: info.lamports,
        owner: info.owner.toBase58(),
        data: rawData,
        dataBase64: bufToBase64(rawData),
        executable: info.executable,
        rentEpoch: info.rentEpoch ?? 0,
      })
    }
  }

  return map
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function makeNotFound(address: string): AccountSnapshot {
  return {
    address,
    exists: false,
    lamports: 0,
    owner: "11111111111111111111111111111111",
    data: new Uint8Array(0),
    dataBase64: "",
    executable: false,
    rentEpoch: 0,
  }
}

function bufToBase64(data: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < data.byteLength; i++) {
    binary += String.fromCharCode(data[i] ?? 0)
  }
  return btoa(binary)
}