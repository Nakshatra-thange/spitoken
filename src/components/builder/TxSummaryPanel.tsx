/**
 * TxSummaryPanel.tsx
 *
 * The right-side summary panel shown when 2+ instructions are in the builder,
 * OR as a persistent bottom strip that updates live.
 *
 * Shows:
 *  - Instruction execution order (numbered, drag hint)
 *  - Unique account count, writable count, signer count
 *  - CU estimate with disclaimer
 *  - Shared accounts (used across multiple instructions)
 *  - Validation conflicts (errors + warnings)
 *  - PDA chaining suggestions
 */

import React, { useMemo } from "react"
import { useBuilderStore } from "../../store/builderStore"
import { useAppStore } from "../../store/appStore"
import {
  validateTransaction,
  formatCu,
  cuBudgetColor,
  getResolvedAddress,
  type TxSummary,
  type TxConflict,
  type AccountSuggestion,
} from "../../lib/txValidator"

// ─── STAT CARD ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: "green" | "yellow" | "red" | "blue" | "accent"
}): React.ReactNode {
  return (
    <div className="tx-stat-card">
      <span className={`tx-stat-card__value ${accent !== undefined ? `tx-stat-card__value--${accent}` : ""}`}>
        {value}
      </span>
      <span className="tx-stat-card__label">{label}</span>
      {sub !== undefined && <span className="tx-stat-card__sub">{sub}</span>}
    </div>
  )
}

// ─── CONFLICT ROW ─────────────────────────────────────────────────────────────

function ConflictRow({ conflict }: { conflict: TxConflict }): React.ReactNode {
  return (
    <div className={`tx-conflict tx-conflict--${conflict.severity}`}>
      <span className="tx-conflict__icon">
        {conflict.severity === "error" ? "✕" : conflict.severity === "warning" ? "⚠" : "ℹ"}
      </span>
      <div className="tx-conflict__body">
        <span className="tx-conflict__msg">{conflict.message}</span>
        {conflict.involvedIndices.length > 0 && (
          <div className="tx-conflict__pills">
            {conflict.involvedIndices.map((i) => (
              <span key={i} className="tx-conflict__pill">ix {i + 1}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SUGGESTION ROW ───────────────────────────────────────────────────────────

function SuggestionRow({
  suggestion,
  onApply,
}: {
  suggestion: AccountSuggestion
  onApply: (suggestion: AccountSuggestion) => void
}): React.ReactNode {
  return (
    <div className="tx-suggestion">
      <div className="tx-suggestion__body">
        <span className="tx-suggestion__text">
          <strong>ix {suggestion.targetInstanceIndex + 1}</strong> · {suggestion.targetSlotName}
          {" "}←{" "}
          <strong>ix {suggestion.sourceInstanceIndex + 1}</strong> · {suggestion.sourceSlotName}
        </span>
        <code className="tx-suggestion__addr">
          {suggestion.address.slice(0, 4)}…{suggestion.address.slice(-4)}
        </code>
      </div>
      <button
        className="tx-suggestion__apply"
        onClick={() => onApply(suggestion)}
        type="button"
      >
        Apply
      </button>
    </div>
  )
}

// ─── ORDER STRIP ──────────────────────────────────────────────────────────────

function ExecutionOrderStrip(): React.ReactNode {
  const { instances, focusedId, setFocused, moveInstruction } = useBuilderStore()

  if (instances.length === 0) return null

  return (
    <div className="tx-order-strip">
      <span className="tx-order-strip__label">Execution order</span>
      <div className="tx-order-strip__list">
        {instances.map((inst, i) => {
          const isFocused = focusedId === inst.id
          const resolved = inst.accounts.filter(
            (a) => getResolvedAddress(a.resolution) !== null
          ).length
          const total = inst.accounts.length
          const allResolved = resolved === total

          return (
            <div
              key={inst.id}
              className={`tx-order-item ${isFocused ? "tx-order-item--focused" : ""} ${
                allResolved ? "tx-order-item--ready" : ""
              }`}
            >
              {i > 0 && <span className="tx-order-arrow">→</span>}
              <button
                className="tx-order-item__btn"
                onClick={() => setFocused(inst.id)}
                type="button"
                title={`Go to ${inst.definition.name}`}
              >
                <span className="tx-order-item__num">{i + 1}</span>
                <span className="tx-order-item__name">{inst.definition.name}</span>
                <span className={`tx-order-item__dot ${allResolved ? "tx-order-item__dot--green" : "tx-order-item__dot--yellow"}`} />
              </button>
              <div className="tx-order-item__reorder">
                <button
                  onClick={() => moveInstruction(inst.id, "up")}
                  disabled={i === 0}
                  type="button"
                  aria-label="Move earlier"
                  className="tx-reorder-btn"
                >‹</button>
                <button
                  onClick={() => moveInstruction(inst.id, "down")}
                  disabled={i === instances.length - 1}
                  type="button"
                  aria-label="Move later"
                  className="tx-reorder-btn"
                >›</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── SHARED ACCOUNTS TABLE ────────────────────────────────────────────────────

function SharedAccountsTable({
  shared,
}: {
  shared: { address: string; usedBy: number[] }[]
}): React.ReactNode {
  if (shared.length === 0) return null

  return (
    <div className="tx-shared">
      <div className="tx-section-title">
        Shared accounts
        <span className="tx-section-badge">{shared.length}</span>
      </div>
      <div className="tx-shared-list">
        {shared.map(({ address, usedBy }) => (
          <div key={address} className="tx-shared-row">
            <code className="tx-shared-addr">
              {address.slice(0, 6)}…{address.slice(-4)}
            </code>
            <div className="tx-shared-pills">
              {usedBy.map((i) => (
                <span key={i} className="tx-shared-pill">ix {i + 1}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function TxSummaryPanel(): React.ReactNode {
  const { instances, updateAccountResolution } = useBuilderStore()
  const { schema } = useAppStore()

  const summary: TxSummary = useMemo(() => {
    if (schema === null || instances.length === 0) {
      return {
        uniqueAccountCount: 0,
        sharedAccounts: [],
        writableCount: 0,
        signerCount: 0,
        estimatedCu: 0,
        hasEstimate: false,
        conflicts: [],
        suggestions: [],
        isReady: false,
      }
    }
    return validateTransaction(instances, schema)
  }, [instances, schema])

  const handleApplySuggestion = (suggestion: AccountSuggestion): void => {
    updateAccountResolution(
      instances[suggestion.targetInstanceIndex]?.id ?? "",
      suggestion.targetSlotIndex,
      { kind: "resolved", address: suggestion.address, source: "pda" }
    )
  }

  if (instances.length === 0) {
    return (
      <div className="tx-summary tx-summary--empty">
        <p className="tx-summary__empty-text">
          Add instructions to see the transaction summary
        </p>
      </div>
    )
  }

  const errorCount = summary.conflicts.filter((c) => c.severity === "error").length
  const warnCount = summary.conflicts.filter((c) => c.severity === "warning").length
  const cuColor = cuBudgetColor(summary.estimatedCu)

  return (
    <div className="tx-summary">
      {/* ── Execution order strip ── */}
      <ExecutionOrderStrip />

      {/* ── Stats row ── */}
      <div className="tx-stats-row">
        <StatCard
          label="Instructions"
          value={instances.length}
          accent="accent"
        />
        <StatCard
          label="Unique accounts"
          value={summary.uniqueAccountCount}
          sub={`${summary.writableCount} writable`}
        />
        <StatCard
          label="Signers"
          value={summary.signerCount}
        />
        <StatCard
          label="Est. compute"
          value={summary.hasEstimate ? formatCu(summary.estimatedCu) : "—"}
          sub={summary.hasEstimate ? "rough estimate" : "resolve accounts first"}
          accent={summary.hasEstimate ? cuColor : undefined}
        />
        <div className={`tx-readiness ${summary.isReady ? "tx-readiness--ready" : "tx-readiness--notready"}`}>
          <span className="tx-readiness__dot" />
          <span className="tx-readiness__label">
            {summary.isReady ? "Ready to simulate" : `${errorCount} issue${errorCount !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* ── CU budget bar ── */}
      {summary.hasEstimate && (
        <div className="tx-cu-bar">
          <div className="tx-cu-bar__track">
            <div
              className={`tx-cu-bar__fill tx-cu-bar__fill--${cuColor}`}
              style={{
                width: `${Math.min(100, (summary.estimatedCu / 1_400_000) * 100)}%`,
              }}
            />
          </div>
          <span className="tx-cu-bar__label">
            {formatCu(summary.estimatedCu)} / 1.4M CU budget
          </span>
          <span className="tx-cu-bar__disclaimer">estimates — simulation gives exact numbers</span>
        </div>
      )}

      {/* ── Conflicts ── */}
      {summary.conflicts.length > 0 && (
        <div className="tx-conflicts-section">
          <div className="tx-section-title">
            Validation
            {errorCount > 0 && <span className="tx-section-badge tx-section-badge--error">{errorCount} error{errorCount !== 1 ? "s" : ""}</span>}
            {warnCount > 0 && <span className="tx-section-badge tx-section-badge--warn">{warnCount} warning{warnCount !== 1 ? "s" : ""}</span>}
          </div>
          <div className="tx-conflicts-list">
            {summary.conflicts.map((c, i) => (
              <ConflictRow key={i} conflict={c} />
            ))}
          </div>
        </div>
      )}

      {/* ── Shared accounts ── */}
      {summary.sharedAccounts.length > 0 && (
        <SharedAccountsTable shared={summary.sharedAccounts} />
      )}

      {/* ── PDA suggestions ── */}
      {summary.suggestions.length > 0 && (
        <div className="tx-suggestions-section">
          <div className="tx-section-title">
            Account suggestions
            <span className="tx-section-badge tx-section-badge--accent">{summary.suggestions.length}</span>
          </div>
          <p className="tx-suggestions-hint">
            These PDAs from earlier instructions may fill unresolved slots:
          </p>
          <div className="tx-suggestions-list">
            {summary.suggestions.map((s, i) => (
              <SuggestionRow
                key={i}
                suggestion={s}
                onApply={handleApplySuggestion}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── All good ── */}
      {summary.isReady && summary.conflicts.length === 0 && (
        <div className="tx-all-good">
          <span className="tx-all-good__icon">✓</span>
          <span>Transaction looks valid — ready to simulate</span>
        </div>
      )}
    </div>
  )
}