import {
    type RawIdl,
    type RawIdlType,
    type RawIdlSeed,
    type RawIdlTypeDefTy,
    type FieldType,
    type PrimitiveKind,
    type SeedDef,
    type PdaDef,
    type AccountSlot,
    type ArgumentField,
    type InstructionDefinition,
    type TypeDefinition,
    type AccountDefinition,
    type ProgramSchema,
  } from "../types/idl"
  
  // ─── DISCRIMINATOR COMPUTATION ────────────────────────────────────────────────
  // Anchor uses sha256("global:<instructionName>")[0..8] for instruction discriminators
  // and sha256("account:<AccountName>")[0..8] for account discriminators.
  // We use the Web Crypto API (available in all modern browsers).
  
  async function sha256(input: string): Promise<Uint8Array> {
    const encoded = new TextEncoder().encode(input)
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded)
    return new Uint8Array(hashBuffer)
  }
  
  async function instructionDiscriminator(name: string): Promise<Uint8Array> {
    const hash = await sha256(`global:${name}`)
    return hash.slice(0, 8)
  }
  
  async function accountDiscriminator(name: string): Promise<Uint8Array> {
    const hash = await sha256(`account:${name}`)
    return hash.slice(0, 8)
  }
  
  // ─── TYPE NORMALIZER ──────────────────────────────────────────────────────────
  // Converts the messy union of raw IDL type shapes into our clean FieldType.
  
  function normalizeType(raw: RawIdlType): FieldType {
    if (typeof raw === "string") {
      return { kind: "primitive", type: raw as PrimitiveKind }
    }
    if ("vec" in raw) {
      return { kind: "vec", item: normalizeType(raw.vec) }
    }
    if ("option" in raw) {
      return { kind: "option", item: normalizeType(raw.option) }
    }
    if ("coption" in raw) {
      return { kind: "coption", item: normalizeType(raw.coption) }
    }
    if ("array" in raw) {
      return { kind: "array", item: normalizeType(raw.array[0]), len: raw.array[1] }
    }
    if ("defined" in raw) {
      return { kind: "defined", name: raw.defined }
    }
    // Fallback — should never reach here with valid IDL
    return { kind: "primitive", type: "bytes" }
  }
  
  // ─── SEED NORMALIZER ─────────────────────────────────────────────────────────
  
  function normalizeSeed(raw: RawIdlSeed): SeedDef {
    const base: SeedDef = { kind: raw.kind }
    if (raw.path !== undefined) base.path = raw.path
    if (raw.value !== undefined) base.constBytes = raw.value
    if (raw.type !== undefined) base.type = normalizeType(raw.type)
    return base
  }
  
  // ─── PDA NORMALIZER ──────────────────────────────────────────────────────────
  
  function normalizePda(raw: NonNullable<import("../types/idl").RawIdlAccount["pda"]>): PdaDef {
    return {
      seeds: raw.seeds.map(normalizeSeed),
      programId: raw.programId !== undefined ? normalizeSeed(raw.programId) : undefined,
    }
  }
  
  // ─── TYPE DEFINITION NORMALIZER ──────────────────────────────────────────────
  
  function normalizeTypeDef(
    name: string,
    raw: RawIdlTypeDefTy,
    docs: string[]
  ): TypeDefinition {
    if (raw.kind === "struct") {
      return {
        name,
        docs,
        shape: {
          kind: "struct",
          fields: raw.fields.map((f) => ({
            name: f.name,
            type: normalizeType(f.type),
            docs: f.docs ?? [],
          })),
        },
      }
    }
  
    // enum
    return {
      name,
      docs,
      shape: {
        kind: "enum",
        variants: raw.variants.map((v) => {
          const fields = (v.fields ?? []).map((f) => {
            if (typeof f === "object" && f !== null && "name" in f) {
              return { name: (f as { name: string; type: RawIdlType }).name, type: normalizeType((f as { name: string; type: RawIdlType }).type) }
            }
            return normalizeType(f as RawIdlType)
          })
          return { name: v.name, fields }
        }),
      },
    }
  }
  
  // ─── VALIDATION ───────────────────────────────────────────────────────────────
  
  export class IdlParseError extends Error {
    constructor(message: string) {
      super(message)
      this.name = "IdlParseError"
    }
  }
  
  function assertRawIdl(value: unknown): asserts value is RawIdl {
    if (typeof value !== "object" || value === null) {
      throw new IdlParseError("IDL must be a JSON object")
    }
    const obj = value as Record<string, unknown>
    if (!Array.isArray(obj["instructions"])) {
      throw new IdlParseError('IDL must have an "instructions" array')
    }
    if (typeof obj["name"] !== "string") {
      throw new IdlParseError('IDL must have a "name" string field')
    }
  }
  
  // ─── MAIN PARSER ─────────────────────────────────────────────────────────────
  
  export async function parseIdl(raw: unknown, programAddress?: string): Promise<ProgramSchema> {
    assertRawIdl(raw)
  
    // ── Instructions ────────────────────────────────────────────────────────────
    const instructions: InstructionDefinition[] = await Promise.all(
      raw.instructions.map(async (ix) => {
        const discriminator = await instructionDiscriminator(ix.name)
  
        const accounts: AccountSlot[] = ix.accounts.map((acc) => ({
          name: acc.name,
          isMut: acc.isMut,
          isSigner: acc.isSigner,
          isOptional: acc.isOptional ?? false,
          pda: acc.pda != null ? normalizePda(acc.pda) : null,
          docs: acc.docs ?? [],
        }))
  
        const args: ArgumentField[] = ix.args.map((arg) => ({
          name: arg.name,
          type: normalizeType(arg.type),
          docs: [],
        }))
  
        return {
          name: ix.name,
          discriminator,
          accounts,
          args,
          docs: ix.docs ?? [],
          returns: ix.returns != null ? normalizeType(ix.returns) : null,
        } satisfies InstructionDefinition
      })
    )
  
    // ── Type registry ────────────────────────────────────────────────────────────
    const typeRegistry = new Map<string, TypeDefinition>()
    for (const td of raw.types ?? []) {
      typeRegistry.set(td.name, normalizeTypeDef(td.name, td.type, td.docs ?? []))
    }
  
    // ── Account registry ─────────────────────────────────────────────────────────
    const accountRegistry = new Map<string, AccountDefinition>()
    await Promise.all(
      (raw.accounts ?? []).map(async (acc) => {
        const discriminator = await accountDiscriminator(acc.name)
        accountRegistry.set(acc.name, {
          name: acc.name,
          discriminator,
          fields: acc.type.fields.map((f) => ({
            name: f.name,
            type: normalizeType(f.type),
            docs: f.docs ?? [],
          })),
          docs: acc.docs ?? [],
        })
      })
    )
  
    // ── Error registry ────────────────────────────────────────────────────────────
    const errorRegistry = new Map<number, { name: string; message: string }>()
    for (const err of raw.errors ?? []) {
      errorRegistry.set(err.code, {
        name: err.name,
        message: err.msg ?? err.name,
      })
    }
  
    return {
      address: programAddress ?? raw.metadata?.address ?? null,
      name: raw.name,
      version: raw.version,
      docs: raw.docs ?? [],
      instructions,
      typeRegistry,
      accountRegistry,
      errorRegistry,
      raw,
    }
  }
  
  // ─── JSON PARSING HELPER ─────────────────────────────────────────────────────
  
  export function parseIdlJson(jsonText: string): unknown {
    try {
      return JSON.parse(jsonText) as unknown
    } catch {
      throw new IdlParseError("File is not valid JSON")
    }
  }