/**
 * TransactionBuilder.tsx
 *
 * The main Day 2 panel.
 * Left sidebar: ordered list of instruction instances (add, reorder, remove).
 * Right panel:  the form for the currently focused instruction instance.
 *
 * "Add Instruction" opens a picker showing all instructions from the loaded IDL.
 */

import React, { useState, useCallback } from "react"
import { useAppStore } from "../../store/appStore"
import { useBuilderStore } from "../../store/builderStore"
import { InstructionInstanceForm } from "./InstructionInstanceForm"
import { type InstructionDefinition } from "../../types/idl"

// ─── INSTRUCTION PICKER ───────────────────────────────────────────────────────

function InstructionPicker({
  definitions,
  onPick,
  onClose,
}: {
  definitions: InstructionDefinition[]
  onPick: (def: InstructionDefinition) => void
  onClose: () => void
}): React.ReactNode {
  const [query, setQuery] = useState("")
  const filtered = definitions.filter((d) =>
    d.name.toLowerCase().includes(query.toLowerCase())
  )

  return (
    <div className="ix-picker-overlay" onClick={onClose}>
      <div className="ix-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add instruction">
        <div className="ix-picker__header">
          <span className="ix-picker__title">Add Instruction</span>
          <button className="ix-picker__close" onClick={onClose} type="button" aria-label="Close">×</button>
        </div>
        <div className="ix-picker__search-wrap">
          <input
            className="ix-picker__search"
            type="text"
            placeholder="Search instructions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </div>
        <div className="ix-picker__list" role="listbox">
          {filtered.length === 0 && (
            <div className="ix-picker__empty">No instructions match "{query}"</div>
          )}
          {filtered.map((def) => (
            <button
              key={def.name}
              className="ix-picker__item"
              onClick={() => onPick(def)}
              role="option"
              type="button"
            >
              <span className="ix-picker__item-name">{def.name}</span>
              <span className="ix-picker__item-meta">
                {def.accounts.length} accounts · {def.args.length} args
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── INSTANCE SIDEBAR ITEM ────────────────────────────────────────────────────

function InstanceSidebarItem({
  label,
  index,
  isFocused,
  isFirst,
  isLast,
  accountCount,
  argCount,
  onClick,
  onRemove,
  onMoveUp,
  onMoveDown,
  onDuplicate,
}: {
  label: string
  index: number
  isFocused: boolean
  isFirst: boolean
  isLast: boolean
  accountCount: number
  argCount: number
  onClick: () => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDuplicate: () => void
}): React.ReactNode {
  return (
    <div className={`builder-sidebar-item ${isFocused ? "builder-sidebar-item--focused" : ""}`}>
      <button className="builder-sidebar-item__main" onClick={onClick} type="button">
        <span className="builder-sidebar-item__index">
          #{String(index + 1).padStart(2, "0")}
        </span>
        <span className="builder-sidebar-item__name">{label}</span>
        <span className="builder-sidebar-item__meta">
          {accountCount}a · {argCount}b
        </span>
      </button>
      <div className="builder-sidebar-item__actions">
        <button
          className="builder-item-action"
          onClick={onMoveUp}
          disabled={isFirst}
          type="button"
          title="Move up"
          aria-label="Move instruction up"
        >↑</button>
        <button
          className="builder-item-action"
          onClick={onMoveDown}
          disabled={isLast}
          type="button"
          title="Move down"
          aria-label="Move instruction down"
        >↓</button>
        <button
          className="builder-item-action"
          onClick={onDuplicate}
          type="button"
          title="Duplicate"
          aria-label="Duplicate instruction"
        >⧉</button>
        <button
          className="builder-item-action builder-item-action--danger"
          onClick={onRemove}
          type="button"
          title="Remove"
          aria-label="Remove instruction"
        >×</button>
      </div>
    </div>
  )
}

// ─── MAIN BUILDER ─────────────────────────────────────────────────────────────

export function TransactionBuilder(): React.ReactNode {
  const { schema } = useAppStore()
  const {
    instances,
    focusedId,
    addInstruction,
    removeInstruction,
    moveInstruction,
    duplicateInstruction,
    setFocused,
    clearAll,
  } = useBuilderStore()

  const [showPicker, setShowPicker] = useState(false)

  // Connected wallet — in a real app this would come from @solana/wallet-adapter
  // For now, use null (wallet connection is a later concern)
  const walletAddress: string | null = null

  const handlePick = useCallback((def: InstructionDefinition): void => {
    addInstruction(def)
    setShowPicker(false)
  }, [addInstruction])

  const focusedInstance = instances.find((i) => i.id === focusedId) ?? null

  if (schema === null) return null

  return (
    <div className="transaction-builder">
      {/* ── Left sidebar ── */}
      <div className="builder-sidebar">
        <div className="builder-sidebar__header">
          <span className="builder-sidebar__title">Transaction</span>
          {instances.length > 0 && (
            <button
              className="builder-clear-btn"
              onClick={clearAll}
              type="button"
              title="Clear all instructions"
            >
              Clear
            </button>
          )}
        </div>

        <div className="builder-sidebar__list">
          {instances.length === 0 && (
            <div className="builder-sidebar__empty">
              <span>No instructions yet</span>
              <span className="builder-sidebar__empty-hint">
                Add instructions to build your transaction
              </span>
            </div>
          )}
          {instances.map((inst, i) => (
            <InstanceSidebarItem
              key={inst.id}
              label={inst.definition.name}
              index={i}
              isFocused={focusedId === inst.id}
              isFirst={i === 0}
              isLast={i === instances.length - 1}
              accountCount={inst.definition.accounts.length}
              argCount={inst.definition.args.length}
              onClick={() => setFocused(inst.id)}
              onRemove={() => removeInstruction(inst.id)}
              onMoveUp={() => moveInstruction(inst.id, "up")}
              onMoveDown={() => moveInstruction(inst.id, "down")}
              onDuplicate={() => duplicateInstruction(inst.id)}
            />
          ))}
        </div>

        <button
          className="builder-add-btn"
          onClick={() => setShowPicker(true)}
          type="button"
        >
          + Add Instruction
        </button>
      </div>

      {/* ── Right form panel ── */}
      <div className="builder-form-panel">
        {focusedInstance !== null ? (
          <>
            <div className="builder-form-panel__header">
              <div className="builder-form-panel__title-row">
                <h2 className="builder-form-panel__name">
                  {focusedInstance.definition.name}
                </h2>
                {focusedInstance.definition.docs.length > 0 && (
                  <p className="builder-form-panel__docs">
                    {focusedInstance.definition.docs[0]}
                  </p>
                )}
              </div>
            </div>
            <InstructionInstanceForm
              instance={focusedInstance}
              schema={schema}
              walletAddress={walletAddress}
            />
          </>
        ) : (
          <div className="builder-empty-state">
            <BuilderEmptyIcon />
            <p className="builder-empty-state__title">No instruction selected</p>
            <p className="builder-empty-state__hint">
              {instances.length === 0
                ? "Add an instruction from the sidebar to start building your transaction."
                : "Select an instruction from the list to edit it."}
            </p>
            {instances.length === 0 && (
              <button
                className="builder-empty-state__cta"
                onClick={() => setShowPicker(true)}
                type="button"
              >
                + Add First Instruction
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Instruction picker modal ── */}
      {showPicker && (
        <InstructionPicker
          definitions={schema.instructions}
          onPick={handlePick}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}

function BuilderEmptyIcon(): React.ReactNode {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 2" />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}