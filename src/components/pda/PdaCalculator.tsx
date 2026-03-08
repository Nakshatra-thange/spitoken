/**
 * PdaCalculator.tsx
 *
 * Lets the user build a PDA derivation step by step:
 *   1. Enter a program ID
 *   2. Add seeds (string / hex / pubkey), in order
 *   3. Derive — shows the address and bump
 *
 * Seeds are validated live. Derivation runs on demand (not on every keystroke,
 * because findProgramAddressSync is CPU-bound and we don't want jank).
 */

import { useState, useCallback, useId } from "react"
import {
  derivePda,
  validateSeed,
  emptyStringInput,
  newSeedId,
  PdaDerivationError,
  type SeedInput,
  type SeedKind,
  type SeedValidation,
} from "../../lib/pdaCalculator"
import { useAppStore } from "../../store/appStore"

// ─── SEED KIND LABELS ────────────────────────────────────────────────────────

const SEED_KIND_OPTIONS: { value: SeedKind; label: string; hint: string }[] = [
  { value: "string", label: "String",  hint: "UTF-8 text (≤32 bytes)" },
  { value: "hex",    label: "Hex",     hint: "0xdeadbeef or deadbeef" },
  { value: "pubkey", label: "PubKey",  hint: "base58 public key (32 bytes)" },
]

// ─── SEED ROW ─────────────────────────────────────────────────────────────────

interface SeedRowProps {
  seed: SeedInput
  index: number
  validation: SeedValidation
  onUpdate: (id: string, patch: Partial<Omit<SeedInput, "id">>) => void
  onRemove: (id: string) => void
  onMoveUp: (id: string) => void
  onMoveDown: (id: string) => void
  isFirst: boolean
  isLast: boolean
}

function SeedRow({
  seed,
  index,
  validation,
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
  isFirst,
  isLast,
}: SeedRowProps){
  const inputId = useId()

  return (
    <div className={`seed-row ${!validation.valid && seed.value !== "" ? "seed-row--error" : ""}`}>
      {/* Index badge */}
      <span className="seed-row__index">{index + 1}</span>

      {/* Kind selector */}
      <select
        className="seed-row__kind"
        value={seed.kind}
        onChange={(e) => onUpdate(seed.id, { kind: e.target.value as SeedKind, value: "" })}
        aria-label={`Seed ${index + 1} type`}
      >
        {SEED_KIND_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Value input */}
      <div className="seed-row__input-wrap">
        <input
          id={inputId}
          className="seed-row__input"
          type="text"
          placeholder={SEED_KIND_OPTIONS.find(o => o.value === seed.kind)?.hint ?? ""}
          value={seed.value}
          onChange={(e) => onUpdate(seed.id, { value: e.target.value })}
          spellCheck={false}
          aria-label={`Seed ${index + 1} value`}
          aria-invalid={!validation.valid && seed.value !== ""}
          aria-describedby={validation.errorMessage !== null ? `${inputId}-err` : undefined}
        />
        {validation.errorMessage !== null && seed.value !== "" && (
          <span id={`${inputId}-err`} className="seed-row__error">{validation.errorMessage}</span>
        )}
        {validation.valid && validation.bytes !== null && (
          <span className="seed-row__bytes">
            {validation.bytes.length}B · 0x{Array.from(validation.bytes).slice(0,8).map(b=>b.toString(16).padStart(2,"0")).join("")}{validation.bytes.length > 8 ? "…" : ""}
          </span>
        )}
      </div>

      {/* Order controls */}
      <div className="seed-row__controls">
        <button
          className="seed-ctrl-btn"
          onClick={() => onMoveUp(seed.id)}
          disabled={isFirst}
          title="Move up"
          aria-label="Move seed up"
        >↑</button>
        <button
          className="seed-ctrl-btn"
          onClick={() => onMoveDown(seed.id)}
          disabled={isLast}
          title="Move down"
          aria-label="Move seed down"
        >↓</button>
        <button
          className="seed-ctrl-btn seed-ctrl-btn--remove"
          onClick={() => onRemove(seed.id)}
          title="Remove seed"
          aria-label="Remove seed"
        >×</button>
      </div>
    </div>
  )
}

// ─── RESULT DISPLAY ───────────────────────────────────────────────────────────

interface PdaResultDisplayProps {
  address: string
  bump: number
  seedBytes: string[]
}

function PdaResultDisplay({ address, bump, seedBytes }: PdaResultDisplayProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = (): void => {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="pda-result">
      <div className="pda-result__row">
        <span className="pda-result__label">PDA Address</span>
        <div className="pda-result__address-wrap">
          <code className="pda-result__address">{address}</code>
          <button
            className="copy-btn copy-btn--lg"
            onClick={handleCopy}
            aria-label="Copy PDA address"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>

      <div className="pda-result__row">
        <span className="pda-result__label">Bump</span>
        <code className="pda-result__bump">{bump}</code>
        <span className="pda-result__bump-hint">
          ({255 - bump} iteration{255 - bump !== 1 ? "s" : ""} to find valid point)
        </span>
      </div>

      {seedBytes.length > 0 && (
        <div className="pda-result__seeds">
          <span className="pda-result__label">Resolved seed bytes</span>
          <div className="pda-result__seed-list">
            {seedBytes.map((hex, i) => (
              <div key={i} className="pda-result__seed-hex">
                <span className="pda-result__seed-n">seed {i + 1}</span>
                <code>{hex || "(empty)"}</code>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function PdaCalculator() {
  const { schema } = useAppStore()

  const [programId, setProgramId] = useState(schema?.address ?? "")
  const [seeds, setSeeds] = useState<SeedInput[]>([emptyStringInput()])
  const [derivedResult, setDerivedResult] = useState<
    { address: string; bump: number; seedBytes: string[] } | null
  >(null)
  const [deriveError, setDeriveError] = useState<string | null>(null)

  // Live-validate all seeds
  const validations: SeedValidation[] = seeds.map((s) => validateSeed(s))
  const allSeedsValid = validations.every(
    (v, i) => v.valid || (seeds[i]?.value === "")
  )

  // ── Seed management ────────────────────────────────────────────────────────
  const updateSeed = useCallback(
    (id: string, patch: Partial<Omit<SeedInput, "id">>) => {
      setSeeds((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...patch } : s))
      )
      setDerivedResult(null)
    },
    []
  )

  const addSeed = useCallback(() => {
    setSeeds((prev) => [...prev, emptyStringInput()])
  }, [])

  const removeSeed = useCallback((id: string) => {
    setSeeds((prev) => {
      const next = prev.filter((s) => s.id !== id)
      return next.length === 0 ? [emptyStringInput()] : next
    })
    setDerivedResult(null)
  }, [])

  const moveUp = useCallback((id: string) => {
    setSeeds((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx <= 0) return prev
      const next = [...prev]
      const tmp = next[idx - 1]
      if (tmp === undefined) return prev
      next[idx - 1] = next[idx] as SeedInput
      next[idx] = tmp
      return next
    })
    setDerivedResult(null)
  }, [])

  const moveDown = useCallback((id: string) => {
    setSeeds((prev) => {
      const idx = prev.findIndex((s) => s.id === id)
      if (idx < 0 || idx >= prev.length - 1) return prev
      const next = [...prev]
      const tmp = next[idx + 1]
      if (tmp === undefined) return prev
      next[idx + 1] = next[idx] as SeedInput
      next[idx] = tmp
      return next
    })
    setDerivedResult(null)
  }, [])

  // ── Derivation ─────────────────────────────────────────────────────────────
  const handleDerive = useCallback(() => {
    setDeriveError(null)
    setDerivedResult(null)

    // Filter out empty seeds silently
    const activeSeedInputs = seeds.filter((s) => s.value.trim() !== "")

    try {
      const result = derivePda(programId, activeSeedInputs)
      setDerivedResult(result)
    } catch (err) {
      setDeriveError(
        err instanceof PdaDerivationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Unexpected error during derivation"
      )
    }
  }, [programId, seeds])

  // Sync program ID when schema changes
  const schemaAddress = schema?.address ?? null
  if (schemaAddress !== null && programId === "" ) {
    setProgramId(schemaAddress)
  }

  const canDerive =
    programId.trim().length > 0 &&
    seeds.some((s) => s.value.trim() !== "")

  return (
    <div className="pda-calculator">
      {/* ── Header ── */}
      <div className="insp-header">
        <h2 className="insp-title">PDA Calculator</h2>
        <p className="insp-subtitle">
          Derive a Program Derived Address from a program ID and an ordered list of seeds.
        </p>
      </div>

      {/* ── Program ID ── */}
      <div className="pda-field">
        <label className="pda-field__label">Program ID</label>
        <div className="pda-programid-row">
          <input
            className="pda-programid-input"
            type="text"
            placeholder="Program ID (base58)…"
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value)
              setDerivedResult(null)
            }}
            spellCheck={false}
            aria-label="Program ID"
          />
          {schema?.address !== null && schema?.address !== undefined && (
            <button
              className="pda-use-loaded-btn"
              onClick={() => {
                setProgramId(schema.address ?? "")
                setDerivedResult(null)
              }}
              title="Use loaded program address"
            >
              Use loaded: {schema.name}
            </button>
          )}
        </div>
      </div>

      {/* ── Seeds ── */}
      <div className="pda-field">
        <div className="pda-seeds-header">
          <label className="pda-field__label">Seeds <span className="pda-field__order-note">(order matters)</span></label>
          <button className="pda-add-seed-btn" onClick={addSeed}>
            + Add Seed
          </button>
        </div>

        <div className="pda-seeds-list">
          {seeds.map((seed, i) => {
            const validation = validations[i]
            if (validation === undefined) return null
            return (
              <SeedRow
                key={seed.id}
                seed={seed}
                index={i}
                validation={validation}
                onUpdate={updateSeed}
                onRemove={removeSeed}
                onMoveUp={moveUp}
                onMoveDown={moveDown}
                isFirst={i === 0}
                isLast={i === seeds.length - 1}
              />
            )
          })}
        </div>
      </div>

      {/* ── Derive button ── */}
      <button
        className="pda-derive-btn"
        onClick={handleDerive}
        disabled={!canDerive}
      >
        Derive PDA
      </button>

      {/* ── Error ── */}
      {deriveError !== null && (
        <div className="insp-error" role="alert">
          <ErrorIcon />
          <span>{deriveError}</span>
        </div>
      )}

      {/* ── Result ── */}
      {derivedResult !== null && (
        <PdaResultDisplay
          address={derivedResult.address}
          bump={derivedResult.bump}
          seedBytes={derivedResult.seedBytes}
        />
      )}

      {/* ── How it works explainer ── */}
      <details className="pda-explainer">
        <summary className="pda-explainer__summary">How PDA derivation works</summary>
        <div className="pda-explainer__body">
          <p>
            Seeds are concatenated with the program ID and the magic string{" "}
            <code>"ProgramDerivedAddress"</code>, then hashed with SHA-256.
          </p>
          <p>
            A bump value (starting at 255) is appended. If the resulting hash
            is a valid ed25519 curve point, the bump is decremented and we try
            again. The first hash that falls <em>off</em> the curve is the PDA.
          </p>
          <p>
            This is why PDAs can never have a corresponding private key — they
            are intentionally invalid curve points. Programs can still sign for
            them using <code>invoke_signed</code> with the seeds.
          </p>
        </div>
      </details>
    </div>
  )
}

function ErrorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}