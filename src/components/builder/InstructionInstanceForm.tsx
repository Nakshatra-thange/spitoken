/**
 * InstructionInstanceForm.tsx
 *
 * The form for one InstructionInstance.
 * Shows all account slots (with auto-resolution) and all argument fields.
 *
 * Resolution is kicked off via useEffect on mount and when walletAddress changes.
 * Each slot update comes back through the store via the onUpdate callback.
 */

import React, { useEffect, useRef, useCallback } from "react"
import { type InstructionInstance, type ArgValue } from "../../types/builder"
import { type ProgramSchema } from "../../types/idl"
import { useBuilderStore } from "../../store/builderStore"
import { resolveAccountSlots, validateManualAddress } from "../../lib/accountResolver"
import { getConnection } from "../../lib/connection"
import { getArgValidationMap } from "../../lib/argValidator"
import { AccountSlotRow } from "./AccountSlotRow"
import { ArgInput } from "./ArgInput"

// ─── PROPS ────────────────────────────────────────────────────────────────────

interface InstructionInstanceFormProps {
  instance: InstructionInstance
  schema: ProgramSchema
  walletAddress: string | null
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export function InstructionInstanceForm({
  instance,
  schema,
  walletAddress,
}: InstructionInstanceFormProps): React.ReactNode {
  const { updateAccountResolution, setAccountManualInput, setArgValue } = useBuilderStore()
  const resolvedRef = useRef(false)

  // ── Auto-resolution on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (resolvedRef.current) return
    resolvedRef.current = true

    // Mark all slots as "resolving" immediately for UI feedback
    instance.definition.accounts.forEach((_, idx) => {
      updateAccountResolution(instance.id, idx, { kind: "resolving" })
    })

    void resolveAccountSlots(
      instance.definition.accounts,
      schema,
      walletAddress,
      getConnection(),
      ({ slotIndex, status }) => {
        updateAccountResolution(instance.id, slotIndex, status)
      }
    )
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]) // Only re-run if the instance changes (new instruction added)

  // ── Manual address commit handler ───────────────────────────────────────────
  const handleManualCommit = useCallback(
    async (slotIndex: number, value: string) => {
      if (value.trim() === "") {
        updateAccountResolution(instance.id, slotIndex, { kind: "idle" })
        return
      }
      const slotDef = instance.definition.accounts[slotIndex]
      if (slotDef === undefined) return
      const status = await validateManualAddress(getConnection(), value, slotDef, schema)
      updateAccountResolution(instance.id, slotIndex, status)
    },
    [instance.id, instance.definition.accounts, schema, updateAccountResolution]
  )

  // ── Arg change handler ──────────────────────────────────────────────────────
  const handleArgChange = useCallback(
    (fieldName: string, value: ArgValue) => {
      setArgValue(instance.id, fieldName, value)
    },
    [instance.id, setArgValue]
  )

  // ── Validation state for args ────────────────────────────────────────────────
  const validations = getArgValidationMap(
    instance.args,
    instance.definition.args,
    schema.typeRegistry
  )

  const validArgCount = Object.values(validations).filter((v) => v.valid).length
  const totalArgs = instance.definition.args.length
  const resolvedAccounts = instance.accounts.filter(
    (a) => a.resolution.kind === "resolved" || a.resolution.kind === "manual" || a.resolution.kind === "warning"
  ).length
  const totalAccounts = instance.accounts.length

  return (
    <div className="ix-form">
      {/* ── Progress summary ── */}
      <div className="ix-form__progress">
        <ProgressPill
          done={resolvedAccounts}
          total={totalAccounts}
          label="accounts"
          variant={resolvedAccounts === totalAccounts ? "green" : "yellow"}
        />
        {totalArgs > 0 && (
          <ProgressPill
            done={validArgCount}
            total={totalArgs}
            label="args"
            variant={validArgCount === totalArgs ? "green" : "yellow"}
          />
        )}
      </div>

      {/* ── Accounts section ── */}
      {totalAccounts > 0 && (
        <section className="ix-form__section">
          <h3 className="ix-form__section-title">
            Accounts
            <span className="ix-form__section-count">{totalAccounts}</span>
          </h3>
          <div className="slot-list">
            {instance.accounts.map((slotState, i) => {
              const slotDef = instance.definition.accounts[i]
              if (slotDef === undefined) return null
              return (
                <AccountSlotRow
                  key={slotState.name}
                  slotDef={slotDef}
                  slotState={slotState}
                  index={i}
                  onManualInputChange={(v) =>
                    setAccountManualInput(instance.id, i, v)
                  }
                  onManualInputCommit={(v) => void handleManualCommit(i, v)}
                />
              )
            })}
          </div>
        </section>
      )}

      {/* ── Arguments section ── */}
      {totalArgs > 0 && (
        <section className="ix-form__section">
          <h3 className="ix-form__section-title">
            Arguments
            <span className="ix-form__section-count">{totalArgs}</span>
          </h3>
          <div className="arg-list">
            {instance.definition.args.map((field) => {
              const value = instance.args[field.name]
              if (value === undefined) return null
              return (
                <div key={field.name} className="arg-list-row">
                  <ArgInput
                    type={field.type}
                    value={value}
                    onChange={(v) => handleArgChange(field.name, v)}
                    typeRegistry={schema.typeRegistry}
                    label={field.name}
                  />
                  {field.docs.length > 0 && (
                    <p className="arg-docs">{field.docs[0]}</p>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── No accounts + no args ── */}
      {totalAccounts === 0 && totalArgs === 0 && (
        <div className="ix-form__empty">
          This instruction requires no accounts and no arguments.
        </div>
      )}
    </div>
  )
}

// ─── PROGRESS PILL ────────────────────────────────────────────────────────────

function ProgressPill({
  done,
  total,
  label,
  variant,
}: {
  done: number
  total: number
  label: string
  variant: "green" | "yellow"
}): React.ReactNode {
  return (
    <span className={`progress-pill progress-pill--${variant}`}>
      {done}/{total} {label}
    </span>
  )
}