/**
 * builder.ts
 *
 * All types for the transaction builder layer.
 * An "InstructionInstance" is a mutable, in-progress copy of an InstructionDefinition.
 * It holds the user's filled arguments and the live resolution state of each account slot.
 */

import { type InstructionDefinition, type FieldType } from "./idl"

// ─── ARGUMENT VALUES ──────────────────────────────────────────────────────────
// ArgValue mirrors the FieldType tree but carries actual user-supplied values
// instead of type descriptions. Every node can be valid or invalid.

export type ArgValue =
  | { kind: "primitive"; raw: string }          // raw string from input, validated on use
  | { kind: "bool"; value: boolean }
  | { kind: "vec"; items: ArgValue[] }
  | { kind: "array"; items: ArgValue[] }
  | { kind: "option"; inner: ArgValue | null }   // null = None
  | { kind: "struct"; fields: Record<string, ArgValue> }
  | { kind: "enum"; variant: string; fields: Record<string, ArgValue> }

// ─── ARG VALIDATION ───────────────────────────────────────────────────────────

export interface ArgValidation {
  valid: boolean
  errorMessage: string | null
}

// ─── ACCOUNT RESOLUTION ───────────────────────────────────────────────────────

export type AccountResolutionStatus =
  | { kind: "idle" }
  | { kind: "resolving" }
  | { kind: "resolved"; address: string; source: ResolutionSource }
  | { kind: "warning"; address: string; source: ResolutionSource; message: string }
  | { kind: "error"; message: string }
  | { kind: "manual"; address: string }   // user explicitly typed this

export type ResolutionSource =
  | "constant"   // well-known program address
  | "wallet"     // connected wallet
  | "pda"        // derived from seeds
  | "ata"        // associated token account

// ─── ACCOUNT SLOT STATE ───────────────────────────────────────────────────────
// One per account required by the instruction

export interface AccountSlotState {
  /** mirrors AccountSlot.name */
  name: string
  isMut: boolean
  isSigner: boolean
  isOptional: boolean
  resolution: AccountResolutionStatus
  /** What the user has typed into the manual input field (may be empty) */
  manualInput: string
}

// ─── INSTRUCTION INSTANCE ─────────────────────────────────────────────────────
// The live, mutable state for one instruction being built

export interface InstructionInstance {
  /** Stable ID for React keys */
  id: string
  /** Reference back to the definition */
  definition: InstructionDefinition
  /** One entry per definition.accounts slot, same order */
  accounts: AccountSlotState[]
  /** One entry per definition.args field, keyed by field name */
  args: Record<string, ArgValue>
}

// ─── BUILDER STATE ────────────────────────────────────────────────────────────

export interface BuilderState {
  /** Ordered list of instructions being composed */
  instructions: InstructionInstance[]
  /** Which instruction is focused in the builder (index into instructions[]) */
  focusedIndex: number | null
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

let _instanceCounter = 0

export function newInstanceId(): string {
  return `ix_${++_instanceCounter}`
}

/** Create a default empty ArgValue for a given FieldType */
export function defaultArgValue(type: FieldType): ArgValue {
  switch (type.kind) {
    case "primitive":
      if (type.type === "bool") return { kind: "bool", value: false }
      return { kind: "primitive", raw: "" }
    case "vec":
      return { kind: "vec", items: [] }
    case "array":
      return {
        kind: "array",
        items: Array.from({ length: type.len }, () => defaultArgValue(type.item)),
      }
    case "option":
    case "coption":
      return { kind: "option", inner: null }
    case "defined":
      // We can't know the shape without the type registry here.
      // The builder component resolves this at render time.
      return { kind: "struct", fields: {} }
  }
}

/** Create a fresh InstructionInstance from a definition */
export function createInstance(definition: InstructionDefinition): InstructionInstance {
  const accounts: AccountSlotState[] = definition.accounts.map((slot) => ({
    name: slot.name,
    isMut: slot.isMut,
    isSigner: slot.isSigner,
    isOptional: slot.isOptional,
    resolution: { kind: "idle" },
    manualInput: "",
  }))

  const args: Record<string, ArgValue> = {}
  for (const field of definition.args) {
    args[field.name] = defaultArgValue(field.type)
  }

  return {
    id: newInstanceId(),
    definition,
    accounts,
    args,
  }
}