import { Connection } from "@solana/web3.js"

export type ConfirmationStatus =
  | "processed"
  | "confirmed"
  | "finalized"

export async function trackConfirmation(
  connection: Connection,
  signature: string,
  onUpdate: (status: ConfirmationStatus) => void
): Promise<void> {
  const start = Date.now()

  while (true) {
    const res = await connection.getSignatureStatuses([signature])
    const status = res.value[0]

    if (status?.confirmationStatus === "processed") {
      onUpdate("processed")
    }

    if (status?.confirmationStatus === "confirmed") {
      onUpdate("confirmed")
    }

    if (status?.confirmationStatus === "finalized") {
      onUpdate("finalized")
      return
    }

    if (Date.now() - start > 90_000) {
      throw new Error("Confirmation timeout")
    }

    await new Promise((r) => setTimeout(r, 2000))
  }
}