/**
 * errorTranslator.ts
 *
 * Translates raw simulation errors into human-readable messages.
 *
 * Resolution order:
 *   1. IDL error registry (program-specific errors the IDL declares)
 *   2. Anchor framework errors (constraint violations, account checks, etc.)
 *   3. Solana native instruction errors (InstructionError variants)
 *   4. Log context — last Program log: line before failure (often has constraint name)
 *   5. Raw fallback if nothing matches
 */

import { type ProgramSchema } from "../types/idl"

// ─── RESULT ───────────────────────────────────────────────────────────────────

export interface TranslatedError {
  /** Short machine-style label, e.g. "ConstraintOwner" */
  code: string
  /** Full human-readable message */
  message: string
  /** Which instruction (0-based) caused this */
  instructionIndex: number | null
  /** Which program produced the error */
  programId: string | null
  /** The last Program log: line before failure, if available */
  logContext: string | null
  /** Underlying raw error string for advanced users */
  rawError: string
  /** Error source */
  source: "idl" | "anchor" | "solana" | "unknown"
}

// ─── ANCHOR BUILT-IN ERROR TABLE ─────────────────────────────────────────────
// Source: https://github.com/coral-xyz/anchor/blob/master/lang/src/error.rs
// Error codes 100–199 are constraint errors. 1000+ are misc framework errors.

const ANCHOR_ERRORS: Record<number, { code: string; message: string }> = {
  // Instruction errors
  100: { code: "InstructionMissing",         message: "8 byte instruction identifier not provided" },
  101: { code: "InstructionFallbackNotFound", message: "Fallback functions are not supported" },
  102: { code: "InstructionDidNotDeserialize", message: "The program could not deserialize the given instruction" },
  103: { code: "InstructionDidNotSerialize",   message: "The program could not serialize the given instruction" },

  // IDL errors
  1000: { code: "IdlInstructionStub",      message: "The program was compiled without idl instructions" },
  1001: { code: "IdlInstructionInvalidProgram", message: "The transaction was given an invalid program for the IDL instruction" },
  1002: { code: "IdlAccountNotEmpty",      message: "IDL account must be empty in order to resize" },

  // Event errors
  1500: { code: "EventInstructionStub",    message: "The program was compiled without `event-cpi` feature" },

  // Constraint errors
  2000: { code: "ConstraintMut",           message: "A mut constraint was violated — account must be mutable" },
  2001: { code: "ConstraintHasOne",        message: "A has_one constraint was violated — field ownership mismatch" },
  2002: { code: "ConstraintSigner",        message: "A signer constraint was violated — account did not sign" },
  2003: { code: "ConstraintRaw",           message: "A raw constraint was violated" },
  2004: { code: "ConstraintOwner",         message: "An owner constraint was violated — account owner mismatch" },
  2005: { code: "ConstraintRentExempt",    message: "A rent exemption constraint was violated" },
  2006: { code: "ConstraintSeeds",         message: "A seeds constraint was violated — PDA mismatch" },
  2007: { code: "ConstraintExecutable",    message: "An executable constraint was violated" },
  2008: { code: "ConstraintState",         message: "A state constraint was violated" },
  2009: { code: "ConstraintAssociated",    message: "An associated constraint was violated" },
  2010: { code: "ConstraintAssociatedInit", message: "An associated init constraint was violated" },
  2011: { code: "ConstraintClose",         message: "A close constraint was violated" },
  2012: { code: "ConstraintAddress",       message: "An address constraint was violated — expected a specific address" },
  2013: { code: "ConstraintZero",          message: "Expected account discriminator to be zero" },
  2014: { code: "ConstraintTokenMint",     message: "A token mint constraint was violated" },
  2015: { code: "ConstraintTokenOwner",    message: "A token owner constraint was violated" },
  2016: { code: "ConstraintMintMintAuthority", message: "Mint mintAuthority constraint violated" },
  2017: { code: "ConstraintMintFreezeAuthority", message: "Mint freezeAuthority constraint violated" },
  2018: { code: "ConstraintMintDecimals",  message: "Mint decimals constraint violated" },
  2019: { code: "ConstraintSpace",         message: "A space constraint was violated" },
  2020: { code: "ConstraintAccountIsNone", message: "A required account is None but was expected to be Some" },
  2021: { code: "ConstraintTokenTokenProgram", message: "A token program constraint was violated" },
  2022: { code: "ConstraintMintTokenProgram", message: "A mint token program constraint was violated" },
  2023: { code: "ConstraintGroupPointerExtension", message: "A group pointer extension constraint was violated" },
  2024: { code: "ConstraintGroupPointerExtensionAuthority", message: "Group pointer extension authority constraint violated" },
  2025: { code: "ConstraintGroupExtension", message: "A group extension constraint was violated" },
  2026: { code: "ConstraintMemberPointerExtension", message: "A member pointer extension constraint was violated" },
  2027: { code: "ConstraintMemberPointerExtensionAuthority", message: "Member pointer extension authority constraint violated" },
  2028: { code: "ConstraintMemberExtension", message: "A member extension constraint was violated" },

  // Account errors
  3000: { code: "AccountDiscriminatorAlreadySet", message: "The account discriminator was already set on this account" },
  3001: { code: "AccountDiscriminatorNotFound", message: "No 8-byte discriminator was found on the account" },
  3002: { code: "AccountDiscriminatorMismatch", message: "8-byte discriminator did not match — wrong account type" },
  3003: { code: "AccountDidNotDeserialize",  message: "Failed to deserialize the account" },
  3004: { code: "AccountDidNotSerialize",    message: "Failed to serialize the account" },
  3005: { code: "AccountNotEnoughKeys",      message: "Not enough account keys given to the instruction" },
  3006: { code: "AccountNotMutable",         message: "The given account is not mutable" },
  3007: { code: "AccountOwnedByWrongProgram", message: "The given account is owned by a different program" },
  3008: { code: "InvalidProgramId",          message: "Program ID was not as expected" },
  3009: { code: "InvalidProgramExecutable",  message: "Program account is not executable" },
  3010: { code: "AccountNotSigner",          message: "The given account did not sign" },
  3011: { code: "AccountNotSystemOwned",     message: "The given account is not owned by the system program" },
  3012: { code: "AccountNotInitialized",     message: "The program expected this account to be already initialized" },
  3013: { code: "AccountNotProgramData",     message: "The given account is not a program data account" },
  3014: { code: "AccountNotAssociatedTokenAccount", message: "The given account is not the expected ATA" },
  3015: { code: "AccountSysvarMismatch",     message: "The given sysvar account address does not match" },
  3016: { code: "AccountReallocExceedsLimit", message: "The account reallocation exceeds the limit" },
  3017: { code: "AccountDuplicateReallocs",  message: "The account was realloc'ed more than once in a single instruction" },

  // Misc framework errors
  4000: { code: "DeclareIdMismatch",         message: "The declared program id does not match the actual program id" },
  4100: { code: "Deprecated",               message: "The API being used is deprecated and should no longer be used" },
}

// ─── SOLANA NATIVE ERRORS ─────────────────────────────────────────────────────
// These appear in the err field as { InstructionError: [index, { Custom: code }] }
// or as string variants.

const SOLANA_INSTRUCTION_ERRORS: Record<string, string> = {
  GenericError:         "Generic error",
  InvalidArgument:      "Invalid argument",
  InvalidInstructionData: "Invalid instruction data",
  InvalidAccountData:   "Invalid account data",
  AccountDataTooSmall:  "Account data too small",
  InsufficientFunds:    "Insufficient funds",
  IncorrectProgramId:   "Incorrect program ID",
  MissingRequiredSignature: "Missing required signature",
  AccountAlreadyInitialized: "Account already initialized",
  UninitializedAccount: "Uninitialized account",
  UnbalancedInstruction: "Unbalanced instruction (lamport change without approval)",
  ModifiedProgramId:    "Modified program ID",
  ExternalAccountLamportSpend: "External account lamport spend",
  ExternalAccountDataModified: "External account data modified",
  ReadonlyLamportChange: "Readonly account lamport change",
  ReadonlyDataModified: "Readonly account data modified",
  DuplicateAccountIndex: "Duplicate account index",
  ExecutableModified:   "Executable flag modified",
  RentEpochModified:    "Rent epoch modified",
  NotEnoughAccountKeys: "Not enough account keys",
  AccountDataSizeChanged: "Account data size changed without realloc",
  AccountNotExecutable:  "Account is not executable",
  AccountBorrowFailed:   "Account borrow failed",
  AccountBorrowOutstanding: "Outstanding account borrow",
  DuplicateAccountOutOfSync: "Duplicate account out of sync",
  Custom:               "Custom program error",
  InvalidError:         "Invalid error",
  ExecutableDataModified: "Executable data modified",
  ExecutableLamportChange: "Executable lamport change",
  ExecutableAccountNotRentExempt: "Executable account not rent exempt",
  UnsupportedProgramId:  "Unsupported program ID",
  CallDepth:             "Call depth exceeded",
  MissingAccount:        "Missing account",
  ReentrancyNotAllowed:  "Reentrancy not allowed",
  MaxSeedLengthExceeded: "Max seed length exceeded",
  InvalidSeeds:          "Invalid seeds",
  InvalidRealloc:        "Invalid realloc",
  ComputationalBudgetExceeded: "Computational budget exceeded",
  PrivilegeEscalation:   "Privilege escalation",
  ProgramEnvironmentSetupFailure: "Program environment setup failure",
  ProgramFailedToComplete: "Program failed to complete",
  ProgramFailedToCompile:  "Program failed to compile",
  Immutable:             "Account is immutable",
  IncorrectAuthority:    "Incorrect authority",
  BorshIoError:          "Borsh I/O error",
  AccountNotRentExempt:  "Account not rent exempt",
  InvalidAccountOwner:   "Invalid account owner",
  ArithmeticOverflow:    "Arithmetic overflow",
  UnsupportedSysvar:     "Unsupported sysvar",
  IllegalOwner:          "Illegal owner",
  MaxAccountsDataAllocationsExceeded: "Max accounts data allocations exceeded",
  MaxAccountsExceeded:   "Max accounts exceeded",
  MaxInstructionTraceLengthExceeded: "Max instruction trace length exceeded",
  BuiltinProgramsMustConsumeComputeUnits: "Builtin programs must consume compute units",
}

// ─── LOG CONTEXT EXTRACTOR ────────────────────────────────────────────────────

export function extractLogContext(logs: string[], failingProgramId: string | null): string | null {
  // Find the last "Program log:" line before the failure
  // Strategy: scan for the Program X failed line, then look backward
  let failIdx = -1
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i] ?? ""
    if (line.includes(" failed:") && (failingProgramId === null || line.includes(failingProgramId ?? ""))) {
      failIdx = i
      break
    }
  }

  const searchEnd = failIdx >= 0 ? failIdx : logs.length

  // Work backwards from the failure to find the most recent Program log: line
  for (let i = searchEnd - 1; i >= 0; i--) {
    const line = logs[i] ?? ""
    if (line.startsWith("Program log: ")) {
      return line.replace("Program log: ", "")
    }
  }

  return null
}

// ─── MAIN TRANSLATOR ─────────────────────────────────────────────────────────

export function translateError(
  /** The raw err field from SimulatedTransactionResponse */
  rawErr: unknown,
  logs: string[],
  schema: ProgramSchema
): TranslatedError {
  const rawErrorStr = JSON.stringify(rawErr)

  // ── Parse the error structure ─────────────────────────────────────────────
  // Solana errors typically look like:
  //   { InstructionError: [index, errorVariant] }
  // where errorVariant is either a string or { Custom: number }

  let instructionIndex: number | null = null
  let customCode: number | null = null
  let nativeErrorKey: string | null = null
  let programId: string | null = null

  if (rawErr !== null && typeof rawErr === "object") {
    const errObj = rawErr as Record<string, unknown>
    const ixError = errObj["InstructionError"]

    if (Array.isArray(ixError) && ixError.length === 2) {
      instructionIndex = typeof ixError[0] === "number" ? ixError[0] : null

      const variant = ixError[1]
      if (typeof variant === "string") {
        nativeErrorKey = variant
      } else if (variant !== null && typeof variant === "object") {
        const variantObj = variant as Record<string, unknown>
        if (typeof variantObj["Custom"] === "number") {
          customCode = variantObj["Custom"] as number
        } else {
          // e.g. { BorshIoError: "..." }
          nativeErrorKey = Object.keys(variantObj)[0] ?? null
        }
      }
    }
  }

  // Extract which program caused the failure from logs
  if (instructionIndex !== null) {
    // Find the invoke line for this instruction index (depth=1)
    let depth1Count = 0
    for (const line of logs) {
      const m = /^Program (\S+) invoke \[1\]$/.exec(line)
      if (m !== null) {
        if (depth1Count === instructionIndex) {
          programId = m[1] ?? null
          break
        }
        depth1Count++
      }
    }
  }

  const logContext = extractLogContext(logs, programId)

  // ── Resolution order ──────────────────────────────────────────────────────

  // 1. IDL custom error
  if (customCode !== null) {
    const idlError = schema.errorRegistry.get(customCode)
    if (idlError !== undefined) {
      return {
        code: idlError.name,
        message: idlError.message,
        instructionIndex,
        programId,
        logContext,
        rawError: rawErrorStr,
        source: "idl",
      }
    }

    // 2. Anchor framework error (also uses Custom code space)
    const anchorError = ANCHOR_ERRORS[customCode]
    if (anchorError !== undefined) {
      return {
        code: anchorError.code,
        message: anchorError.message,
        instructionIndex,
        programId,
        logContext,
        rawError: rawErrorStr,
        source: "anchor",
      }
    }

    // Custom code not found in either table
    return {
      code: `Custom(${customCode})`,
      message: `Program returned custom error code ${customCode}. Check the program's error definitions.`,
      instructionIndex,
      programId,
      logContext,
      rawError: rawErrorStr,
      source: "unknown",
    }
  }

  // 3. Solana native error
  if (nativeErrorKey !== null) {
    const nativeMsg = SOLANA_INSTRUCTION_ERRORS[nativeErrorKey]
    return {
      code: nativeErrorKey,
      message: nativeMsg ?? `Solana instruction error: ${nativeErrorKey}`,
      instructionIndex,
      programId,
      logContext,
      rawError: rawErrorStr,
      source: "solana",
    }
  }

  // 4. String error (e.g., "BlockhashNotFound")
  if (typeof rawErr === "string") {
    const nativeMsg = SOLANA_INSTRUCTION_ERRORS[rawErr]
    return {
      code: rawErr,
      message: nativeMsg ?? rawErr,
      instructionIndex: null,
      programId: null,
      logContext,
      rawError: rawErrorStr,
      source: "solana",
    }
  }

  // 5. Raw fallback
  return {
    code: "UnknownError",
    message: "The transaction failed with an unrecognised error. See raw error for details.",
    instructionIndex,
    programId,
    logContext,
    rawError: rawErrorStr,
    source: "unknown",
  }
}