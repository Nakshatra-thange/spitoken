/**
 * AccountSlotRow.tsx
 *
 * Renders one account slot in the instruction builder form.
 * Shows: name, mut/signer/pda flags, resolution status icon, address or input.
 *
 * Resolution status icons:
 *   ○  idle       — waiting for user input
 *   ⟳  resolving  — async work in progress (spinner)
 *   ✓  resolved   — auto-filled and valid (green)
 *   ⚠  warning    — filled but needs attention (yellow)
 *   ✕  error      — cannot be resolved (red)
 *   ✎  manual     — user-provided address
 */

import React, { useState, useCallback, useRef, useEffect } from "react"
import { type AccountSlotState, type AccountResolutionStatus } from "../../types/builder"
import { type AccountSlot } from "../../types/idl"

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface AccountSlotRowProps {
  slotDef: AccountSlot
  slotState: AccountSlotState
  index: number
  onManualInputChange: (value: string) => void
  onManualInputCommit: (value: string) => void
  disabled?: boolean
}

// ─── RESOLUTION SOURCE LABEL ─────────────────────────────────────────────────

function sourceLabel(source: import("../../types/builder").ResolutionSource): string {
  switch (source) {
    case "constant": return "constant"
    case "wallet":   return "wallet"
    case "pda":      return "derived"
    case "ata":      return "ata"
  }
}

// ─── STATUS ICON ──────────────────────────────────────────────────────────────

function StatusIcon({ resolution }: { resolution: AccountResolutionStatus }): React.ReactNode {
  switch (resolution.kind) {
    case "idle":
      return <span className="slot-status slot-status--idle" title="Awaiting input" aria-label="Idle">○</span>
    case "resolving":
      return (
        <span className="slot-status slot-status--resolving" aria-label="Resolving">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="spinner" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5"
              strokeLinecap="round" strokeDasharray="31.416" strokeDashoffset="10" />
          </svg>
        </span>
      )
    case "resolved":
      return (
        <span className="slot-status slot-status--resolved" title={`Auto-filled (${sourceLabel(resolution.source)})`} aria-label="Resolved">
          ✓
        </span>
      )
    case "warning":
      return (
        <span className="slot-status slot-status--warning" title={resolution.message} aria-label="Warning">
          ⚠
        </span>
      )
    case "error":
      return (
        <span className="slot-status slot-status--error" title={resolution.message} aria-label="Error">
          ✕
        </span>
      )
    case "manual":
      return (
        <span className="slot-status slot-status--manual" title="Manually entered" aria-label="Manual">
          ✎
        </span>
      )
  }
}

// ─── ADDRESS DISPLAY ──────────────────────────────────────────────────────────

function AddressDisplay({ address, source }: { address: string; source?: string }): React.ReactNode {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback((): void => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }, [address])

  return (
    <div className="slot-address">
      <code className="slot-address__value" title={address}>
        {address.slice(0, 4)}…{address.slice(-4)}
        <span className="slot-address__full">{address}</span>
      </code>
      {source !== undefined && (
        <span className="slot-source-badge">{source}</span>
      )}
      <button
        className="slot-copy-btn"
        onClick={handleCopy}
        type="button"
        aria-label="Copy address"
        title="Copy full address"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </div>
  )
}

// ─── MANUAL INPUT ─────────────────────────────────────────────────────────────

function ManualInput({
  value,
  onChange,
  onCommit,
  disabled,
  hasError,
}: {
  value: string
  onChange: (v: string) => void
  onCommit: (v: string) => void
  disabled?: boolean
  hasError: boolean
}): React.ReactNode {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleChange = useCallback((raw: string): void => {
    onChange(raw)
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => onCommit(raw), 600)
  }, [onChange, onCommit])

  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    }
  }, [])

  return (
    <input
      className={`slot-manual-input ${hasError ? "slot-manual-input--error" : ""}`}
      type="text"
      placeholder="Enter address (base58)…"
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={() => onCommit(value)}
      disabled={disabled}
      spellCheck={false}
      aria-invalid={hasError}
    />
  )
}

// ─── FLAG BADGES ──────────────────────────────────────────────────────────────

function FlagBadges({ isMut, isSigner, isPda, isOptional }: {
  isMut: boolean
  isSigner: boolean
  isPda: boolean
  isOptional: boolean
}): React.ReactNode {
  return (
    <div className="slot-flags">
      {isMut     && <span className="slot-flag slot-flag--mut">mut</span>}
      {isSigner  && <span className="slot-flag slot-flag--signer">signer</span>}
      {isPda     && <span className="slot-flag slot-flag--pda">pda</span>}
      {isOptional && <span className="slot-flag slot-flag--optional">optional</span>}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function AccountSlotRow({
  slotDef,
  slotState,
  index,
  onManualInputChange,
  onManualInputCommit,
  disabled = false,
}: AccountSlotRowProps): React.ReactNode {
  const { resolution, manualInput } = slotState

  // Determine whether to show auto-filled address or manual input
  const isAutoFilled =
    resolution.kind === "resolved" ||
    resolution.kind === "warning"

  const hasError = resolution.kind === "error"

  // Resolved address for display
  const resolvedAddress =
    resolution.kind === "resolved" || resolution.kind === "warning"
      ? resolution.address
      : resolution.kind === "manual"
        ? resolution.address
        : null

  const autoSource =
    resolution.kind === "resolved" || resolution.kind === "warning"
      ? sourceLabel(resolution.source)
      : undefined

  return (
    <div className={`slot-row ${hasError ? "slot-row--error" : ""} ${isAutoFilled ? "slot-row--filled" : ""}`}>
      {/* Index */}
      <span className="slot-index">{index + 1}</span>

      {/* Status icon */}
      <StatusIcon resolution={resolution} />

      {/* Name + flags */}
      <div className="slot-identity">
        <span className="slot-name">{slotDef.name}</span>
        <FlagBadges
          isMut={slotDef.isMut}
          isSigner={slotDef.isSigner}
          isPda={slotDef.pda !== null}
          isOptional={slotDef.isOptional}
        />
      </div>

      {/* Address: auto-filled display OR manual input */}
      <div className="slot-address-area">
        {resolvedAddress !== null && isAutoFilled ? (
          <>
            <AddressDisplay address={resolvedAddress} source={autoSource} />
            <button
              className="slot-override-btn"
              onClick={() => onManualInputChange("")}
              type="button"
              title="Override with manual address"
            >
              override
            </button>
          </>
        ) : resolution.kind === "manual" && resolvedAddress !== null ? (
          <>
            <AddressDisplay address={resolvedAddress} />
            <button
              className="slot-override-btn"
              onClick={() => onManualInputChange("")}
              type="button"
            >
              edit
            </button>
          </>
        ) : (
          <ManualInput
            value={manualInput}
            onChange={onManualInputChange}
            onCommit={onManualInputCommit}
            disabled={disabled}
            hasError={hasError}
          />
        )}
      </div>

      {/* Error message */}
      {hasError && (
        <span className="slot-error-msg" role="alert">
          {resolution.message}
        </span>
      )}
      {resolution.kind === "warning" && (
        <span className="slot-warning-msg" role="status">
          {resolution.message}
        </span>
      )}
    </div>
  )
}