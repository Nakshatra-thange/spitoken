/**
 * SimulationPanel.tsx  (Day 3 Evening — full rewrite)
 *
 * New sections vs Day 3 Morning:
 *  - Pre-simulation account snapshot fetch (parallel with assembly)
 *  - Rich account diffs:
 *    · "Created" / "Closed" badges
 *    · Lamport delta with SOL formatting
 *    · Field-by-field diff when IDL account type is known
 *    · Green/red/yellow highlights for added/removed/modified fields
 *  - Error translation panel (replaces raw programError string)
 *
 * Retained from morning: CU panel, per-instruction breakdown, log viewer,
 * priority fee panel.
 */
import { type ProgramSchema } from "../../types/idl"
import React, { useState, useCallback, useMemo } from "react"
import { useBuilderStore } from "../../store/builderStore"
import { useAppStore } from "../../store/appStore"
import { getConnection } from "../../lib/connection"
import { assembleTransaction, TxAssemblyError, type AssembledTransaction } from "../../lib/txAssembler"
import { simulateAndParse, type SimulationResult, type CpiFrame, type PriorityFeeTier, type AccountDiff } from "../../lib/simulator"
import { fetchAccountSnapshots, type SnapshotMap } from "../../lib/accountSnapshot"
import { translateError, type TranslatedError } from "../../lib/errorTranslator"
import { decodeAccountData, formatDecodedValue, type DecodedField } from "../../lib/borshDecoder"


// ─── HELPERS ─────────────────────────────────────────────────────────────────

const LAMPORTS_PER_SOL = 1_000_000_000

function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, "")
}

function formatLamportDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "-"
  const abs = Math.abs(delta)
  const sol = (abs / LAMPORTS_PER_SOL).toFixed(9).replace(/\.?0+$/, "")
  return `${sign}${sol} SOL (${sign}${abs.toLocaleString()} lamports)`
}

// ─── STATUS ───────────────────────────────────────────────────────────────────

type SimStatus =
  | { phase: "idle" }
  | { phase: "snapshotting"; count: number }
  | { phase: "assembling" }
  | { phase: "simulating" }
  | { phase: "done"; result: SimulationResult }
  | { phase: "error"; message: string }

// ─── SIMULATE BAR ─────────────────────────────────────────────────────────────

function SimulateBar({ status, canSimulate, onSimulate }: {
  status: SimStatus
  canSimulate: boolean
  onSimulate: () => void
}): React.ReactNode {
  const isRunning = status.phase === "snapshotting" || status.phase === "assembling" || status.phase === "simulating"

  const phaseLabel =
    status.phase === "snapshotting" ? `Fetching ${(status as { count: number }).count} account${(status as { count: number }).count !== 1 ? "s" : ""}…`
    : status.phase === "assembling" ? "Assembling…"
    : status.phase === "simulating" ? "Simulating…"
    : null

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
            <><SimSpinner />{phaseLabel}</>
          ) : (
            <><span className="sim-run-btn__icon">▶</span>Simulate Transaction</>
          )}
        </button>
        <span className="sim-bar__hint">sigVerify: false · replaceRecentBlockhash: true</span>
      </div>
      {status.phase === "done" && (
        <span className={`sim-bar__badge ${status.result.success ? "sim-bar__badge--ok" : "sim-bar__badge--fail"}`}>
          {status.result.success ? "✓ Success" : "✕ Failed"}
        </span>
      )}
    </div>
  )
}

// ─── ERROR TRANSLATION PANEL ──────────────────────────────────────────────────

function ErrorTranslationPanel({ error }: { error: TranslatedError }): React.ReactNode {
  const [showRaw, setShowRaw] = useState(false)

  const sourceLabel: Record<TranslatedError["source"], string> = {
    idl:     "IDL Program Error",
    anchor:  "Anchor Framework Error",
    solana:  "Solana Runtime Error",
    unknown: "Unknown Error",
  }

  const sourceBadgeClass: Record<TranslatedError["source"], string> = {
    idl:     "error-source--idl",
    anchor:  "error-source--anchor",
    solana:  "error-source--solana",
    unknown: "error-source--unknown",
  }

  return (
    <div className="sim-section">
      <div className="sim-section-title">Error</div>
      <div className="error-card">
        <div className="error-card__header">
          <span className={`error-source-badge ${sourceBadgeClass[error.source]}`}>
            {sourceLabel[error.source]}
          </span>
          <code className="error-code">{error.code}</code>
          {error.instructionIndex !== null && (
            <span className="error-ix-badge">ix {error.instructionIndex + 1}</span>
          )}
        </div>

        <p className="error-message">{error.message}</p>

        {error.logContext !== null && (
          <div className="error-log-context">
            <span className="error-log-context__label">Last log line before failure</span>
            <code className="error-log-context__value">{error.logContext}</code>
          </div>
        )}

        {error.programId !== null && (
          <div className="error-program">
            <span className="error-program__label">Failing program</span>
            <code className="error-program__id">{error.programId}</code>
          </div>
        )}

        <button
          className="error-raw-toggle"
          onClick={() => setShowRaw((v) => !v)}
          type="button"
        >
          {showRaw ? "Hide" : "Show"} raw error
        </button>

        {showRaw && (
          <pre className="error-raw">{error.rawError}</pre>
        )}
      </div>
    </div>
  )
}

// ─── FIELD DIFF ───────────────────────────────────────────────────────────────

type FieldDiffKind = "unchanged" | "changed" | "added" | "removed"

interface FieldDiffEntry {
  name: string
  kind: FieldDiffKind
  beforeStr: string | null
  afterStr: string | null
  depth: number
}

function flattenFields(fields: DecodedField[], depth = 0): { name: string; valueStr: string; depth: number }[] {
  const out: { name: string; valueStr: string; depth: number }[] = []
  for (const field of fields) {
    const v = field.value
    const valueStr = formatDecodedValue(v)
    out.push({ name: field.name, valueStr, depth })

    // Recurse into structs
    if (v.kind === "struct") {
      for (const child of flattenFields(v.fields, depth + 1)) {
        out.push({ ...child, name: `${field.name}.${child.name}` })
      }
    }
  }
  return out
}

function buildFieldDiff(
  beforeFields: DecodedField[] | null,
  afterFields: DecodedField[] | null
): FieldDiffEntry[] {
  const beforeMap = new Map<string, string>()
  const afterMap = new Map<string, string>()

  if (beforeFields !== null) {
    for (const { name, valueStr } of flattenFields(beforeFields)) {
      beforeMap.set(name, valueStr)
    }
  }
  if (afterFields !== null) {
    for (const { name, valueStr } of flattenFields(afterFields)) {
      afterMap.set(name, valueStr)
    }
  }

  const allNames = new Set([...beforeMap.keys(), ...afterMap.keys()])
  const entries: FieldDiffEntry[] = []

  for (const name of allNames) {
    const before = beforeMap.get(name) ?? null
    const after = afterMap.get(name) ?? null
    const depth = name.split(".").length - 1

    let kind: FieldDiffKind
    if (before === null) kind = "added"
    else if (after === null) kind = "removed"
    else if (before !== after) kind = "changed"
    else kind = "unchanged"

    entries.push({ name, kind, beforeStr: before, afterStr: after, depth })
  }

  return entries
}

function FieldDiffTable({ entries }: { entries: FieldDiffEntry[] }): React.ReactNode {
  const [showUnchanged, setShowUnchanged] = useState(false)

  const changedCount = entries.filter((e) => e.kind !== "unchanged").length
  const visible = showUnchanged ? entries : entries.filter((e) => e.kind !== "unchanged")

  if (entries.length === 0) return null

  return (
    <div className="field-diff">
      <div className="field-diff__toolbar">
        <span className="field-diff__summary">
          {changedCount} field{changedCount !== 1 ? "s" : ""} changed
        </span>
        {changedCount < entries.length && (
          <button
            className="field-diff__toggle"
            onClick={() => setShowUnchanged((v) => !v)}
            type="button"
          >
            {showUnchanged ? "Hide" : "Show"} {entries.length - changedCount} unchanged
          </button>
        )}
      </div>

      <div className="field-diff__table">
        {visible.map((entry) => (
          <div
            key={entry.name}
            className={`field-diff-row field-diff-row--${entry.kind}`}
            style={{ paddingLeft: `${12 + entry.depth * 16}px` }}
          >
            <span className="field-diff-row__icon">
              {entry.kind === "added" ? "+" : entry.kind === "removed" ? "−" : entry.kind === "changed" ? "~" : " "}
            </span>
            <span className="field-diff-row__name">{entry.name.split(".").pop()}</span>
            <div className="field-diff-row__values">
              {entry.kind === "changed" ? (
                <>
                  <span className="field-diff-row__before">{entry.beforeStr}</span>
                  <span className="field-diff-row__arrow">→</span>
                  <span className="field-diff-row__after">{entry.afterStr}</span>
                </>
              ) : entry.kind === "added" ? (
                <span className="field-diff-row__after">{entry.afterStr}</span>
              ) : entry.kind === "removed" ? (
                <span className="field-diff-row__before">{entry.beforeStr}</span>
              ) : (
                <span className="field-diff-row__unchanged">{entry.afterStr ?? entry.beforeStr}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── ACCOUNT DIFF CARD ────────────────────────────────────────────────────────

function AccountDiffCard({ diff, schema }: { diff: AccountDiff; schema: ProgramSchema | null }): React.ReactNode {
  const [expanded, setExpanded] = useState(diff.wasCreated || diff.wasClosed || diff.dataChanged)

  // Try to decode before and after data using the IDL
  const beforeFields = useMemo((): DecodedField[] | null => {
    if (diff.rawDataBefore === null || diff.rawDataBefore.length < 8 || schema === null) return null
    for (const [, acctDef] of schema.accountRegistry) {
      // Check discriminator match
      const disc = acctDef.discriminator
      let match = true
      for (let i = 0; i < 8; i++) {
        if ((diff.rawDataBefore[i] ?? 0) !== (disc[i] ?? 0)) { match = false; break }
      }
      if (!match) continue
      try {
        const result = decodeAccountData(diff.rawDataBefore, acctDef.fields, schema.typeRegistry)
        return result.fields
      } catch { return null }
    }
    return null
  }, [diff.rawDataBefore, schema])

  const afterFields = useMemo((): DecodedField[] | null => {
    if (diff.rawDataAfter === null || diff.rawDataAfter.length < 8 || schema === null) return null
    for (const [, acctDef] of schema.accountRegistry) {
      const disc = acctDef.discriminator
      let match = true
      for (let i = 0; i < 8; i++) {
        if ((diff.rawDataAfter[i] ?? 0) !== (disc[i] ?? 0)) { match = false; break }
      }
      if (!match) continue
      try {
        const result = decodeAccountData(diff.rawDataAfter, acctDef.fields, schema.typeRegistry)
        return result.fields
      } catch { return null }
    }
    return null
  }, [diff.rawDataAfter, schema])

  const fieldDiff = useMemo(
    () => (beforeFields !== null || afterFields !== null)
      ? buildFieldDiff(beforeFields, afterFields)
      : null,
    [beforeFields, afterFields]
  )

  const hasChanges = diff.wasCreated || diff.wasClosed || diff.dataChanged || diff.lamportDelta !== null
  if (!hasChanges) return null

  return (
    <div className={`acct-diff-card ${diff.wasCreated ? "acct-diff-card--created" : ""} ${diff.wasClosed ? "acct-diff-card--closed" : ""}`}>
      <div
        className="acct-diff-card__header"
        onClick={() => setExpanded((v) => !v)}
        role="button"
        aria-expanded={expanded}
      >
        <span className="acct-diff-card__chevron">{expanded ? "▾" : "▸"}</span>

        <code className="acct-diff-card__addr" title={diff.address}>
          {diff.address.slice(0, 6)}…{diff.address.slice(-4)}
        </code>

        <div className="acct-diff-card__badges">
          {diff.wasCreated && <span className="acct-diff-badge acct-diff-badge--created">Created</span>}
          {diff.wasClosed  && <span className="acct-diff-badge acct-diff-badge--closed">Closed</span>}
          {diff.dataChanged && !diff.wasCreated && !diff.wasClosed && (
            <span className="acct-diff-badge acct-diff-badge--modified">Modified</span>
          )}
          {diff.lamportDelta !== null && diff.lamportDelta !== 0 && (
            <span className={`acct-diff-badge ${diff.lamportDelta > 0 ? "acct-diff-badge--gained" : "acct-diff-badge--spent"}`}>
              {formatLamportDelta(diff.lamportDelta)}
            </span>
          )}
        </div>

        <button
          className="acct-diff-copy"
          onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(diff.address) }}
          type="button"
          title="Copy address"
        >
          ⧉
        </button>
      </div>

      {expanded && (
        <div className="acct-diff-card__body">
          {/* Lamport row */}
          {diff.lamportsBefore !== null && diff.lamportsAfter !== null && (
            <div className="acct-diff-lamports">
              <span className="acct-diff-lamports__label">SOL balance</span>
              <span className="acct-diff-lamports__before">{lamportsToSol(diff.lamportsBefore)}</span>
              <span className="acct-diff-lamports__arrow">→</span>
              <span className={`acct-diff-lamports__after ${diff.lamportDelta! > 0 ? "acct-diff-lamports__after--gained" : "acct-diff-lamports__after--spent"}`}>
                {lamportsToSol(diff.lamportsAfter)}
              </span>
            </div>
          )}

          {/* Owner */}
          {diff.ownerAfter !== null && diff.ownerBefore !== diff.ownerAfter && (
            <div className="acct-diff-owner">
              <span className="acct-diff-owner__label">Owner</span>
              {diff.ownerBefore !== null && (
                <><code className="acct-diff-owner__before">{diff.ownerBefore.slice(0, 8)}…</code>
                <span>→</span></>
              )}
              <code className="acct-diff-owner__after">{diff.ownerAfter.slice(0, 8)}…</code>
            </div>
          )}

          {/* Field-level diff if IDL matched */}
          {fieldDiff !== null && fieldDiff.length > 0 && (
            <FieldDiffTable entries={fieldDiff} />
          )}

          {/* Raw data sizes when no IDL match */}
          {fieldDiff === null && diff.dataChanged && (
            <div className="acct-diff-raw">
              <div className="acct-diff-raw__row">
                <span className="acct-diff-raw__label">Data size before</span>
                <code className="acct-diff-raw__value">
                  {diff.rawDataBefore !== null ? `${diff.rawDataBefore.length} bytes` : "—"}
                </code>
              </div>
              <div className="acct-diff-raw__row">
                <span className="acct-diff-raw__label">Data size after</span>
                <code className="acct-diff-raw__value">
                  {diff.rawDataAfter !== null ? `${diff.rawDataAfter.length} bytes` : "—"}
                </code>
              </div>
              <p className="acct-diff-raw__hint">No matching IDL account type found — showing sizes only</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── ACCOUNT DIFFS SECTION ────────────────────────────────────────────────────

function AccountDiffsSection({ result }: { result: SimulationResult }): React.ReactNode {
  const { schema } = useAppStore()
  const relevant = result.accountDiffs.filter(
    (d) => d.wasCreated || d.wasClosed || d.dataChanged || (d.lamportDelta !== null && d.lamportDelta !== 0)
  )

  if (relevant.length === 0) return null

  return (
    <div className="sim-section">
      <div className="sim-section-title">
        Account Diffs
        <span className="sim-section-count">{relevant.length}</span>
      </div>
      <div className="acct-diff-list">
        {relevant.map((diff) => (
          <AccountDiffCard key={diff.address} diff={diff} schema={schema} />
        ))}
      </div>
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
          <span className={`sim-cu-card__value sim-cu-card__value--${color}`}>{cu.toLocaleString()}</span>
          <span className="sim-cu-card__label">consumed</span>
        </div>
        {rec !== null && (
          <div className="sim-cu-card">
            <span className="sim-cu-card__value sim-cu-card__value--accent">{rec.recommended.toLocaleString()}</span>
            <span className="sim-cu-card__label">recommended limit</span>
            <span className="sim-cu-card__sub">consumed × 1.15, rounded to 1k</span>
          </div>
        )}
        <div className="sim-cu-card">
          <span className="sim-cu-card__value">{(1_400_000 - cu).toLocaleString()}</span>
          <span className="sim-cu-card__label">remaining budget</span>
        </div>
      </div>
      <div className="sim-cu-bar">
        <div className="sim-cu-bar__track">
          <div className={`sim-cu-bar__fill sim-cu-bar__fill--${color}`} style={{ width: `${pct}%` }} />
          {rec !== null && (
            <div className="sim-cu-bar__rec-marker"
              style={{ left: `${Math.min(100, (rec.recommended / 1_400_000) * 100)}%` }}
              title={`Recommended: ${rec.recommended.toLocaleString()} CU`}
            />
          )}
        </div>
        <span className="sim-cu-bar__label">{pct.toFixed(1)}% of 1.4M CU budget</span>
      </div>
      {rec !== null && (
        <div className="sim-cu-setlimit-hint">
          <span className="sim-cu-setlimit-hint__icon">ℹ</span>
          Set limit to <code>{rec.recommended.toLocaleString()}</code> via{" "}
          <code>ComputeBudgetProgram.setComputeUnitLimit</code>
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
          {frame.logs.filter((l) => l.startsWith("Program log:")).map((l, i) => (
            <div key={i} className="cpi-log-line">{l.replace("Program log: ", "")}</div>
          ))}
          {frame.children.map((child, i) => <CpiNode key={i} frame={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  )
}

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
          <div key={i} className={`sim-ix-card ${ix.success ? "sim-ix-card--ok" : "sim-ix-card--fail"}`}>
            <div className="sim-ix-card__header">
              <span className="sim-ix-card__num">#{i + 1}</span>
              <code className="sim-ix-card__program">{ix.programId.slice(0, 4)}…{ix.programId.slice(-4)}</code>
              <span className={`sim-ix-card__badge ${ix.success ? "sim-ix-card__badge--ok" : "sim-ix-card__badge--fail"}`}>
                {ix.success ? "success" : "failed"}
              </span>
              {ix.unitsConsumed !== null && (
                <span className="sim-ix-card__cu">{ix.unitsConsumed.toLocaleString()} CU</span>
              )}
            </div>
            {ix.failReason !== null && <div className="sim-ix-card__error">{ix.failReason}</div>}
            {ix.cpiTree.length > 0 && (
              <div className="sim-ix-card__cpi">
                {ix.cpiTree.map((frame, j) => <CpiNode key={j} frame={frame} depth={0} />)}
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
    () => filter.trim() === "" ? logs : logs.filter((l) => l.toLowerCase().includes(filter.toLowerCase())),
    [logs, filter]
  )
  const visible = showAll ? filtered : filtered.slice(0, 50)
  const lineClass = (line: string): string => {
    if (line.includes(" failed") || line.includes("Error") || line.includes("error")) return "log-line--error"
    if (line.startsWith("Program log:")) return "log-line--userlog"
    if (line.includes("invoke")) return "log-line--invoke"
    if (line.includes("success")) return "log-line--success"
    if (line.includes("consumption:")) return "log-line--cu"
    return "log-line--default"
  }
  return (
    <div className="sim-section">
      <div className="sim-section-title">Logs <span className="sim-section-count">{logs.length}</span></div>
      <div className="sim-log-toolbar">
        <input className="sim-log-filter" type="text" placeholder="Filter logs…" value={filter}
          onChange={(e) => setFilter(e.target.value)} spellCheck={false} />
        <button className="sim-log-copy" onClick={() => void navigator.clipboard.writeText(logs.join("\n"))} type="button">Copy all</button>
      </div>
      <div className="sim-log-viewer">
        {visible.map((line, i) => <div key={i} className={`log-line ${lineClass(line)}`}>{line}</div>)}
        {filtered.length > 50 && !showAll && (
          <button className="sim-log-more" onClick={() => setShowAll(true)} type="button">
            Show {filtered.length - 50} more lines
          </button>
        )}
        {filtered.length === 0 && <div className="sim-log-empty">No logs match "{filter}"</div>}
      </div>
    </div>
  )
}

// ─── PRIORITY FEE PANEL ───────────────────────────────────────────────────────

function PriorityFeePanel({ fees, recommendedCu }: { fees: PriorityFeeTier[]; recommendedCu: number }): React.ReactNode {
  const [selected, setSelected] = useState<"slow" | "normal" | "fast" | "custom">("normal")
  const [customFee, setCustomFee] = useState("")

  const LABELS: Record<string, string> = { slow: "Slow", normal: "Normal", fast: "Fast" }
  const DESCS: Record<string, string> = {
    slow: "25th percentile · may wait", normal: "75th percentile · 1–2 blocks", fast: "90th +10% · next block"
  }

  const effectiveFee = selected === "custom"
    ? parseInt(customFee.trim() || "0", 10)
    : fees.find((f) => f.label === selected)?.microLamportsPerCu ?? 0

  const totalFeeSol = (effectiveFee * recommendedCu / 1e15).toFixed(9)

  return (
    <div className="sim-section">
      <div className="sim-section-title">Priority Fee</div>
      <div className="sim-fee-tiers">
        {fees.map((tier) => (
          <button key={tier.label} className={`sim-fee-tier ${selected === tier.label ? "sim-fee-tier--selected" : ""}`}
            onClick={() => setSelected(tier.label)} type="button">
            <span className="sim-fee-tier__label">{LABELS[tier.label] ?? tier.label}</span>
            <span className="sim-fee-tier__value">{tier.microLamportsPerCu.toLocaleString()} μL/CU</span>
            <span className="sim-fee-tier__fee">{tier.estimatedFeeSol}</span>
            <span className="sim-fee-tier__desc">{DESCS[tier.label] ?? ""}</span>
          </button>
        ))}
        <button className={`sim-fee-tier ${selected === "custom" ? "sim-fee-tier--selected" : ""}`}
          onClick={() => setSelected("custom")} type="button">
          <span className="sim-fee-tier__label">Custom</span>
          <span className="sim-fee-tier__desc">Set your own rate</span>
        </button>
      </div>
      {selected === "custom" && (
        <div className="sim-fee-custom">
          <input className="sim-fee-custom__input" type="number" placeholder="microLamports per CU"
            value={customFee} onChange={(e) => setCustomFee(e.target.value)} min="0" />
          <span className="sim-fee-custom__unit">μL/CU</span>
        </div>
      )}
      <div className="sim-fee-summary">
        <span className="sim-fee-summary__label">Estimated priority fee</span>
        <span className="sim-fee-summary__value">{(effectiveFee * recommendedCu).toLocaleString()} μL</span>
        <span className="sim-fee-summary__sol">({totalFeeSol} SOL)</span>
        <span className="sim-fee-summary__hint">for {recommendedCu.toLocaleString()} CU</span>
      </div>
      <div className="sim-fee-code-hint">
        <code>ComputeBudgetProgram.setComputeUnitPrice({"{"} microLamports: {effectiveFee} {"}"})</code>
      </div>
    </div>
  )
}

// ─── MAIN PANEL ──────────────────────────────────────────────────────────────

export function SimulationPanel(): React.ReactNode {
  const { instances } = useBuilderStore()
  const { schema } = useAppStore()
  const [status, setStatus] = useState<SimStatus>({ phase: "idle" })

  const canSimulate = instances.length > 0 && schema !== null

  const handleSimulate = useCallback(async () => {
    if (schema === null) return
    const conn = getConnection()

    // ── Step 1: Assemble ──────────────────────────────────────────────────────
    setStatus({ phase: "assembling" })
    let asm: AssembledTransaction
    try {
      asm = await assembleTransaction(instances, schema, conn, null)
    } catch (err) {
      const msg = err instanceof TxAssemblyError ? err.message : err instanceof Error ? err.message : String(err)
      setStatus({ phase: "error", message: `Assembly failed: ${msg}` })
      return
    }

    // ── Step 2: Snapshot writable accounts ───────────────────────────────────
    const writableAddresses = asm.flatAccounts.filter((a) => a.isMut).map((a) => a.address)
    setStatus({ phase: "snapshotting", count: writableAddresses.length })
    let snapshots: SnapshotMap = new Map()
    try {
      snapshots = await fetchAccountSnapshots(conn, writableAddresses)
    } catch { /* non-fatal — proceed with empty snapshots */ }

    // ── Step 3: Simulate ──────────────────────────────────────────────────────
    setStatus({ phase: "simulating" })
    const programIds = instances.map(() => schema.address ?? "")
    const result = await simulateAndParse(conn, asm.transaction, writableAddresses, programIds, snapshots)
    setStatus({ phase: "done", result })
  }, [instances, schema])

  // Build translated error if result failed
  const translatedError = useMemo((): TranslatedError | null => {
    if (status.phase !== "done") return null
    const { result } = status
    if (result.success || result.rawErr === null) return null
    if (schema === null) return null
    return translateError(result.rawErr, result.logs, schema)
  }, [status, schema])

  return (
    <div className="simulation-panel">
      <SimulateBar status={status} canSimulate={canSimulate} onSimulate={() => void handleSimulate()} />

      {status.phase === "error" && (
        <div className="sim-content">
          <div className="sim-error-panel">
            <span className="sim-error-panel__icon">✕</span>
            <div className="sim-error-panel__body">
              <span className="sim-error-panel__title">Simulation error</span>
              <span className="sim-error-panel__msg">{status.message}</span>
            </div>
          </div>
        </div>
      )}

      {status.phase === "done" && (
        <div className="sim-content">
          {/* Result header */}
          <div className={`sim-result-header ${status.result.success ? "sim-result-header--ok" : "sim-result-header--fail"}`}>
            <span className="sim-result-header__icon">{status.result.success ? "✓" : "✕"}</span>
            <div className="sim-result-header__body">
              <span className="sim-result-header__title">
                {status.result.success ? "Transaction simulated successfully" : "Transaction failed"}
              </span>
              {status.result.rpcError !== null && (
                <code className="sim-result-header__error">RPC: {status.result.rpcError}</code>
              )}
            </div>
          </div>

          {/* Translated error (replaces raw programError display) */}
          {translatedError !== null && (
            <ErrorTranslationPanel error={translatedError} />
          )}

          <ComputeUnitsPanel result={status.result} />
          <InstructionBreakdown result={status.result} />
          <AccountDiffsSection result={status.result} />
          {status.result.logs.length > 0 && <LogViewer logs={status.result.logs} />}
          {status.result.priorityFees !== null && status.result.computeRecommendation !== null && (
            <PriorityFeePanel
              fees={status.result.priorityFees}
              recommendedCu={status.result.computeRecommendation.recommended}
            />
          )}
        </div>
      )}

      {(status.phase === "idle" || status.phase === "assembling" || status.phase === "simulating" || status.phase === "snapshotting") && (
        <div className="sim-content">
          <div className="sim-empty">
            <svg width="52" height="52" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 2" />
              <path d="M8 12h8M12 9v6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <p className="sim-empty__title">No simulation yet</p>
            <p className="sim-empty__hint">
              {instances.length > 0
                ? "Click \"Simulate Transaction\" to dry-run against the network."
                : "Add instructions in the Builder tab, then come back to simulate."}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function SimSpinner(): React.ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="spinner" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="10" />
    </svg>
  )
}