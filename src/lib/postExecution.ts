import { Connection, type ParsedTransactionWithMeta } from "@solana/web3.js"
import { fetchAccountSnapshots } from "./accountSnapshot"
import { type SnapshotMap } from "./accountSnapshot"
import { type AccountDiff } from "./simulator"

// ─── FETCH TX ────────────────────────────────────────────────────────────────

export async function fetchFinalTransaction(
  connection: Connection,
  signature: string
): Promise<ParsedTransactionWithMeta | null> {
  return await connection.getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  })
}

// ─── POST EXECUTION DIFF ─────────────────────────────────────────────────────

export async function buildPostExecutionDiff(
  connection: Connection,
  addresses: string[],
  beforeSnapshots: SnapshotMap
): Promise<AccountDiff[]> {
  const afterSnapshots = await fetchAccountSnapshots(connection, addresses)

  return addresses.map((address) => {
    const before = beforeSnapshots.get(address) ?? null
    const after = afterSnapshots.get(address) ?? null

    const lamportsBefore = before?.lamports ?? null
    const lamportsAfter = after?.lamports ?? null

    const existedBefore = before?.exists ?? false

    const wasCreated = !existedBefore && (lamportsAfter ?? 0) > 0
    const wasClosed =
      existedBefore &&
      (lamportsBefore ?? 0) > 0 &&
      (lamportsAfter ?? 0) === 0

    return {
      address,
      dataBefore: before?.dataBase64 ?? null,
      rawDataBefore: before?.data ?? null,
      lamportsBefore,
      ownerBefore: before?.owner ?? null,
      existedBefore,

      dataAfter: after?.dataBase64 ?? null,
      rawDataAfter: after?.data ?? null,
      lamportsAfter,
      ownerAfter: after?.owner ?? null,

      wasCreated,
      wasClosed,
      dataChanged: before?.dataBase64 !== after?.dataBase64,
      lamportDelta:
        lamportsBefore !== null && lamportsAfter !== null
          ? lamportsAfter - lamportsBefore
          : null,
    }
  })
}