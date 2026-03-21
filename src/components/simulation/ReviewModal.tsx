import { type AssembledTransaction } from "../../lib/txAssembler"

export function ReviewModal({
  open,
  onClose,
  onConfirm,
  assembled,
  computeUnits,
  priorityFee,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  assembled: AssembledTransaction
  computeUnits: number
  priorityFee: number
}) {
  if (!open) return null

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h2>Review Transaction</h2>

        <div className="modal-section">
          <strong>Instructions:</strong>
          <div>{assembled.instructions.length} instruction(s)</div>
        </div>

        <div className="modal-section">
          <strong>Compute Units:</strong>
          <div>{computeUnits.toLocaleString()}</div>
        </div>

        <div className="modal-section">
          <strong>Priority Fee:</strong>
          <div>{priorityFee} μL/CU</div>
        </div>

        <div className="modal-actions">
          <button onClick={onClose}>Cancel</button>
          <button onClick={onConfirm}>Sign & Send</button>
        </div>
      </div>
    </div>
  )
}