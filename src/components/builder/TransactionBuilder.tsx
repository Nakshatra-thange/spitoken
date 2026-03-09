/**
 * TransactionBuilder.tsx  (Day 2 Afternoon — full rebuild)
 *
 * Layout:
 *   ┌─────────────────┬──────────────────────────┬───────────────────┐
 *   │  Instruction    │  Focused instruction     │  Tx Summary       │
 *   │  list           │  form (accounts + args)  │  (stats /         │
 *   │  (drag-drop)    │                          │   conflicts /     │
 *   │                 │                          │   suggestions)    │
 *   └─────────────────┴──────────────────────────┴───────────────────┘
 *
 * Drag-and-drop is implemented with the native HTML5 drag API — no external
 * library needed for a flat ordered list. We store the dragged ID in a ref
 * and update positions on dragover + drop.
 */

import React, { useState, useCallback, useRef, type DragEvent } from "react"
import { useAppStore } from "../../store/appStore"
import { useBuilderStore } from "../../store/builderStore"
import { InstructionInstanceForm } from "./InstructionInstanceForm"
import { TxSummaryPanel } from "./TxSummaryPanel"
import { getResolvedAddress } from "../../lib/txValidator"
import { type InstructionDefinition } from "../../types/idl"
import { type InstructionInstance } from "../../types/builder"

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
      <div
        className="ix-picker"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Add instruction"
        aria-modal="true"
      >
        <div className="ix-picker__header">
          <span className="ix-picker__title">Add Instruction</span>
          <button className="ix-picker__close" onClick={onClose} type="button" aria-label="Close">
            ×
          </button>
        </div>
        <div className="ix-picker__search-wrap">
          <input
            className="ix-picker__search"
            type="text"
            placeholder="Search instructions…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            // eslint-disable-next-line jsx-a11y/no-autofocus
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
                {def.accounts.length} acct · {def.args.length} arg
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── INSTRUCTION LIST ITEM ────────────────────────────────────────────────────
// Draggable. Shows execution number, name, readiness dot, and action buttons.

function InstructionListItem({
  inst,
  index,
  total,
  isFocused,
  isDragOver,
  onFocus,
  onRemove,
  onDuplicate,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
}: {
  inst: InstructionInstance
  index: number
  total: number
  isFocused: boolean
  isDragOver: boolean
  onFocus: () => void
  onRemove: () => void
  onDuplicate: () => void
  onDragStart: (e: DragEvent<HTMLDivElement>) => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
}): React.ReactNode {
  const resolved = inst.accounts.filter(
    (a) => getResolvedAddress(a.resolution) !== null
  ).length
  const total_acct = inst.accounts.length
  const allResolved = total_acct === 0 || resolved === total_acct
  const hasErrors = inst.accounts.some((a) => a.resolution.kind === "error")

  const statusColor = hasErrors
    ? "red"
    : allResolved
    ? "green"
    : "yellow"

  return (
    <div
      className={[
        "ixlist-item",
        isFocused ? "ixlist-item--focused" : "",
        isDragOver ? "ixlist-item--dragover" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDrop={onDrop}
      data-id={inst.id}
    >
      {/* Drag handle */}
      <span className="ixlist-item__handle" aria-hidden="true" title="Drag to reorder">
        ⠿
      </span>

      {/* Execution number */}
      <span className="ixlist-item__num">{index + 1}</span>

      {/* Arrow between items (visual order cue) */}
      {index < total - 1 && (
        <span className="ixlist-item__order-hint">→</span>
      )}

      {/* Main click area */}
      <button className="ixlist-item__body" onClick={onFocus} type="button">
        <span className="ixlist-item__name">{inst.definition.name}</span>
        <span className="ixlist-item__meta">
          {total_acct > 0 && (
            <span className="ixlist-item__acct-count">
              {resolved}/{total_acct} acct
            </span>
          )}
        </span>
      </button>

      {/* Readiness dot */}
      <span
        className={`ixlist-item__dot ixlist-item__dot--${statusColor}`}
        title={
          hasErrors
            ? "Has errors"
            : allResolved
            ? "All accounts resolved"
            : `${total_acct - resolved} account(s) pending`
        }
      />

      {/* Actions */}
      <div className="ixlist-item__actions">
        <button
          className="ixlist-item__action"
          onClick={onDuplicate}
          type="button"
          title="Duplicate"
          aria-label="Duplicate instruction"
        >
          ⧉
        </button>
        <button
          className="ixlist-item__action ixlist-item__action--danger"
          onClick={onRemove}
          type="button"
          title="Remove"
          aria-label="Remove instruction"
        >
          ×
        </button>
      </div>
    </div>
  )
}

// ─── DRAGGABLE INSTRUCTION LIST ───────────────────────────────────────────────

function DraggableInstructionList(): React.ReactNode {
  const {
    instances,
    focusedId,
    setFocused,
    removeInstruction,
    duplicateInstruction,
  } = useBuilderStore()

  // We store drag state in refs to avoid re-renders on every dragover event.
  const dragIdRef = useRef<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const handleDragStart = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      dragIdRef.current = id
      e.dataTransfer.effectAllowed = "move"
      // Required for Firefox
      e.dataTransfer.setData("text/plain", id)
    },
    []
  )

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>, id: string) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = "move"
      if (id !== dragIdRef.current) setDragOverId(id)
    },
    []
  )

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>, targetId: string) => {
      e.preventDefault()
      const sourceId = dragIdRef.current
      if (sourceId === null || sourceId === targetId) return

      // Reorder in the store
      useBuilderStore.setState((state) => {
        const items = [...state.instances]
        const srcIdx = items.findIndex((i) => i.id === sourceId)
        const tgtIdx = items.findIndex((i) => i.id === targetId)
        if (srcIdx < 0 || tgtIdx < 0) return state
        const [moved] = items.splice(srcIdx, 1)
        if (moved === undefined) return state
        items.splice(tgtIdx, 0, moved)
        return { instances: items }
      })

      setDragOverId(null)
      dragIdRef.current = null
    },
    []
  )

  const handleDragEnd = useCallback(() => {
    dragIdRef.current = null
    setDragOverId(null)
  }, [])

  return (
    <div className="ixlist" role="list" aria-label="Instructions">
      {instances.map((inst, i) => (
        <InstructionListItem
          key={inst.id}
          inst={inst}
          index={i}
          total={instances.length}
          isFocused={focusedId === inst.id}
          isDragOver={dragOverId === inst.id}
          onFocus={() => setFocused(inst.id)}
          onRemove={() => removeInstruction(inst.id)}
          onDuplicate={() => duplicateInstruction(inst.id)}
          onDragStart={(e) => handleDragStart(e, inst.id)}
          onDragOver={(e) => handleDragOver(e, inst.id)}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e, inst.id)}
        />
      ))}
    </div>
  )
}

// ─── LEFT PANEL ───────────────────────────────────────────────────────────────

function InstructionListPanel({
  onAddInstruction,
  onClearAll,
}: {
  onAddInstruction: () => void
  onClearAll: () => void
}): React.ReactNode {
  const { instances } = useBuilderStore()

  return (
    <div className="builder-left-panel">
      <div className="builder-left-panel__header">
        <div className="builder-left-panel__title-row">
          <span className="builder-left-panel__title">Transaction</span>
          <span className="builder-left-panel__subtitle">
            {instances.length === 0
              ? "No instructions"
              : `${instances.length} instruction${instances.length !== 1 ? "s" : ""}`}
          </span>
        </div>
        {instances.length > 0 && (
          <button
            className="builder-clear-btn"
            onClick={onClearAll}
            type="button"
            title="Clear all instructions"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Order explanation when multiple instructions exist */}
      {instances.length > 1 && (
        <div className="builder-order-hint">
          <span className="builder-order-hint__icon">↕</span>
          <span>Drag to reorder — Solana executes top→bottom</span>
        </div>
      )}

      <div className="builder-left-panel__list">
        {instances.length === 0 ? (
          <div className="builder-list-empty">
            <span className="builder-list-empty__icon">⬡</span>
            <span>Add your first instruction</span>
          </div>
        ) : (
          <DraggableInstructionList />
        )}
      </div>

      <button className="builder-add-btn" onClick={onAddInstruction} type="button">
        + Add Instruction
      </button>
    </div>
  )
}

// ─── CENTER FORM PANEL ────────────────────────────────────────────────────────

function FormPanel(): React.ReactNode {
  const { instances, focusedId } = useBuilderStore()
  const { schema } = useAppStore()
  const focusedInstance = instances.find((i) => i.id === focusedId) ?? null

  if (schema === null) return null

  if (focusedInstance === null) {
    return (
      <div className="builder-form-panel">
        <div className="builder-empty-state">
          <BuilderEmptyIcon />
          <p className="builder-empty-state__title">No instruction selected</p>
          <p className="builder-empty-state__hint">
            {instances.length === 0
              ? "Add an instruction to start building your transaction."
              : "Select an instruction from the list to edit it."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="builder-form-panel">
      <div className="builder-form-panel__header">
        <div className="builder-form-panel__breadcrumb">
          <span className="builder-form-panel__ix-num">
            ix {(instances.findIndex((i) => i.id === focusedId) + 1)
              .toString()
              .padStart(2, "0")}
          </span>
          <h2 className="builder-form-panel__name">{focusedInstance.definition.name}</h2>
        </div>
        {focusedInstance.definition.docs.length > 0 && (
          <p className="builder-form-panel__docs">
            {focusedInstance.definition.docs[0]}
          </p>
        )}
      </div>
      <InstructionInstanceForm
        instance={focusedInstance}
        schema={schema}
        walletAddress={null}
      />
    </div>
  )
}

// ─── RIGHT SUMMARY PANEL WRAPPER ──────────────────────────────────────────────

function SummaryPanel(): React.ReactNode {
  return (
    <div className="builder-right-panel">
      <div className="builder-right-panel__header">
        <span className="builder-right-panel__title">Summary</span>
      </div>
      <div className="builder-right-panel__body">
        <TxSummaryPanel />
      </div>
    </div>
  )
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────

export function TransactionBuilder(): React.ReactNode {
  const { schema } = useAppStore()
  const { addInstruction, clearAll } = useBuilderStore()
  const [showPicker, setShowPicker] = useState(false)

  const handlePick = useCallback(
    (def: InstructionDefinition): void => {
      addInstruction(def)
      setShowPicker(false)
    },
    [addInstruction]
  )

  if (schema === null) return null

  return (
    <div className="transaction-builder">
      <InstructionListPanel
        onAddInstruction={() => setShowPicker(true)}
        onClearAll={clearAll}
      />

      <FormPanel />

      <SummaryPanel />

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

// ─── ICON ─────────────────────────────────────────────────────────────────────

function BuilderEmptyIcon(): React.ReactNode {
  return (
    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect
        x="3" y="3" width="18" height="18" rx="3"
        stroke="currentColor" strokeWidth="1.2" strokeDasharray="4 2"
      />
      <path d="M12 8v8M8 12h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}