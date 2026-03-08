import { useAppStore } from "../../store/appStore"
import { type InstructionDefinition, type FieldType } from "../../types/idl"

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function fieldTypeLabel(type: FieldType): string {
  switch (type.kind) {
    case "primitive":
      return type.type
    case "vec":
      return `Vec<${fieldTypeLabel(type.item)}>`
    case "option":
      return `Option<${fieldTypeLabel(type.item)}>`
    case "coption":
      return `COption<${fieldTypeLabel(type.item)}>`
    case "array":
      return `[${fieldTypeLabel(type.item)}; ${type.len}]`
    case "defined":
      return type.name
    default: {
      const _exhaustive: never = type
      return String(_exhaustive)
    }
  }
}

// ─── INSTRUCTION CARD ─────────────────────────────────────────────────────────

interface InstructionCardProps {
  instruction: InstructionDefinition
  index: number
  isSelected: boolean
  onClick: () => void
}

function InstructionCard({
  instruction,
  index,
  isSelected,
  onClick,
}: InstructionCardProps){
  const mutCount = instruction.accounts.filter((a) => a.isMut).length
  const signerCount = instruction.accounts.filter((a) => a.isSigner).length
  const pdaCount = instruction.accounts.filter((a) => a.pda !== null).length

  return (
    <button
      className={`ix-card ${isSelected ? "ix-card--selected" : ""}`}
      onClick={onClick}
      aria-selected={isSelected}
      aria-label={`Instruction: ${instruction.name}`}
    >
      {/* Header row */}
      <div className="ix-card__header">
        <span className="ix-card__index">#{String(index + 1).padStart(2, "0")}</span>
        <span className="ix-card__name">{instruction.name}</span>
        {instruction.returns !== null && (
          <span className="ix-card__returns" title="Returns a value">
            → {fieldTypeLabel(instruction.returns)}
          </span>
        )}
      </div>

      {/* Docs */}
      {instruction.docs.length > 0 && (
        <p className="ix-card__docs">{instruction.docs[0]}</p>
      )}

      {/* Stat pills */}
      <div className="ix-card__stats">
        <StatPill
          count={instruction.accounts.length}
          label="accounts"
          variant="neutral"
        />
        <StatPill
          count={instruction.args.length}
          label="args"
          variant="neutral"
        />
        {mutCount > 0 && (
          <StatPill count={mutCount} label="mut" variant="warning" />
        )}
        {signerCount > 0 && (
          <StatPill count={signerCount} label="signer" variant="info" />
        )}
        {pdaCount > 0 && (
          <StatPill count={pdaCount} label="pda" variant="accent" />
        )}
      </div>
    </button>
  )
}

function StatPill({
  count,
  label,
  variant,
}: {
  count: number
  label: string
  variant: "neutral" | "warning" | "info" | "accent"
}){
  return (
    <span className={`stat-pill stat-pill--${variant}`}>
      {count} {label}
    </span>
  )
}

// ─── SELECTED INSTRUCTION DETAIL ──────────────────────────────────────────────

interface InstructionDetailProps {
  instruction: InstructionDefinition
}

function InstructionDetail({ instruction }: InstructionDetailProps) {
  return (
    <div className="ix-detail">
      <div className="ix-detail__header">
        <h2 className="ix-detail__name">{instruction.name}</h2>
        {instruction.docs.length > 0 && (
          <p className="ix-detail__docs">{instruction.docs.join(" ")}</p>
        )}
      </div>

      {/* Accounts table */}
      <section className="ix-detail__section">
        <h3 className="ix-detail__section-title">
          Accounts
          <span className="ix-detail__count">{instruction.accounts.length}</span>
        </h3>

        {instruction.accounts.length === 0 ? (
          <p className="ix-detail__empty">No accounts required</p>
        ) : (
          <div className="account-table">
            <div className="account-table__header">
              <span>#</span>
              <span>Name</span>
              <span>Flags</span>
              <span>PDA</span>
              <span>Docs</span>
            </div>
            {instruction.accounts.map((acc, i) => (
              <div key={acc.name} className="account-table__row">
                <span className="account-table__index">{i + 1}</span>
                <span className="account-table__name">{acc.name}</span>
                <span className="account-table__flags">
                  {acc.isMut && <FlagBadge label="mut" color="warning" />}
                  {acc.isSigner && <FlagBadge label="signer" color="info" />}
                  {acc.isOptional && <FlagBadge label="optional" color="neutral" />}
                </span>
                <span className="account-table__pda">
                  {acc.pda !== null ? (
                    <PdaBadge seedCount={acc.pda.seeds.length} />
                  ) : (
                    <span className="account-table__no-pda">—</span>
                  )}
                </span>
                <span className="account-table__docs">
                  {acc.docs.length > 0 ? acc.docs[0] : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Arguments table */}
      <section className="ix-detail__section">
        <h3 className="ix-detail__section-title">
          Arguments
          <span className="ix-detail__count">{instruction.args.length}</span>
        </h3>

        {instruction.args.length === 0 ? (
          <p className="ix-detail__empty">No arguments</p>
        ) : (
          <div className="arg-table">
            <div className="arg-table__header">
              <span>#</span>
              <span>Name</span>
              <span>Type</span>
            </div>
            {instruction.args.map((arg, i) => (
              <div key={arg.name} className="arg-table__row">
                <span className="arg-table__index">{i + 1}</span>
                <span className="arg-table__name">{arg.name}</span>
                <span className="arg-table__type">
                  <TypeBadge type={arg.type} />
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Return type */}
      {instruction.returns !== null && (
        <section className="ix-detail__section">
          <h3 className="ix-detail__section-title">Returns</h3>
          <TypeBadge type={instruction.returns} />
        </section>
      )}
    </div>
  )
}

function FlagBadge({
  label,
  color,
}: {
  label: string
  color: "warning" | "info" | "neutral"
}) {
  return <span className={`flag-badge flag-badge--${color}`}>{label}</span>
}

function PdaBadge({ seedCount }: { seedCount: number }) {
  return (
    <span className="pda-badge" title={`PDA with ${seedCount} seed${seedCount !== 1 ? "s" : ""}`}>
      PDA · {seedCount} {seedCount === 1 ? "seed" : "seeds"}
    </span>
  )
}

function TypeBadge({ type }: { type: FieldType }){
  return <code className="type-badge">{fieldTypeLabel(type)}</code>
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export function InstructionList(){
  const { schema, selectedInstructionIndex, setSelectedInstructionIndex } = useAppStore()

  if (schema === null) return <></>

  const selectedIx =
    selectedInstructionIndex !== null
      ? schema.instructions[selectedInstructionIndex]
      : null

  return (
    <div className="instruction-list">
      {/* Left column: scrollable list */}
      <div className="instruction-list__sidebar">
        <div className="instruction-list__sidebar-header">
          <div className="program-badge">
            <span className="program-badge__name">{schema.name}</span>
            <span className="program-badge__version">v{schema.version}</span>
          </div>
          {schema.address !== null && (
            <span className="program-badge__address" title={schema.address}>
              {schema.address.slice(0, 4)}…{schema.address.slice(-4)}
            </span>
          )}
          <div className="program-badge__meta">
            <span>{schema.instructions.length} instructions</span>
            <span>{schema.typeRegistry.size} types</span>
            <span>{schema.errorRegistry.size} errors</span>
          </div>
        </div>

        <div className="instruction-list__list" role="listbox" aria-label="Instructions">
          {schema.instructions.map((ix, i) => (
            <InstructionCard
              key={ix.name}
              instruction={ix}
              index={i}
              isSelected={selectedInstructionIndex === i}
              onClick={() =>
                setSelectedInstructionIndex(selectedInstructionIndex === i ? null : i)
              }
            />
          ))}
        </div>
      </div>

      {/* Right column: detail panel */}
      <div className="instruction-list__detail">
        {selectedIx !== undefined && selectedIx !== null ? (
          <InstructionDetail instruction={selectedIx} />
        ) : (
          <div className="instruction-list__empty-detail">
            <SelectIcon />
            <p>Select an instruction to inspect its accounts and arguments</p>
          </div>
        )}
      </div>
    </div>
  )
}

function SelectIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M9 12h6M9 16h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}