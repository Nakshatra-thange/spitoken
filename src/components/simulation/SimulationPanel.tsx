/**
 * SimulationPanel.tsx
 *
 * The Day 3 Morning UI panel. Lives as its own tab in the workspace.
 * 
 * Sections:
 *  ┌─ Simulate button + status bar
 *  ├─ Result header (success / failed + error)
 *  ├─ Compute units: consumed, recommended limit, CU budget bar
 *  ├─ Per-instruction breakdown with CPI tree
 *  ├─ Log viewer (filterable)
 *  ├─ Account diffs (writable accounts before/after)
 *  └─ Priority fee recommender (3 tiers + custom)
 */

import React, { useState, useCallback, useMemo } from "react"
import { useBuilderStore } from "../../store/builderStore"
import { useAppStore } from "../../store/appStore"
import { getConnection } from "../../lib/connection"
import { assembleTransaction, TxAssemblyError, type AssembledTransaction } from "../../lib/txAssembler"
import { simulateAndParse, type SimulationResult, type CpiFrame, type PriorityFeeTier } from "../../simulator"
//import { getResolvedAddress } from "../lib/txValidator"

// ─── STATE ───────────────────────────────────────────────────────────────────

type SimStatus =
  | { phase: "idle" }
  | { phase: "assembling" }
  | { phase: "simulating" }
  | { phase: "done"; result: SimulationResult }
  | { phase: "error"; message: string }

// ─── SIMULATE BUTTON BAR ─────────────────────────────────────────────────────

function SimulateBar({
  status,
  canSimulate,
  onSimulate,
}: {
  status: SimStatus
  canSimulate: boolean
  onSimulate: () => void
}): React.ReactNode {
  const isRunning = status.phase === "assembling" || status.phase === "simulating"

  return (
    <div className="sim-bar">
      <div className="sim-bar__left">
        <button
          className={`sim-run-btn ${isRunning ? "sim-run-btn--running" : ""}`}
          onClick={onSimulate}
          disabled={!canSimulate || isRunning}
          type="button"
        >
          {isRunning ? (
            <>
              <SimSpinner />
              {status.phase === "assembling" ? "Assembling…" : "Simulating…"}
            </>
          ) : (
            <>
              <span className="sim-run-btn__icon">▶</span>
              Simulate Transaction
            </>
          )}
        </button>

        <span className="sim-bar__hint">
          sigVerify: false · replaceRecentBlockhash: true · commitment: confirmed
        </span>
      </div>

      {status.phase === "done" && (
        <span className={`sim-bar__badge ${status.result.success ? "sim-bar__badge--ok" : "sim-bar__badge--fail"}`}>
          {status.result.success ? "✓ Success" : "✕ Failed"}
        </span>
      )}
    </div>
  )
}

// ─── COMPUTE UNITS PANEL ──────────────────────────────────────────────────────

function ComputeUnitsPanel({ result }: { result: SimulationResult }): React.ReactNode {
  const cu = result.totalUnitsConsumed
  const rec = result.computeRecommendation

  if (cu === null) return null

  const pct = Math.min(100, (cu / 1_400_000) * 100)
  const color = pct < 50 ? "green" : pct < 85 ? "yellow" : "red"

  return (
    <div className="sim-section">
      <div className="sim-section-title">Compute Units</div>
      <div className="sim-cu-grid">
        <div className="sim-cu-card">
          <span className={`sim-cu-card__value sim-cu-card__value--${color}`}>
            {cu.toLocaleString()}
          </span>
          <span className="sim-cu-card__label">consumed</span>
        </div>

        {rec !== null && (
          <div className="sim-cu-card">
            <span className="sim-cu-card__value sim-cu-card__value--accent">
              {rec.recommended.toLocaleString()}
            </span>
            <span className="sim-cu-card__label">recommended limit</span>
            <span className="sim-cu-card__sub">consumed × 1.15, rounded to 1k</span>
          </div>
        )}

        <div className="sim-cu-card">
          <span className="sim-cu-card__value">
            {(1_400_000 - cu).toLocaleString()}
          </span>
          <span className="sim-cu-card__label">remaining budget</span>
        </div>
      </div>

      <div className="sim-cu-bar">
        <div className="sim-cu-bar__track">
          <div
            className={`sim-cu-bar__fill sim-cu-bar__fill--${color}`}
            style={{ width: `${pct}%` }}
          />
          {rec !== null && (
            <div
              className="sim-cu-bar__rec-marker"
              style={{ left: `${Math.min(100, (rec.recommended / 1_400_000) * 100)}%` }}
              title={`Recommended limit: ${rec.recommended.toLocaleString()} CU`}
            />
          )}
        </div>
        <span className="sim-cu-bar__label">
          {pct.toFixed(1)}% of 1.4M CU transaction budget
        </span>
      </div>

      {rec !== null && (
        <div className="sim-cu-setlimit-hint">
          <span className="sim-cu-setlimit-hint__icon">ℹ</span>
          Set compute unit limit to <code>{rec.recommended.toLocaleString()}</code> using{" "}
          <code>ComputeBudgetProgram.setComputeUnitLimit</code> to optimize fees.
        </div>
      )}
    </div>
  )
}

// ─── CPI TREE ─────────────────────────────────────────────────────────────────

function CpiNode({ frame, depth }: { frame: CpiFrame; depth: number }): React.ReactNode {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = frame.children.length > 0 || frame.logs.length > 0

  const shortId = `${frame.programId.slice(0, 4)}…${frame.programId.slice(-4)}`

  return (
    <div className="cpi-node" style={{ paddingLeft: `${depth * 18}px` }}>
      <div
        className={`cpi-node__header ${hasChildren ? "cpi-node__header--toggle" : ""}`}
        onClick={hasChildren ? () => setOpen((v) => !v) : undefined}
        role={hasChildren ? "button" : undefined}
        aria-expanded={hasChildren ? open : undefined}
      >
        <span className="cpi-node__chevron">{hasChildren ? (open ? "▾" : "▸") : " "}</span>
        <span className={`cpi-node__status ${frame.success ? "cpi-node__status--ok" : "cpi-node__status--fail"}`}>
          {frame.success ? "✓" : "✕"}
        </span>
        <code className="cpi-node__id" title={frame.programId}>{shortId}</code>
        {frame.unitsConsumed !== null && (
          <span className="cpi-node__cu">{frame.unitsConsumed.toLocaleString()} CU</span>
        )}
        {frame.failReason !== null && (
          <span className="cpi-node__fail">{frame.failReason}</span>
        )}
      </div>

      {open && hasChildren && (
        <div className="cpi-node__body">
          {frame.logs
            .filter((l) => l.startsWith("Program log:"))
            .map((l, i) => (
              <div key={i} className="cpi-log-line">{l.replace("Program log: ", "")}</div>
            ))}
          {frame.children.map((child, i) => (
            <CpiNode key={i} frame={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── PER-INSTRUCTION BREAKDOWN ────────────────────────────────────────────────

function InstructionBreakdown({ result }: { result: SimulationResult }): React.ReactNode {
  if (result.instructions.length === 0) return null

  return (
    <div className="sim-section">
      <div className="sim-section-title">
        Per-Instruction Breakdown
        <span className="sim-section-count">{result.instructions.length}</span>
      </div>
      <div className="sim-ix-list">
        {result.instructions.map((ix, i) => (
          <div
            key={i}
            className={`sim-ix-card ${ix.success ? "sim-ix-card--ok" : "sim-ix-card--fail"}`}
          >
            <div className="sim-ix-card__header">
              <span className="sim-ix-card__num">#{i + 1}</span>
              <code className="sim-ix-card__program">
                {ix.programId.slice(0, 4)}…{ix.programId.slice(-4)}
              </code>
              <span className={`sim-ix-card__badge ${ix.success ? "sim-ix-card__badge--ok" : "sim-ix-card__badge--fail"}`}>
                {ix.success ? "success" : "failed"}
              </span>
              {ix.unitsConsumed !== null && (
                <span className="sim-ix-card__cu">{ix.unitsConsumed.toLocaleString()} CU</span>
              )}
            </div>

            {ix.failReason !== null && (
              <div className="sim-ix-card__error">{ix.failReason}</div>
            )}

            {ix.cpiTree.length > 0 && (
              <div className="sim-ix-card__cpi">
                {ix.cpiTree.map((frame, j) => (
                  <CpiNode key={j} frame={frame} depth={0} />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── LOG VIEWER ───────────────────────────────────────────────────────────────

function LogViewer({ logs }: { logs: string[] }): React.ReactNode {
  const [filter, setFilter] = useState("")
  const [showAll, setShowAll] = useState(false)

  const filtered = useMemo(
    () =>
      filter.trim() === ""
        ? logs
        : logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase())),
    [logs, filter]
  )

  const visible = showAll ? filtered : filtered.slice(0, 50)
  const hasMore = filtered.length > 50

  return (
    <div className="sim-section">
      <div className="sim-section-title">
        Logs
        <span className="sim-section-count">{logs.length}</span>
      </div>
      <div className="sim-log-toolbar">
        <input
          className="sim-log-filter"
          type="text"
          placeholder="Filter logs…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <button
          className="sim-log-copy"
          onClick={() => void navigator.clipboard.writeText(logs.join("\n"))}
          type="button"
        >
          Copy all
        </button>
      </div>
      <div className="sim-log-viewer">
        {visible.map((line, i) => (
          <LogLine key={i} line={line} />
        ))}
        {hasMore && !showAll && (
          <button
            className="sim-log-more"
            onClick={() => setShowAll(true)}
            type="button"
          >
            Show {filtered.length - 50} more lines
          </button>
        )}
        {filtered.length === 0 && (
          <div className="sim-log-empty">No logs match "{filter}"</div>
        )}
      </div>
    </div>
  )
}

function logLineClass(line: string): string {
  if (line.includes(" failed") || line.includes("Error") || line.includes("error")) return "log-line--error"
  if (line.includes("Program log:")) return "log-line--userlog"
  if (line.includes("invoke")) return "log-line--invoke"
  if (line.includes("success")) return "log-line--success"
  if (line.includes("consumption:")) return "log-line--cu"
  return "log-line--default"
}

function LogLine({ line }: { line: string }): React.ReactNode {
  return (
    <div className={`log-line ${logLineClass(line)}`}>
      {line}
    </div>
  )
}

// ─── ACCOUNT DIFFS ────────────────────────────────────────────────────────────

function AccountDiffsPanel({ result }: { result: SimulationResult }): React.ReactNode {
  const diffs = result.accountDiffs.filter((d) => d.changed)
  if (diffs.length === 0) return null

  return (
    <div className="sim-section">
      <div className="sim-section-title">
        Writable Account State
        <span className="sim-section-count">{diffs.length}</span>
      </div>
      <div className="sim-diffs-list">
        {diffs.map((diff) => (
          <div key={diff.address} className="sim-diff-row">
            <div className="sim-diff-row__header">
              <code className="sim-diff-row__addr">
                {diff.address.slice(0, 6)}…{diff.address.slice(-4)}
              </code>
              <button
                className="sim-diff-copy"
                onClick={() => void navigator.clipboard.writeText(diff.address)}
                type="button"
                title="Copy address"
              >
                ⧉
              </button>
              {diff.lamportsAfter !== null && (
                <span className="sim-diff-row__lamports">
                  {diff.lamportsAfter.toLocaleString()} lamports
                </span>
              )}
              {diff.ownerAfter !== null && (
                <span className="sim-diff-row__owner" title={diff.ownerAfter}>
                  owned by {diff.ownerAfter.slice(0, 4)}…
                </span>
              )}
            </div>
            {diff.dataAfter !== null && (
              <div className="sim-diff-row__data">
                <span className="sim-diff-row__data-label">data (base64)</span>
                <code className="sim-diff-row__data-value">
                  {diff.dataAfter.length > 80
                    ? diff.dataAfter.slice(0, 80) + "…"
                    : diff.dataAfter}
                </code>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── PRIORITY FEE RECOMMENDER ─────────────────────────────────────────────────

function PriorityFeePanel({
  fees,
  recommendedCu,
}: {
  fees: PriorityFeeTier[]
  recommendedCu: number
}): React.ReactNode {
  const [selected, setSelected] = useState<"slow" | "normal" | "fast" | "custom">("normal")
  const [customFee, setCustomFee] = useState("")

  const TIER_LABELS: Record<string, string> = {
    slow: "Slow",
    normal: "Normal",
    fast: "Fast",
  }

  const TIER_DESCRIPTIONS: Record<string, string> = {
    slow: "25th percentile · may wait several blocks",
    normal: "75th percentile · lands within 1–2 blocks",
    fast: "90th percentile + 10% · high chance of next block",
  }

  const selectedFee = fees.find((f) => f.label === selected)
  const effectiveFee =
    selected === "custom"
      ? parseInt(customFee.trim() || "0", 10)
      : selectedFee?.microLamportsPerCu ?? 0

  const totalFeeMicroLamports = effectiveFee * recommendedCu
  const totalFeeSol = (totalFeeMicroLamports / 1e15).toFixed(9)

  return (
    <div className="sim-section">
      <div className="sim-section-title">Priority Fee</div>
      <p className="sim-fee-hint">
        Based on <code>getRecentPrioritizationFees</code> for recent transactions.
        Add a priority fee to increase the chance your transaction lands quickly.
      </p>
      <div className="sim-fee-tiers">
        {fees.map((tier) => (
          <button
            key={tier.label}
            className={`sim-fee-tier ${selected === tier.label ? "sim-fee-tier--selected" : ""}`}
            onClick={() => setSelected(tier.label)}
            type="button"
          >
            <span className="sim-fee-tier__label">{TIER_LABELS[tier.label] ?? tier.label}</span>
            <span className="sim-fee-tier__value">
              {tier.microLamportsPerCu.toLocaleString()} μL/CU
            </span>
            <span className="sim-fee-tier__fee">{tier.estimatedFeeSol}</span>
            <span className="sim-fee-tier__desc">{TIER_DESCRIPTIONS[tier.label] ?? ""}</span>
          </button>
        ))}

        <button
          className={`sim-fee-tier ${selected === "custom" ? "sim-fee-tier--selected" : ""}`}
          onClick={() => setSelected("custom")}
          type="button"
        >
          <span className="sim-fee-tier__label">Custom</span>
          <span className="sim-fee-tier__desc">Set your own rate</span>
        </button>
      </div>

      {selected === "custom" && (
        <div className="sim-fee-custom">
          <input
            className="sim-fee-custom__input"
            type="number"
            placeholder="microLamports per CU"
            value={customFee}
            onChange={(e) => setCustomFee(e.target.value)}
            min="0"
          />
          <span className="sim-fee-custom__unit">μL/CU</span>
        </div>
      )}

      <div className="sim-fee-summary">
        <span className="sim-fee-summary__label">Estimated priority fee</span>
        <span className="sim-fee-summary__value">
          {totalFeeMicroLamports.toLocaleString()} microLamports
        </span>
        <span className="sim-fee-summary__sol">({totalFeeSol} SOL)</span>
        <span className="sim-fee-summary__hint">
          for {recommendedCu.toLocaleString()} CU limit
        </span>
      </div>

      <div className="sim-fee-code-hint">
        <code>
          ComputeBudgetProgram.setComputeUnitPrice({"{"} microLamports: {effectiveFee} {"}"})
        </code>
      </div>
    </div>
  )
}

// ─── ERROR PANEL ─────────────────────────────────────────────────────────────

function ErrorPanel({ message }: { message: string }): React.ReactNode {
  return (
    <div className="sim-error-panel">
      <span className="sim-error-panel__icon">✕</span>
      <div className="sim-error-panel__body">
        <span className="sim-error-panel__title">Simulation error</span>
        <span className="sim-error-panel__msg">{message}</span>
      </div>
    </div>
  )
}

// ─── EMPTY STATE ──────────────────────────────────────────────────────────────

function EmptyState({ hasInstructions }: { hasInstructions: boolean }): React.ReactNode {
  return (
    <div className="sim-empty">
      <svg width="52" height="52" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 2" />
        <path d="M8 12h8M12 9v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <p className="sim-empty__title">No simulation yet</p>
      <p className="sim-empty__hint">
        {hasInstructions
          ? "Click \"Simulate Transaction\" to dry-run against the network without signing."
          : "Add instructions in the Builder tab, then come back to simulate."}
      </p>
    </div>
  )
}

// ─── MAIN PANEL ──────────────────────────────────────────────────────────────

export function SimulationPanel(): React.ReactNode {
  const { instances } = useBuilderStore()
  const { schema } = useAppStore()
  const [status, setStatus] = useState<SimStatus>({ phase: "idle" })
  const [assembled, setAssembled] = useState<AssembledTransaction | null>(null)

  const canSimulate = instances.length > 0 && schema !== null

  const handleSimulate = useCallback(async () => {
    if (schema === null) return

    setStatus({ phase: "assembling" })
    setAssembled(null)

    // ── Step 1: assemble ────────────────────────────────────────────────────
    let asm: AssembledTransaction
    try {
      asm = await assembleTransaction(instances, schema, getConnection(), null)
      setAssembled(asm)
    } catch (err) {
      const msg = err instanceof TxAssemblyError
        ? err.message
        : err instanceof Error ? err.message : String(err)
      setStatus({ phase: "error", message: `Assembly failed: ${msg}` })
      return
    }

    setStatus({ phase: "simulating" })

    // ── Step 2: simulate ────────────────────────────────────────────────────
    const writableAddresses = asm.flatAccounts
      .filter((a) => a.isMut)
      .map((a) => a.address)

    const programIds = instances.map(() => schema.address ?? "")

    const result = await simulateAndParse(
      getConnection(),
      asm.transaction,
      writableAddresses,
      programIds
    )

    setStatus({ phase: "done", result })
  }, [instances, schema])

  return (
    <div className="simulation-panel">
      {/* ── Simulate bar (always visible) ── */}
      <SimulateBar
        status={status}
        canSimulate={canSimulate}
        onSimulate={() => void handleSimulate()}
      />

      {/* ── Assembly error ── */}
      {status.phase === "error" && (
        <div className="sim-content">
          <ErrorPanel message={status.message} />
        </div>
      )}

      {/* ── Results ── */}
      {status.phase === "done" && (
        <div className="sim-content">
          {/* Top-level status */}
          <div className={`sim-result-header ${status.result.success ? "sim-result-header--ok" : "sim-result-header--fail"}`}>
            <span className="sim-result-header__icon">
              {status.result.success ? "✓" : "✕"}
            </span>
            <div className="sim-result-header__body">
              <span className="sim-result-header__title">
                {status.result.success ? "Transaction simulated successfully" : "Transaction failed"}
              </span>
              {status.result.programError !== null && (
                <code className="sim-result-header__error">{status.result.programError}</code>
              )}
              {status.result.rpcError !== null && (
                <code className="sim-result-header__error">RPC: {status.result.rpcError}</code>
              )}
            </div>
          </div>

          <ComputeUnitsPanel result={status.result} />
          <InstructionBreakdown result={status.result} />
          {status.result.logs.length > 0 && <LogViewer logs={status.result.logs} />}
          <AccountDiffsPanel result={status.result} />
          {status.result.priorityFees !== null && status.result.computeRecommendation !== null && (
            <PriorityFeePanel
              fees={status.result.priorityFees}
              recommendedCu={status.result.computeRecommendation.recommended}
            />
          )}
        </div>
      )}

      {/* ── Idle ── */}
      {(status.phase === "idle" || status.phase === "assembling" || status.phase === "simulating") && (
        <div className="sim-content">
          <EmptyState hasInstructions={instances.length > 0} />
        </div>
      )}
    </div>
  )
}

// ─── SPINNER ─────────────────────────────────────────────────────────────────

function SimSpinner(): React.ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="spinner" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="10" />
    </svg>
  )
}