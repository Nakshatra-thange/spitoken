// ─── RAW IDL TYPES (what Anchor gives us) ────────────────────────────────────
// These mirror the exact JSON structure of an Anchor IDL file.
// We don't control this shape — Anchor does.

export type RawIdlType =
  | "bool"
  | "u8" | "i8"
  | "u16" | "i16"
  | "u32" | "i32"
  | "u64" | "i64"
  | "u128" | "i128"
  | "f32" | "f64"
  | "bytes"
  | "string"
  | "publicKey"
  | { vec: RawIdlType }
  | { option: RawIdlType }
  | { coption: RawIdlType }
  | { array: [RawIdlType, number] }
  | { defined: string }

export interface RawIdlSeed {
  kind: "const" | "arg" | "account"
  type?: RawIdlType
  path?: string
  value?: number[]
}

export interface RawIdlPda {
  seeds: RawIdlSeed[]
  programId?: RawIdlSeed
}

export interface RawIdlAccount {
  name: string
  isMut: boolean
  isSigner: boolean
  isOptional?: boolean
  pda?: RawIdlPda
  docs?: string[]
}

export interface RawIdlArg {
  name: string
  type: RawIdlType
}

export interface RawIdlInstruction {
  name: string
  docs?: string[]
  accounts: RawIdlAccount[]
  args: RawIdlArg[]
  returns?: RawIdlType
}

export interface RawIdlField {
  name: string
  type: RawIdlType
  docs?: string[]
}

export type RawIdlTypeDefTy =
  | { kind: "struct"; fields: RawIdlField[] }
  | { kind: "enum"; variants: { name: string; fields?: RawIdlField[] | RawIdlType[] }[] }

export interface RawIdlTypeDef {
  name: string
  type: RawIdlTypeDefTy
  docs?: string[]
}

export interface RawIdlErrorDef {
  code: number
  name: string
  msg?: string
}

export interface RawIdlAccountDef {
  name: string
  type: { kind: "struct"; fields: RawIdlField[] }
  docs?: string[]
}

export interface RawIdl {
  version: string
  name: string
  docs?: string[]
  instructions: RawIdlInstruction[]
  accounts?: RawIdlAccountDef[]
  types?: RawIdlTypeDef[]
  errors?: RawIdlErrorDef[]
  metadata?: {
    address?: string
    origin?: string
    [key: string]: unknown
  }
}

// ─── INTERNAL SCHEMA TYPES (what our app uses) ───────────────────────────────
// After parsing, everything lives in these cleaner, richer structures.

export type PrimitiveKind =
  | "bool"
  | "u8" | "i8"
  | "u16" | "i16"
  | "u32" | "i32"
  | "u64" | "i64"
  | "u128" | "i128"
  | "f32" | "f64"
  | "bytes"
  | "string"
  | "publicKey"

export type FieldType =
  | { kind: "primitive"; type: PrimitiveKind }
  | { kind: "vec"; item: FieldType }
  | { kind: "option"; item: FieldType }
  | { kind: "coption"; item: FieldType }
  | { kind: "array"; item: FieldType; len: number }
  | { kind: "defined"; name: string }

export interface SeedDef {
  kind: "const" | "arg" | "account"
  /** For const seeds: the literal bytes */
  constBytes?: number[]
  /** For arg/account seeds: the path into args or accounts */
  path?: string
  type?: FieldType
}

export interface PdaDef {
  seeds: SeedDef[]
  programId?: SeedDef
}

export interface AccountSlot {
  name: string
  isMut: boolean
  isSigner: boolean
  isOptional: boolean
  pda: PdaDef | null
  docs: string[]
}

export interface ArgumentField {
  name: string
  type: FieldType
  docs: string[]
}

export interface InstructionDefinition {
  name: string
  /** 8-byte discriminator = sha256("global:<name>")[0..8] */
  discriminator: Uint8Array
  accounts: AccountSlot[]
  args: ArgumentField[]
  docs: string[]
  returns: FieldType | null
}

export interface TypeDefinition {
  name: string
  shape:
    | { kind: "struct"; fields: { name: string; type: FieldType; docs: string[] }[] }
    | { kind: "enum"; variants: { name: string; fields: ({ name: string; type: FieldType } | FieldType)[] }[] }
  docs: string[]
}

export interface AccountDefinition {
  name: string
  /** sha256("account:<name>")[0..8] */
  discriminator: Uint8Array
  fields: { name: string; type: FieldType; docs: string[] }[]
  docs: string[]
}

export interface ProgramSchema {
  /** The program's on-chain address, if known */
  address: string | null
  name: string
  version: string
  docs: string[]
  instructions: InstructionDefinition[]
  /** map: type name → definition */
  typeRegistry: Map<string, TypeDefinition>
  /** map: account name → definition */
  accountRegistry: Map<string, AccountDefinition>
  /** map: error code → { name, message } */
  errorRegistry: Map<number, { name: string; message: string }>
  /** The original raw IDL, kept for reference */
  raw: RawIdl
}