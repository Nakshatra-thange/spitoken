/**
 * argValidator.ts
 *
 * Validates user-supplied ArgValues against their expected FieldTypes.
 * Returns per-field validation results for live UI feedback.
 *
 * Important: u64/u128 values are kept as strings in ArgValue.primitive.raw
 * because Number loses precision above 2^53. We validate them as BigInt here.
 */

import { PublicKey } from "@solana/web3.js"
import { type FieldType, type PrimitiveKind, type TypeDefinition } from "../types/idl"
import { type ArgValue, type ArgValidation } from "../types/builder"

// ─── PRIMITIVE VALIDATORS ─────────────────────────────────────────────────────

const UINT_RANGES: Partial<Record<PrimitiveKind, { min: bigint; max: bigint }>> = {
  u8:   { min: 0n,                   max: 255n },
  u16:  { min: 0n,                   max: 65535n },
  u32:  { min: 0n,                   max: 4294967295n },
  u64:  { min: 0n,                   max: 18446744073709551615n },
  u128: { min: 0n,                   max: 340282366920938463463374607431768211455n },
  i8:   { min: -128n,                max: 127n },
  i16:  { min: -32768n,              max: 32767n },
  i32:  { min: -2147483648n,         max: 2147483647n },
  i64:  { min: -9223372036854775808n, max: 9223372036854775807n },
  i128: { min: -(1n << 127n),        max: (1n << 127n) - 1n },
}

function validatePrimitive(raw: string, type: PrimitiveKind): ArgValidation {
  const trimmed = raw.trim()

  if (trimmed === "") {
    return { valid: false, errorMessage: "Required" }
  }

  switch (type) {
    case "bool": {
      if (trimmed !== "true" && trimmed !== "false") {
        return { valid: false, errorMessage: 'Must be "true" or "false"' }
      }
      return { valid: true, errorMessage: null }
    }

    case "u8": case "u16": case "u32": case "u64": case "u128":
    case "i8": case "i16": case "i32": case "i64": case "i128": {
      const range = UINT_RANGES[type]
      if (range === undefined) return { valid: true, errorMessage: null }

      let n: bigint
      try {
        // Allow decimal or 0x hex notation
        n = trimmed.startsWith("0x") || trimmed.startsWith("0X")
          ? BigInt(trimmed)
          : BigInt(trimmed)
      } catch {
        return { valid: false, errorMessage: `Must be an integer` }
      }

      if (n < range.min || n > range.max) {
        return {
          valid: false,
          errorMessage: `Out of range [${range.min}, ${range.max}]`,
        }
      }
      return { valid: true, errorMessage: null }
    }

    case "f32":
    case "f64": {
      const n = Number(trimmed)
      if (isNaN(n)) return { valid: false, errorMessage: "Must be a number" }
      return { valid: true, errorMessage: null }
    }

    case "publicKey": {
      try {
        new PublicKey(trimmed)
        return { valid: true, errorMessage: null }
      } catch {
        return { valid: false, errorMessage: "Not a valid base58 public key" }
      }
    }

    case "string": {
      return { valid: true, errorMessage: null }
    }

    case "bytes": {
      const cleaned = trimmed.replace(/\s/g, "").replace(/^0x/i, "")
      if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
        return { valid: false, errorMessage: "Must be hex (e.g. deadbeef)" }
      }
      if (cleaned.length % 2 !== 0) {
        return { valid: false, errorMessage: "Odd number of hex digits" }
      }
      return { valid: true, errorMessage: null }
    }
  }
}

// ─── MAIN VALIDATOR ───────────────────────────────────────────────────────────

export function validateArgValue(
  value: ArgValue,
  type: FieldType,
  typeRegistry: Map<string, TypeDefinition>
): ArgValidation {
  switch (type.kind) {
    case "primitive": {
      if (value.kind === "bool") {
        return { valid: true, errorMessage: null }
      }
      if (value.kind !== "primitive") {
        return { valid: false, errorMessage: "Type mismatch" }
      }
      const raw =
        value.raw ??
        (value.value !== undefined
          ? (typeof value.value === "bigint" ? value.value.toString() : String(value.value))
          : "")
      return validatePrimitive(raw, type.type)
    }

    case "vec": {
      if (value.kind !== "vec") return { valid: false, errorMessage: "Type mismatch" }
      // A vec is valid if all items are valid
      for (let i = 0; i < value.items.length; i++) {
        const item = value.items[i]
        if (item === undefined) continue
        const itemValidation = validateArgValue(item, type.item, typeRegistry)
        if (!itemValidation.valid) {
          return { valid: false, errorMessage: `Item ${i}: ${itemValidation.errorMessage ?? "invalid"}` }
        }
      }
      return { valid: true, errorMessage: null }
    }

    case "array": {
      if (value.kind !== "array") return { valid: false, errorMessage: "Type mismatch" }
      if (value.items.length !== type.len) {
        return { valid: false, errorMessage: `Need exactly ${type.len} items` }
      }
      for (let i = 0; i < value.items.length; i++) {
        const item = value.items[i]
        if (item === undefined) continue
        const itemValidation = validateArgValue(item, type.item, typeRegistry)
        if (!itemValidation.valid) {
          return { valid: false, errorMessage: `[${i}]: ${itemValidation.errorMessage ?? "invalid"}` }
        }
      }
      return { valid: true, errorMessage: null }
    }

    case "option":
    case "coption": {
      if (value.kind !== "option") return { valid: false, errorMessage: "Type mismatch" }
      if (value.inner === null) return { valid: true, errorMessage: null } // None is valid
      return validateArgValue(value.inner, type.item, typeRegistry)
    }

    case "defined": {
      const typeDef = typeRegistry.get(type.name)
      if (typeDef === undefined) return { valid: true, errorMessage: null } // can't validate unknown types

      if (typeDef.shape.kind === "struct") {
        if (value.kind !== "struct") return { valid: false, errorMessage: "Type mismatch" }
        for (const field of typeDef.shape.fields) {
          const fieldValue = value.fields[field.name]
          if (fieldValue === undefined) {
            return { valid: false, errorMessage: `Missing field: ${field.name}` }
          }
          const fieldValidation = validateArgValue(fieldValue, field.type, typeRegistry)
          if (!fieldValidation.valid) {
            return { valid: false, errorMessage: `${field.name}: ${fieldValidation.errorMessage ?? "invalid"}` }
          }
        }
        return { valid: true, errorMessage: null }
      }

      // enum
      if (value.kind !== "enum") return { valid: false, errorMessage: "Type mismatch" }
      const variant = typeDef.shape.variants.find((v) => v.name === value.variant)
      if (variant === undefined) {
        return { valid: false, errorMessage: `Unknown variant: ${value.variant}` }
      }
      return { valid: true, errorMessage: null }
    }
  }
}

// ─── CONVENIENCE: CHECK IF AN ENTIRE INSTANCE IS READY ───────────────────────

export function getArgValidationMap(
  args: Record<string, ArgValue>,
  fields: { name: string; type: FieldType }[],
  typeRegistry: Map<string, TypeDefinition>
): Record<string, ArgValidation> {
  const result: Record<string, ArgValidation> = {}
  for (const field of fields) {
    const value = args[field.name]
    if (value === undefined) {
      result[field.name] = { valid: false, errorMessage: "Required" }
    } else {
      result[field.name] = validateArgValue(value, field.type, typeRegistry)
    }
  }
  return result
}