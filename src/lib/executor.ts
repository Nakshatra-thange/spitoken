import {
  Connection,
  VersionedTransaction,
  ComputeBudgetProgram,
  TransactionInstruction,
  TransactionMessage,
  PublicKey,
} from "@solana/web3.js"

// ─── TYPES ────────────────────────────────────────────────────────────────────

export interface ExecuteConfig {
  computeUnits: number
  microLamports: number
}

export interface ExecuteResult {
  signature: string
}

export class ExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ExecutionError"
  }
}

// ─── BUILD FINAL TX (WITH COMPUTE BUDGET) ─────────────────────────────────────

export async function buildFinalTransaction(
  connection: Connection,
  baseTx: VersionedTransaction,
  config: ExecuteConfig
): Promise<VersionedTransaction> {

  const latest = await connection.getLatestBlockhash("confirmed")

  const message = baseTx.message
  const accountKeys = message.staticAccountKeys

  // ── Reconstruct original instructions (SAFE WAY) ──
  const originalInstructions: TransactionInstruction[] =
    message.compiledInstructions.map((ci) => {
      return new TransactionInstruction({
        programId: accountKeys[ci.programIdIndex],
        keys: ci.accountKeyIndexes.map((idx) => ({
          pubkey: accountKeys[idx],
          isSigner: message.isAccountSigner(idx),
          isWritable: message.isAccountWritable(idx),
        })),
        data: Buffer.from(ci.data),
      })
    })

  // ── Add compute budget FIRST ──
  const instructions: TransactionInstruction[] = [
    ComputeBudgetProgram.setComputeUnitLimit({
      units: config.computeUnits,
    }),
    ComputeBudgetProgram.setComputeUnitPrice({
      microLamports: config.microLamports,
    }),
    ...originalInstructions,
  ]

  const payer =
    accountKeys[0] ??
    new PublicKey("11111111111111111111111111111111")

  const newMessage = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: latest.blockhash,
    instructions,
  })

  const compiled = newMessage.compileToV0Message()
  return new VersionedTransaction(compiled)
}

// ─── SEND WITH RETRY ─────────────────────────────────────────────────────────

export async function sendWithRetry(
  connection: Connection,
  tx: VersionedTransaction,
  maxRetries = 3
): Promise<string> {
  let attempt = 0

  while (attempt < maxRetries) {
    try {
      const sig = await connection.sendRawTransaction(tx.serialize(), {
        skipPreflight: false,
      })
      return sig
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)

      // ── Blockhash expired ──
      if (msg.includes("BlockhashNotFound")) {
        throw new ExecutionError("Blockhash expired. Please re-sign.")
      }

      // ── Retryable RPC errors ──
      if (
        msg.includes("Node is unhealthy") ||
        msg.includes("timeout") ||
        msg.includes("429")
      ) {
        await delay(500 * Math.pow(2, attempt))
        attempt++
        continue
      }

      throw new ExecutionError(msg)
    }
  }

  throw new ExecutionError("Max retries exceeded")
}

// ─── UTILS ───────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}