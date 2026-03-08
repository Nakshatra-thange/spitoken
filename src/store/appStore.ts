import { create } from "zustand"
import { type ProgramSchema } from "../types/idl"

// ─── IDL LOAD STATE ───────────────────────────────────────────────────────────

export type IdlLoadStatus =
  | { kind: "idle" }
  | { kind: "loading"; source: "file" | "chain"; label: string }
  | { kind: "error"; message: string }
  | { kind: "success" }

// ─── STORE SHAPE ──────────────────────────────────────────────────────────────

interface AppState {
  // The loaded program schema — null until an IDL is loaded
  schema: ProgramSchema | null
  // Status of the current / last IDL load operation
  idlStatus: IdlLoadStatus
  // Which instruction is selected in the list (by index)
  selectedInstructionIndex: number | null

  // Actions
  setSchema: (schema: ProgramSchema) => void
  setIdlStatus: (status: IdlLoadStatus) => void
  setSelectedInstructionIndex: (index: number | null) => void
  reset: () => void
}

// ─── STORE ────────────────────────────────────────────────────────────────────

export const useAppStore = create<AppState>()((set) => ({
  schema: null,
  idlStatus: { kind: "idle" },
  selectedInstructionIndex: null,

  setSchema: (schema) =>
    set({ schema, idlStatus: { kind: "success" }, selectedInstructionIndex: null }),

  setIdlStatus: (idlStatus) => set({ idlStatus }),

  setSelectedInstructionIndex: (selectedInstructionIndex) =>
    set({ selectedInstructionIndex }),

  reset: () =>
    set({
      schema: null,
      idlStatus: { kind: "idle" },
      selectedInstructionIndex: null,
    }),
}))