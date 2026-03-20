/**
 * borshDecoder.ts
 *
 * A pure, dependency-free Borsh decoder that reads raw account bytes into
 * typed JavaScript values, guided by our internal FieldType definitions.
 *
 * Why we wrote our own instead of using @coral-xyz/borsh:
 *   - We need to return rich DecodedValue objects (value + type label) for display
 *   - We need readable error messages per-field for the inspector UI
 *   - No runtime dependency on anchor means no version mismatches
 *
 * Borsh spec reference: https://borsh.io
 * All multi-byte integers are little-endian.
 */

import { PublicKey } from "@solana/web3.js"
import { type FieldType, type TypeDefinition } from "../types/idl"

// ─── DECODED VALUE TYPES ──────────────────────────────────────────────────────
// Every decoded field carries its value, its type label (for display), and
// optional nested children (for structs/vecs/arrays).

export type DecodedValue =
  | { kind: "bool";      value: boolean;          typeLabel: string }
  | { kind: "uint";      value: bigint;            typeLabel: string }
  | { kind: "int";       value: bigint;            typeLabel: string }
  | { kind: "float";     value: number;            typeLabel: string }
  | { kind: "publicKey"; value: string;            typeLabel: string }  // base58
  | { kind: "string";    value: string;            typeLabel: string }
  | { kind: "bytes";     value: Uint8Array;        typeLabel: string }
  | { kind: "vec";       items: DecodedField[];    typeLabel: string }
  | { kind: "array";     items: DecodedField[];    typeLabel: string }
  | { kind: "option";    inner: DecodedField | null; typeLabel: string }
  | { kind: "struct";    fields: DecodedField[];   typeLabel: string }
  | { kind: "enum";      variant: string; fields: DecodedField[]; typeLabel: string }
  | { kind: "unknown";   raw: Uint8Array;          typeLabel: string }

export interface DecodedField {
  name: string
  value: DecodedValue
  /** Byte offset where this field started in the account data buffer */
  offset: number
}

export interface DecodeResult {
  fields: DecodedField[]
  /** How many bytes were consumed total */
  bytesRead: number
}

// ─── DECODE ERROR ─────────────────────────────────────────────────────────────

export class BorshDecodeError extends Error {
  constructor(
    message: string,
    public readonly fieldPath: string,
    public readonly offset: number
  ) {
    super(`[${fieldPath} @ offset ${offset}] ${message}`)
    this.name = "BorshDecodeError"
  }
}

// ─── READER ───────────────────────────────────────────────────────────────────
// A cursor-based reader over a Uint8Array. Advances position as values are read.

class BorshReader {
  private pos: number

  constructor(
    private readonly data: Uint8Array,
    startOffset = 0
  ) {
    this.pos = startOffset
  }

  get offset(): number { return this.pos }

  remaining(): number { return this.data.length - this.pos }

  private require(n: number, fieldPath: string): void {
    if (this.pos + n > this.data.length) {
      throw new BorshDecodeError(
        `Need ${n} bytes but only ${this.remaining()} remain`,
        fieldPath,
        this.pos
      )
    }
  }

  readU8(fieldPath: string): number {
    this.require(1, fieldPath)
    const v = this.data[this.pos]
    if (v === undefined) throw new BorshDecodeError("Unexpected end of data", fieldPath, this.pos)
    this.pos += 1
    return v
  }

  readU16(fieldPath: string): number {
    this.require(2, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 2)
    this.pos += 2
    return view.getUint16(0, true)
  }

  readU32(fieldPath: string): number {
    this.require(4, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 4)
    this.pos += 4
    return view.getUint32(0, true)
  }

  readU64(fieldPath: string): bigint {
    this.require(8, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8)
    this.pos += 8
    return view.getBigUint64(0, true)
  }

  readU128(fieldPath: string): bigint {
    // u128 = two consecutive u64s, low word first
    const lo = this.readU64(fieldPath)
    const hi = this.readU64(fieldPath)
    return (hi << 64n) | lo
  }

  readI8(fieldPath: string): bigint {
    this.require(1, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 1)
    this.pos += 1
    return BigInt(view.getInt8(0))
  }

  readI16(fieldPath: string): bigint {
    this.require(2, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 2)
    this.pos += 2
    return BigInt(view.getInt16(0, true))
  }

  readI32(fieldPath: string): bigint {
    this.require(4, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 4)
    this.pos += 4
    return BigInt(view.getInt32(0, true))
  }

  readI64(fieldPath: string): bigint {
    this.require(8, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8)
    this.pos += 8
    return view.getBigInt64(0, true)
  }

  readI128(fieldPath: string): bigint {
    // i128: read as two u64s then interpret as signed 128-bit
    const lo = this.readU64(fieldPath)
    const hi = this.readU64(fieldPath)
    const raw = (hi << 64n) | lo
    const MAX_I128 = (1n << 127n) - 1n
    return raw > MAX_I128 ? raw - (1n << 128n) : raw
  }

  readF32(fieldPath: string): number {
    this.require(4, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 4)
    this.pos += 4
    return view.getFloat32(0, true)
  }

  readF64(fieldPath: string): number {
    this.require(8, fieldPath)
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8)
    this.pos += 8
    return view.getFloat64(0, true)
  }

  readBytes(n: number, fieldPath: string): Uint8Array {
    this.require(n, fieldPath)
    const slice = this.data.slice(this.pos, this.pos + n)
    this.pos += n
    return slice
  }

  /** Borsh string: u32 length + UTF-8 bytes */
  readString(fieldPath: string): string {
    const len = this.readU32(fieldPath)
    if (len > 1_000_000) {
      throw new BorshDecodeError(`String length ${len} is unreasonably large`, fieldPath, this.pos)
    }
    const bytes = this.readBytes(len, fieldPath)
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      throw new BorshDecodeError("String bytes are not valid UTF-8", fieldPath, this.pos)
    }
  }

  /** Borsh bytes (Vec<u8>): u32 length + raw bytes */
  readByteVec(fieldPath: string): Uint8Array {
    const len = this.readU32(fieldPath)
    if (len > 10_000_000) {
      throw new BorshDecodeError(`Byte vec length ${len} is unreasonably large`, fieldPath, this.pos)
    }
    return this.readBytes(len, fieldPath)
  }

  readPublicKey(fieldPath: string): string {
    const bytes = this.readBytes(32, fieldPath)
    try {
      return new PublicKey(bytes).toBase58()
    } catch {
      throw new BorshDecodeError("Could not decode 32 bytes as a PublicKey", fieldPath, this.pos)
    }
  }

  peekU8(): number | undefined {
    return this.data[this.pos]
  }
}

// ─── MAIN DECODER ─────────────────────────────────────────────────────────────

export function decodeAccountData(
  data: Uint8Array,
  fields: { name: string; type: FieldType }[],
  typeRegistry: Map<string, TypeDefinition>,
  /** Skip the first N bytes (discriminator). Default: 8 */
  skipBytes = 8
): DecodeResult {
  const reader = new BorshReader(data, skipBytes)
  const decoded = decodeFields(fields, reader, typeRegistry, "")
  return {
    fields: decoded,
    bytesRead: reader.offset - skipBytes,
  }
}

function decodeFields(
  fields: { name: string; type: FieldType }[],
  reader: BorshReader,
  typeRegistry: Map<string, TypeDefinition>,
  parentPath: string
): DecodedField[] {
  return fields.map((field) => {
    const path = parentPath === "" ? field.name : `${parentPath}.${field.name}`
    const offset = reader.offset
    const value = decodeType(field.type, reader, typeRegistry, path)
    return { name: field.name, value, offset }
  })
}

function decodeType(
  type: FieldType,
  reader: BorshReader,
  typeRegistry: Map<string, TypeDefinition>,
  path: string
): DecodedValue {
  switch (type.kind) {
    case "primitive":
      return decodePrimitive(type.type, reader, path)

    case "vec": {
      const len = reader.readU32(path)
      if (len > 100_000) {
        throw new BorshDecodeError(`Vec length ${len} is unreasonably large`, path, reader.offset)
      }
      const items: DecodedField[] = []
      for (let i = 0; i < len; i++) {
        const offset = reader.offset
        const v = decodeType(type.item, reader, typeRegistry, `${path}[${i}]`)
        items.push({ name: String(i), value: v, offset })
      }
      return { kind: "vec", items, typeLabel: `Vec<${typeLabel(type.item)}>` }
    }

    case "array": {
      const items: DecodedField[] = []
      for (let i = 0; i < type.len; i++) {
        const offset = reader.offset
        const v = decodeType(type.item, reader, typeRegistry, `${path}[${i}]`)
        items.push({ name: String(i), value: v, offset })
      }
      return {
        kind: "array",
        items,
        typeLabel: `[${typeLabel(type.item)}; ${type.len}]`,
      }
    }

    case "option": {
      const discriminant = reader.readU8(`${path}?`)
      if (discriminant === 0) {
        return { kind: "option", inner: null, typeLabel: `Option<${typeLabel(type.item)}>` }
      }
      const offset = reader.offset
      const v = decodeType(type.item, reader, typeRegistry, path)
      return {
        kind: "option",
        inner: { name: "value", value: v, offset },
        typeLabel: `Option<${typeLabel(type.item)}>`,
      }
    }

    case "coption": {
      // COption is a Solana-specific 4-byte discriminant variant
      const discriminant = reader.readU32(`${path}?`)
      if (discriminant === 0) {
        return { kind: "option", inner: null, typeLabel: `COption<${typeLabel(type.item)}>` }
      }
      const offset = reader.offset
      const v = decodeType(type.item, reader, typeRegistry, path)
      return {
        kind: "option",
        inner: { name: "value", value: v, offset },
        typeLabel: `COption<${typeLabel(type.item)}>`,
      }
    }

    case "defined": {
      const typeDef = typeRegistry.get(type.name)
      if (typeDef === undefined) {
        // Unknown type — read nothing, mark as unknown
        return { kind: "unknown", raw: new Uint8Array(0), typeLabel: type.name }
      }
      return decodeTypeDef(typeDef, reader, typeRegistry, path)
    }
  }
}

function decodePrimitive(
  primitiveType: import("../types/idl").PrimitiveKind,
  reader: BorshReader,
  path: string
): DecodedValue {
  switch (primitiveType) {
    case "bool": {
      const b = reader.readU8(path)
      return { kind: "bool", value: b !== 0, typeLabel: "bool" }
    }
    case "u8":  return { kind: "uint", value: BigInt(reader.readU8(path)),  typeLabel: "u8"  }
    case "u16": return { kind: "uint", value: BigInt(reader.readU16(path)), typeLabel: "u16" }
    case "u32": return { kind: "uint", value: BigInt(reader.readU32(path)), typeLabel: "u32" }
    case "u64": return { kind: "uint", value: reader.readU64(path),         typeLabel: "u64" }
    case "u128":return { kind: "uint", value: reader.readU128(path),        typeLabel: "u128"}
    case "i8":  return { kind: "int",  value: reader.readI8(path),          typeLabel: "i8"  }
    case "i16": return { kind: "int",  value: reader.readI16(path),         typeLabel: "i16" }
    case "i32": return { kind: "int",  value: reader.readI32(path),         typeLabel: "i32" }
    case "i64": return { kind: "int",  value: reader.readI64(path),         typeLabel: "i64" }
    case "i128":return { kind: "int",  value: reader.readI128(path),        typeLabel: "i128"}
    case "f32": return { kind: "float",value: reader.readF32(path),         typeLabel: "f32" }
    case "f64": return { kind: "float",value: reader.readF64(path),         typeLabel: "f64" }
    case "publicKey": return { kind: "publicKey", value: reader.readPublicKey(path), typeLabel: "publicKey" }
    case "string":    return { kind: "string",    value: reader.readString(path),    typeLabel: "string"    }
    case "bytes":     return { kind: "bytes",     value: reader.readByteVec(path),   typeLabel: "bytes"     }
  }
}

function decodeTypeDef(
  typeDef: TypeDefinition,
  reader: BorshReader,
  typeRegistry: Map<string, TypeDefinition>,
  path: string
): DecodedValue {
  if (typeDef.shape.kind === "struct") {
    const fields = decodeFields(typeDef.shape.fields, reader, typeRegistry, path)
    return { kind: "struct", fields, typeLabel: typeDef.name }
  }

  // Enum: u8 variant index, then variant-specific fields
  const variantIndex = reader.readU8(`${path}#variant`)
  const variant = typeDef.shape.variants[variantIndex]
  if (variant === undefined) {
    throw new BorshDecodeError(
      `Enum variant index ${variantIndex} out of range (${typeDef.shape.variants.length} variants)`,
      path,
      reader.offset
    )
  }

  // Decode variant fields — they may be named or positional
  const fields: DecodedField[] = variant.fields
    .map((f, i) => {
      const offset = reader.offset
      if ("name" in f && "type" in f) {
        // Named field
        const v = decodeType((f as { name: string; type: FieldType }).type, reader, typeRegistry, `${path}.${(f as { name: string }).name}`)
        return { name: (f as { name: string }).name, value: v, offset } satisfies DecodedField
      } else {
        // Positional (tuple-style enum variant)
        const v = decodeType(f as FieldType, reader, typeRegistry, `${path}[${i}]`)
        return { name: String(i), value: v, offset } satisfies DecodedField
      }
    })

  return { kind: "enum", variant: variant.name, fields, typeLabel: typeDef.name }
}

// ─── TYPE LABEL HELPER ────────────────────────────────────────────────────────

export function typeLabel(type: FieldType): string {
  switch (type.kind) {
    case "primitive": return type.type
    case "vec":       return `Vec<${typeLabel(type.item)}>`
    case "option":    return `Option<${typeLabel(type.item)}>`
    case "coption":   return `COption<${typeLabel(type.item)}>`
    case "array":     return `[${typeLabel(type.item)}; ${type.len}]`
    case "defined":   return type.name
  }
}

// ─── DISPLAY HELPERS ──────────────────────────────────────────────────────────
// Format decoded values as compact human-readable strings for table cells.

export function formatDecodedValue(value: DecodedValue): string {
  switch (value.kind) {
    case "bool":      return value.value ? "true" : "false"
    case "uint":      return value.value.toLocaleString()
    case "int":       return value.value.toLocaleString()
    case "float":     return value.value.toString()
    case "publicKey": return value.value
    case "string":    return `"${value.value}"`
    case "bytes":
  return `[${Array.from(value.value)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ")}]`
    case "vec":       return `[${value.items.length} items]`
    case "array":     return `[${value.items.length} items]`
    case "option":    return value.inner === null ? "None" : `Some(${formatDecodedValue(value.inner.value)})`
    case "struct":    return `{ ${value.fields.length} fields }`
    case "enum":      return value.variant
    case "unknown":   return "(unknown type)"
  }
}

// ─── HEX / BASE64 UTILITIES ───────────────────────────────────────────────────

export function toHex(data: Uint8Array): string {
  return Array.from(data)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

export function toHexSpaced(data: Uint8Array, groupSize = 16): string {
  const bytes = Array.from(data).map((b) => b.toString(16).padStart(2, "0"))
  const lines: string[] = []
  for (let i = 0; i < bytes.length; i += groupSize) {
    const chunk = bytes.slice(i, i + groupSize)
    const hex = chunk.join(" ")
    const ascii = chunk
      .map((h) => {
        const code = parseInt(h, 16)
        return code >= 32 && code < 127 ? String.fromCharCode(code) : "."
      })
      .join("")
    const offsetStr = i.toString(16).padStart(6, "0")
    lines.push(`${offsetStr}  ${hex.padEnd(groupSize * 3 - 1)}  ${ascii}`)
  }
  return lines.join("\n")
}

export function toBase64(data: Uint8Array): string {
  let binary = ""
  const len = data.byteLength
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(data[i] ?? 0)
  }
  return btoa(binary)
}