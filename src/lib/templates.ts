import { SystemProgram, PublicKey } from "@solana/web3.js"
import { createTransferInstruction } from "@solana/spl-token"
import { createAssociatedTokenAccountInstruction } from "@solana/spl-token"
export function buildSolTransfer({
  from,
  to,
  lamports,
}: {
  from: string
  to: string
  lamports: number
}) {
  return SystemProgram.transfer({
    fromPubkey: new PublicKey(from),
    toPubkey: new PublicKey(to),
    lamports,
  })
}



export function buildSplTransfer({
  source,
  destination,
  owner,
  amount,
}: {
  source: string
  destination: string
  owner: string
  amount: number
}) {
  return createTransferInstruction(
    new PublicKey(source),
    new PublicKey(destination),
    new PublicKey(owner),
    amount
  )
}



export function buildAta({
  payer,
  ata,
  owner,
  mint,
}: {
  payer: string
  ata: string
  owner: string
  mint: string
}) {
  return createAssociatedTokenAccountInstruction(
    new PublicKey(payer),
    new PublicKey(ata),
    new PublicKey(owner),
    new PublicKey(mint)
  )
}