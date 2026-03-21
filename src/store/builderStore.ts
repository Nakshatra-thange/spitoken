/**
 * builderStore.ts
 *
 * Zustand store for the transaction builder.
 * Kept separate from appStore so the builder state is independently manageable.
 *
 * The key data structure is a flat array of InstructionInstances.
 * All mutations go through this store — components never mutate instances directly.
 */

import { create } from "zustand"
import {
  type InstructionInstance,
  type AccountResolutionStatus,
  type ArgValue,
  createInstance,
  newInstanceId,
} from "../types/builder"
import { type InstructionDefinition } from "../types/idl"

// ─── STORE SHAPE ──────────────────────────────────────────────────────────────

interface BuilderStore {
  instances: InstructionInstance[]
  focusedId: string | null

  // ── Instance lifecycle ────────────────────────────────────────────────────
  addInstruction: (definition: InstructionDefinition) => string 
  setInstructions: (instructions: InstructionInstance[]) => void
  removeInstruction: (id: string) => void
  moveInstruction: (id: string, direction: "up" | "down") => void
  duplicateInstruction: (id: string) => void
  setFocused: (id: string | null) => void
  clearAll: () => void

  // ── Account slot updates ──────────────────────────────────────────────────
  updateAccountResolution: (
    instanceId: string,
    slotIndex: number,
    resolution: AccountResolutionStatus
  ) => void
  setAccountManualInput: (
    instanceId: string,
    slotIndex: number,
    value: string
  ) => void

  // ── Argument updates ──────────────────────────────────────────────────────
  setArgValue: (
    instanceId: string,
    fieldName: string,
    value: ArgValue
  ) => void
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

export function updateInstance(
  instances: InstructionInstance[],
  id: string,
  updater: (inst: InstructionInstance) => InstructionInstance
): InstructionInstance[] {
  return instances.map((inst) => (inst.id === id ? updater(inst) : inst))
}

// ─── STORE ────────────────────────────────────────────────────────────────────

export const useBuilderStore = create<BuilderStore>()((set, get) => ({
  instances: [],
  focusedId: null,

  addInstruction: (definition) => {
    const instance = createInstance(definition)
    set((state) => ({
      instances: [...state.instances, instance],
      focusedId: instance.id,
    }))
    return instance.id
  },

  setInstructions: (instructions) => {
    set({ instances: instructions, focusedId: instructions[instructions.length - 1]?.id ?? null })
  },
  removeInstruction: (id) => {
    set((state) => {
      const instances = state.instances.filter((i) => i.id !== id)
      const focusedId =
        state.focusedId === id
          ? (instances[instances.length - 1]?.id ?? null)
          : state.focusedId
      return { instances, focusedId }
    })
  },

  moveInstruction: (id, direction) => {
    set((state) => {
      const idx = state.instances.findIndex((i) => i.id === id)
      if (idx < 0) return state
      const newIdx = direction === "up" ? idx - 1 : idx + 1
      if (newIdx < 0 || newIdx >= state.instances.length) return state

      const instances = [...state.instances]
      const temp = instances[idx]
      const neighbor = instances[newIdx]
      if (temp === undefined || neighbor === undefined) return state
      instances[idx] = neighbor
      instances[newIdx] = temp
      return { instances }
    })
  },

  duplicateInstruction: (id) => {
    set((state) => {
      const source = state.instances.find((i) => i.id === id)
      if (source === undefined) return state

      const duplicate: InstructionInstance = {
        ...source,
        id: newInstanceId(),
        accounts: source.accounts.map((a) => ({ ...a, resolution: { kind: "idle" } })),
        args: { ...source.args },
      }

      const idx = state.instances.findIndex((i) => i.id === id)
      const instances = [
        ...state.instances.slice(0, idx + 1),
        duplicate,
        ...state.instances.slice(idx + 1),
      ]
      return { instances, focusedId: duplicate.id }
    })
  },

  setFocused: (focusedId) => set({ focusedId }),

  clearAll: () => set({ instances: [], focusedId: null }),

  updateAccountResolution: (instanceId, slotIndex, resolution) => {
    set((state) => ({
      instances: updateInstance(state.instances, instanceId, (inst) => {
        const accounts = [...inst.accounts]
        const slot = accounts[slotIndex]
        if (slot === undefined) return inst
        accounts[slotIndex] = { ...slot, resolution }
        return { ...inst, accounts }
      }),
    }))
  },

  setAccountManualInput: (instanceId, slotIndex, value) => {
    set((state) => ({
      instances: updateInstance(state.instances, instanceId, (inst) => {
        const accounts = [...inst.accounts]
        const slot = accounts[slotIndex]
        if (slot === undefined) return inst
        accounts[slotIndex] = {
          ...slot,
          manualInput: value,
          resolution: value.trim() === "" ? { kind: "idle" } : { kind: "resolving" },
        }
        return { ...inst, accounts }
      }),
    }))
  },

  setArgValue: (instanceId, fieldName, value) => {
    set((state) => ({
      instances: updateInstance(state.instances, instanceId, (inst) => ({
        ...inst,
        args: { ...inst.args, [fieldName]: value },
      })),
    }))
  },
}))