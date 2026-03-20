import { useState , useEffect } from "react"
import { useWallet } from "@solana/wallet-adapter-react"
import { getConnection } from "../../lib/connection"
import { sendWithRetry } from "../../lib/executor"
import { trackConfirmation } from "../../lib/confirmation"
import { type AssembledTransaction } from "../../lib/txAssembler"
import { fetchFinalTransaction } from "../../lib/postExecution"
import { analyzeFailure } from "../../lib/failureParser"
import { ReviewModal } from "./ReviewModal"
export function ExecutePanel({
  assembled,
}: {
  assembled: AssembledTransaction | null
}) {
  const { publicKey, signTransaction } = useWallet()
  const [expiry, setExpiry] = useState<number | null>(null)

  const [status, setStatus] = useState<string>("idle")
  const [signature, setSignature] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [showReview, setShowReview] = useState(false)
  const now = Date.now()
  setExpiry(now + 60000) // ~60s validity
  useEffect(() => {
    if (!expiry) return
  
    const interval = setInterval(() => {
      const remaining = Math.max(0, expiry - Date.now())
      if (remaining === 0) {
        setStatus("expired")
      }
    }, 1000)
  
    return () => clearInterval(interval)
  }, [expiry])

  const handleExecute = async () => {
    if (!assembled || !publicKey || !signTransaction) return
  
    const connection = getConnection()
  
    try {
      setStatus("signing")
  
      const signed = await signTransaction(assembled.transaction)
  
      setStatus("sending")
  
      const sig = await sendWithRetry(connection, signed)
      setSignature(sig)
  
      setStatus("confirming")
  
      await trackConfirmation(connection, sig, (s) => {
        setStatus(s)
      })
  
      // ─── POST EXECUTION ───────────────────────────
      setStatus("fetching")
  
      const tx = await fetchFinalTransaction(connection, sig)
  
      const analysis = analyzeFailure(tx)
  
      console.log("Post Execution:", {
        tx,
        analysis,
      })
  
      setStatus("done")
    } catch (err) {
      setStatus("error")
      console.error(err)
    }
  }

  return (
    <div className="execute-panel">
      <button onClick={() => setShowReview(true)}>
  Execute Transaction
</button>

{expiry && (
  <div>
    Expires in: {Math.max(0, Math.floor((expiry - Date.now()) / 1000))}s
  </div>
)}
<ReviewModal
  open={showReview}
  onClose={() => setShowReview(false)}
  onConfirm={async () => {
    setShowReview(false)
    await handleExecute()
  }}
  assembled={assembled!}
  computeUnits={200000}
  priorityFee={0}
/>

      <div>Status: {status}</div>
      {status === "confirming" && (
  <button
    onClick={async () => {
      if (!signature) return
      setRetryCount((c) => c + 1)
      await getConnection().sendRawTransaction(
        assembled!.transaction.serialize()
      )
    }}
  >
    Rebroadcast ({retryCount})
  </button>
)}

      {signature && (
        <a
          href={`https://solscan.io/tx/${signature}?cluster=devnet`}
          target="_blank"
        >
          View on Explorer
        </a>

        
      )}
    </div>
  )
}