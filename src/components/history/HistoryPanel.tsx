import { loadHistory } from "../../lib/history"

export function HistoryPanel() {
  const history = loadHistory()

  if (history.length === 0) {
    return <div>No transactions yet</div>
  }

  return (
    <div className="history-panel">
      <h3>Recent Transactions</h3>

      {history.map((tx, i) => (
        <div key={i} className="history-item">
          <a
            href={`https://solscan.io/tx/${tx.signature}?cluster=devnet`}
            target="_blank"
          >
            {tx.signature.slice(0, 8)}...
          </a>

          <span>{tx.success ? "✅" : "❌"}</span>

          {tx.computeUnits && (
            <span>{tx.computeUnits.toLocaleString()} CU</span>
          )}
        </div>
      ))}
    </div>
  )
}