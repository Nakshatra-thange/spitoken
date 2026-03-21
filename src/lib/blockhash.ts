import { Connection } from "@solana/web3.js"

export interface BlockhashWithExpiry {
  blockhash: string
  lastValidBlockHeight: number
  fetchedAt: number
}

export async function getBlockhashWithExpiry(
  connection: Connection
): Promise<BlockhashWithExpiry> {
  const res = await connection.getLatestBlockhash("confirmed")

  return {
    blockhash: res.blockhash,
    lastValidBlockHeight: res.lastValidBlockHeight,
    fetchedAt: Date.now(),
  }
}

export function isBlockhashExpired(
  currentBlockHeight: number,
  lastValidBlockHeight: number
): boolean {
  return currentBlockHeight > lastValidBlockHeight
}