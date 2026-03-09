/**
 * txAssembler.ts
 *
 * Assembles a list of InstructionInstances into a Solana v0 VersionedTransaction
 * ready for simulateTransaction.
 *
 * Steps:
 *   1. For each instance, serialize args → Borsh bytes, collect resolved accounts
 *   2. Build a TransactionInstruction per instance
 *   3. Deduplicate accounts across all instructions
 *      - writability: union (if ANY ix marks it writable, it's writable)
 *      - signer:      union (same)
 *   4. Fetch recentBlockhash
 *   5. Assemble TransactionMessage (v0)
 *   6. Return a VersionedTransaction with NO signatures (sigVerify: false in sim)
 *
 * Account deduplication matches the Solana runtime's behaviour:
 *   - The account list in a transaction is deduplicated by address
 *   - Each account appears once; its flags are the union of all ix usages
 *   - Static accounts come first, then any address lookup table accounts
 *   - We use only static accounts here (no ALTs for now)
 */

import {
    Connection,
    PublicKey,
    TransactionInstruction,
    TransactionMessage,
    VersionedTransaction,
    type AccountMeta,
  } from "@solana/web3.js"
  
  import { type InstructionInstance } from "../types/builder"
  import { type ProgramSchema } from "../types/idl"
  import { serializeInstructionData, BorshSerializeError } from "./borshSerializer"
  import { getResolvedAddress } from "./txValidator"
  
  // ─── ERRORS ───────────────────────────────────────────────────────────────────
  
  export class TxAssemblyError extends Error {
    constructor(message: string, public readonly instructionIndex?: number) {
      super(message)
      this.name = "TxAssemblyError"
    }
  }
  
  // ─── RESULT ───────────────────────────────────────────────────────────────────
  
  export interface AssembledTransaction {
    /** The ready-to-simulate versioned transaction */
    transaction: VersionedTransaction
    /** One entry per instruction — which account addresses were used */
    instructionAccounts: { name: string; address: string }[][]
    /** The deduplicated, ordered flat account list */
    flatAccounts: { address: string; isMut: boolean; isSigner: boolean }[]
    /** The recentBlockhash used */
    recentBlockhash: string
    /** Serialized instruction data (one Uint8Array per instruction) */
    instructionData: Uint8Array[]
  }
  
  // ─── ASSEMBLY ─────────────────────────────────────────────────────────────────
  
  export async function assembleTransaction(
    instances: InstructionInstance[],
    schema: ProgramSchema,
    connection: Connection,
    /** Payer address — required for TransactionMessage. If null, use a placeholder. */
    payerAddress: string | null
  ): Promise<AssembledTransaction> {
    if (instances.length === 0) {
      throw new TxAssemblyError("No instructions to assemble")
    }
  
    // ── 1. Validate all accounts are resolved ─────────────────────────────────
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      if (inst === undefined) continue
      for (const slot of inst.accounts) {
        if (slot.isOptional) continue
        const addr = getResolvedAddress(slot.resolution)
        if (addr === null) {
          throw new TxAssemblyError(
            `Instruction ${i + 1} (${inst.definition.name}): account "${slot.name}" is not resolved`,
            i
          )
        }
      }
    }
  
    // ── 2. Build per-instruction data ─────────────────────────────────────────
    const instructionData: Uint8Array[] = []
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      if (inst === undefined) continue
      try {
        const data = serializeInstructionData(
          inst.definition.discriminator,
          inst.definition.args,
          inst.args,
          schema.typeRegistry
        )
        instructionData.push(data)
      } catch (err) {
        const msg = err instanceof BorshSerializeError
          ? err.message
          : err instanceof Error ? err.message : String(err)
        throw new TxAssemblyError(
          `Instruction ${i + 1} (${inst.definition.name}): serialization failed — ${msg}`,
          i
        )
      }
    }
  
    // ── 3. Collect per-instruction account metas ──────────────────────────────
    const instructionAccountMetas: AccountMeta[][] = []
    const instructionAccounts: { name: string; address: string }[][] = []
  
    // Global dedup map: address → { isMut, isSigner } — union of all ix usages
    const globalAccountMap = new Map<
      string,
      { isMut: boolean; isSigner: boolean }
    >()
  
    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]
      if (inst === undefined) continue
      const metas: AccountMeta[] = []
      const slotInfos: { name: string; address: string }[] = []
  
      for (let si = 0; si < inst.accounts.length; si++) {
        const slotState = inst.accounts[si]
        const slotDef = inst.definition.accounts[si]
        if (slotState === undefined || slotDef === undefined) continue
  
        const addr = getResolvedAddress(slotState.resolution)
        if (addr === null) {
          if (slotDef.isOptional) continue // skip optional unresolved
          // Already validated above, but be safe
          throw new TxAssemblyError(`Account "${slotDef.name}" not resolved`, i)
        }
  
        let pk: PublicKey
        try { pk = new PublicKey(addr) }
        catch { throw new TxAssemblyError(`Invalid public key for "${slotDef.name}": ${addr}`, i) }
  
        metas.push({ pubkey: pk, isSigner: slotDef.isSigner, isWritable: slotDef.isMut })
        slotInfos.push({ name: slotDef.name, address: addr })
  
        // Update global dedup — writable/signer are unions
        const existing = globalAccountMap.get(addr)
        if (existing !== undefined) {
          existing.isMut = existing.isMut || slotDef.isMut
          existing.isSigner = existing.isSigner || slotDef.isSigner
        } else {
          globalAccountMap.set(addr, { isMut: slotDef.isMut, isSigner: slotDef.isSigner })
        }
      }
  
      instructionAccountMetas.push(metas)
      instructionAccounts.push(slotInfos)
    }
  
    // ── 4. Get program ID for each instruction ────────────────────────────────
    // All instructions target the loaded program; we need its address.
    const programAddress = schema.address
    if (programAddress === null) {
      throw new TxAssemblyError("Program address unknown — cannot assemble transaction")
    }
    let programPubkey: PublicKey
    try { programPubkey = new PublicKey(programAddress) }
    catch { throw new TxAssemblyError(`Invalid program address: ${programAddress}`) }
  
    // ── 5. Build TransactionInstruction objects ────────────────────────────────
    const txInstructions: TransactionInstruction[] = instances.map((inst, i) => {
      const data = instructionData[i] ?? new Uint8Array(8)
      const keys = instructionAccountMetas[i] ?? []
      return new TransactionInstruction({
        programId: programPubkey,
        keys,
        data: Buffer.from(data),
      })
    })
  
    // ── 6. Fetch recent blockhash ─────────────────────────────────────────────
    let recentBlockhash: string
    try {
      const bh = await connection.getLatestBlockhash("confirmed")
      recentBlockhash = bh.blockhash
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new TxAssemblyError(`Failed to fetch recent blockhash: ${msg}`)
    }
  
    // ── 7. Determine payer ────────────────────────────────────────────────────
    // For simulation without signing, any valid pubkey works as payer.
    const PLACEHOLDER_PAYER = "11111111111111111111111111111111"
    const effectivePayer = payerAddress ?? PLACEHOLDER_PAYER
    let payerPubkey: PublicKey
    try { payerPubkey = new PublicKey(effectivePayer) }
    catch { payerPubkey = new PublicKey(PLACEHOLDER_PAYER) }
  
    // ── 8. Assemble v0 TransactionMessage ─────────────────────────────────────
    let message: TransactionMessage
    try {
      message = new TransactionMessage({
        payerKey: payerPubkey,
        recentBlockhash,
        instructions: txInstructions,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new TxAssemblyError(`TransactionMessage assembly failed: ${msg}`)
    }
  
    const compiledMessage = message.compileToV0Message()
    const transaction = new VersionedTransaction(compiledMessage)
    // No signatures — simulateTransaction will be called with sigVerify: false
  
    // ── 9. Flat account list for display ─────────────────────────────────────
    const flatAccounts: { address: string; isMut: boolean; isSigner: boolean }[] =
      Array.from(globalAccountMap.entries()).map(([address, flags]) => ({
        address,
        ...flags,
      }))
  
    return {
      transaction,
      instructionAccounts,
      flatAccounts,
      recentBlockhash,
      instructionData,
    }
  }