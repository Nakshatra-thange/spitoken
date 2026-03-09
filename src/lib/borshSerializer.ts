/**
 * borshSerializer.ts
 *
 * Serializes ArgValues into Borsh-encoded bytes for transaction data.
 * This is the write-side counterpart to borshDecoder.ts (which reads).
 *
 * An Anchor instruction's data layout is:
 *   [0..8]   8-byte discriminator  (sha256("global:<name>")[0..8])
 *   [8..]    Borsh-serialized arguments, in IDL order
 *
 * All integers are little-endian. Strings are length-prefixed (u32 LE).
 * Vecs are length-prefixed (u32 LE). Options have a 1-byte discriminant.
 * COptions have a 4-byte discriminant.
 *
 * We write into a resizable Uint8Array via a BorshWriter class that
 * doubles capacity on overflow — simpler than pre-computing size.
 */

import { PublicKey } from "@solana/web3.js"
import { type FieldType, type TypeDefinition } from "../types/idl"
import { type ArgValue } from "../types/builder"

// ─── WRITER ───────────────────────────────────────────────────────────────────

class BorshWriter {
  private buf: Uint8Array
  private pos: number

  constructor(initialCapacity = 256) {
    this.buf = new Uint8Array(initialCapacity)
    this.pos = 0
  }

  private ensure(n: number): void {
    const needed = this.pos + n
    if (needed <= this.buf.length) return
    let newCap = this.buf.length
    while (newCap < needed) newCap *= 2
    const next = new Uint8Array(newCap)
    next.set(this.buf)
    this.buf = next
  }

  writeU8(v: number): void {
    this.ensure(1)
    this.buf[this.pos++] = v & 0xff
  }

  writeU16(v: number): void {
    this.ensure(2)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2)
    view.setUint16(0, v, true)
    this.pos += 2
  }

  writeU32(v: number): void {
    this.ensure(4)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4)
    view.setUint32(0, v, true)
    this.pos += 4
  }

  writeU64(v: bigint): void {
    this.ensure(8)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8)
    view.setBigUint64(0, v, true)
    this.pos += 8
  }

  writeU128(v: bigint): void {
    // lo word first, then hi word
    this.writeU64(v & 0xffff_ffff_ffff_ffffn)
    this.writeU64(v >> 64n)
  }

  writeI8(v: bigint): void {
    this.ensure(1)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 1)
    view.setInt8(0, Number(v))
    this.pos += 1
  }

  writeI16(v: bigint): void {
    this.ensure(2)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 2)
    view.setInt16(0, Number(v), true)
    this.pos += 2
  }

  writeI32(v: bigint): void {
    this.ensure(4)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4)
    view.setInt32(0, Number(v), true)
    this.pos += 4
  }

  writeI64(v: bigint): void {
    this.ensure(8)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8)
    view.setBigInt64(0, v, true)
    this.pos += 8
  }

  writeI128(v: bigint): void {
    // Encode as two u64s: low word (signed interpretation), high word
    const lo = v < 0n
      ? (v & 0xffff_ffff_ffff_ffffn)
      : v & 0xffff_ffff_ffff_ffffn
    const hi = v < 0n
      ? ((v >> 64n) | 0xffff_ffff_ffff_ffff_0000_0000_0000_0000n) >> 0n
      : v >> 64n
    this.writeU64(lo)
    this.writeI64(hi)
  }

  writeF32(v: number): void {
    this.ensure(4)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4)
    view.setFloat32(0, v, true)
    this.pos += 4
  }

  writeF64(v: number): void {
    this.ensure(8)
    const view = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8)
    view.setFloat64(0, v, true)
    this.pos += 8
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensure(bytes.length)
    this.buf.set(bytes, this.pos)
    this.pos += bytes.length
  }

  /** Borsh string: u32 length + UTF-8 bytes */
  writeString(s: string): void {
    const encoded = new TextEncoder().encode(s)
    this.writeU32(encoded.length)
    this.writeBytes(encoded)
  }

  /** Borsh bytes (Vec<u8>): u32 length + raw bytes */
  writeByteVec(bytes: Uint8Array): void {
    this.writeU32(bytes.length)
    this.writeBytes(bytes)
  }

  writePublicKey(address: string): void {
    try {
      const pk = new PublicKey(address.trim())
      this.writeBytes(pk.toBytes())
    } catch {
      throw new BorshSerializeError(`Invalid public key: "${address}"`, "publicKey")
    }
  }

  result(): Uint8Array {
    return this.buf.slice(0, this.pos)
  }
}

// ─── SERIALIZE ERROR ─────────────────────────────────────────────────────────

export class BorshSerializeError extends Error {
  constructor(message: string, public readonly fieldPath: string) {
    super(`[${fieldPath}] ${message}`)
    this.name = "BorshSerializeError"
  }
}

// ─── MAIN SERIALIZER ─────────────────────────────────────────────────────────

export function serializeInstructionData(
  discriminator: Uint8Array,
  args: { name: string; type: FieldType }[],
  argValues: Record<string, ArgValue>,
  typeRegistry: Map<string, TypeDefinition>
): Uint8Array {
  const writer = new BorshWriter(512)

  // 1. Discriminator (always 8 bytes)
  writer.writeBytes(discriminator)

  // 2. Arguments in IDL order
  for (const arg of args) {
    const value = argValues[arg.name]
    if (value === undefined) {
      throw new BorshSerializeError(`Missing value for argument "${arg.name}"`, arg.name)
    }
    serializeValue(writer, value, arg.type, typeRegistry, arg.name)
  }

  return writer.result()
}

function serializeValue(
  writer: BorshWriter,
  value: ArgValue,
  type: FieldType,
  typeRegistry: Map<string, TypeDefinition>,
  path: string
): void {
  switch (type.kind) {
    case "primitive":
      serializePrimitive(writer, value, type.type, path)
      return

    case "vec": {
      if (value.kind !== "vec") throw new BorshSerializeError("Expected vec value", path)
      writer.writeU32(value.items.length)
      value.items.forEach((item, i) =>
        serializeValue(writer, item, type.item, typeRegistry, `${path}[${i}]`)
      )
      return
    }

    case "array": {
      if (value.kind !== "array") throw new BorshSerializeError("Expected array value", path)
      if (value.items.length !== type.len) {
        throw new BorshSerializeError(
          `Array needs ${type.len} items, got ${value.items.length}`,
          path
        )
      }
      value.items.forEach((item, i) =>
        serializeValue(writer, item, type.item, typeRegistry, `${path}[${i}]`)
      )
      return
    }

    case "option": {
      if (value.kind !== "option") throw new BorshSerializeError("Expected option value", path)
      if (value.inner === null) {
        writer.writeU8(0)
      } else {
        writer.writeU8(1)
        serializeValue(writer, value.inner, type.item, typeRegistry, path)
      }
      return
    }

    case "coption": {
      if (value.kind !== "option") throw new BorshSerializeError("Expected coption value", path)
      if (value.inner === null) {
        writer.writeU32(0)
      } else {
        writer.writeU32(1)
        serializeValue(writer, value.inner, type.item, typeRegistry, path)
      }
      return
    }

    case "defined": {
      const typeDef = typeRegistry.get(type.name)
      if (typeDef === undefined) {
        throw new BorshSerializeError(`Unknown type: ${type.name}`, path)
      }

      if (typeDef.shape.kind === "struct") {
        if (value.kind !== "struct") throw new BorshSerializeError("Expected struct value", path)
        for (const field of typeDef.shape.fields) {
          const fv = value.fields[field.name]
          if (fv === undefined) {
            throw new BorshSerializeError(`Missing struct field: ${field.name}`, `${path}.${field.name}`)
          }
          serializeValue(writer, fv, field.type, typeRegistry, `${path}.${field.name}`)
        }
        return
      }

      // enum: u8 variant index + variant fields
      if (value.kind !== "enum") throw new BorshSerializeError("Expected enum value", path)
      const variantIndex = typeDef.shape.variants.findIndex((v) => v.name === value.variant)
      if (variantIndex < 0) {
        throw new BorshSerializeError(`Unknown variant: ${value.variant}`, path)
      }
      writer.writeU8(variantIndex)
      const variant = typeDef.shape.variants[variantIndex]
      if (variant === undefined) return

      variant.fields.forEach((f, i) => {
        if ("name" in f && "type" in f) {
          const nf = f as { name: string; type: FieldType }
          const fv = value.fields[nf.name]
          if (fv === undefined) return
          serializeValue(writer, fv, nf.type, typeRegistry, `${path}.${nf.name}`)
        } else {
          const fv = value.fields[String(i)]
          if (fv === undefined) return
          serializeValue(writer, fv, f as FieldType, typeRegistry, `${path}[${i}]`)
        }
      })
      return
    }
  }
}

function serializePrimitive(
  writer: BorshWriter,
  value: ArgValue,
  type: import("../types/idl").PrimitiveKind,
  path: string
): void {
  if (type === "bool") {
    const v = value.kind === "bool" ? value.value : value.kind === "primitive" && value.raw === "true"
    writer.writeU8(v ? 1 : 0)
    return
  }

  if (type === "publicKey") {
    const raw = value.kind === "primitive" ? value.raw : ""
    writer.writePublicKey(raw)
    return
  }

  if (type === "string") {
    const raw = value.kind === "primitive" ? value.raw : ""
    writer.writeString(raw)
    return
  }

  if (type === "bytes") {
    const raw = (value.kind === "primitive" ? value.raw : "").replace(/\s/g, "").replace(/^0x/i, "")
    const bytes = new Uint8Array(raw.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(raw.slice(i * 2, i * 2 + 2), 16)
    }
    writer.writeByteVec(bytes)
    return
  }

  const raw = value.kind === "primitive" ? value.raw.trim() : ""
  if (raw === "") throw new BorshSerializeError("Empty value", path)

  switch (type) {
    case "u8":  writer.writeU8(parseInt(raw, 10)); return
    case "u16": writer.writeU16(parseInt(raw, 10)); return
    case "u32": writer.writeU32(parseInt(raw, 10)); return
    case "u64": writer.writeU64(BigInt(raw)); return
    case "u128": writer.writeU128(BigInt(raw)); return
    case "i8":  writer.writeI8(BigInt(raw)); return
    case "i16": writer.writeI16(BigInt(raw)); return
    case "i32": writer.writeI32(BigInt(raw)); return
    case "i64": writer.writeI64(BigInt(raw)); return
    case "i128": writer.writeI128(BigInt(raw)); return
    case "f32": writer.writeF32(parseFloat(raw)); return
    case "f64": writer.writeF64(parseFloat(raw)); return
  }
}