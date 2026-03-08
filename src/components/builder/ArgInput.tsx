/**
 * ArgInput.tsx
 *
 * Recursive argument input system.
 * Each component handles one FieldType and renders the appropriate widget.
 * All components use React.ReactNode return types (not JSX.Element).
 *
 * Component tree:
 *   ArgInput           — dispatcher, picks the right sub-component
 *   PrimitiveInput     — text/number/toggle for all primitive types
 *   VecInput           — dynamic list with add/remove
 *   ArrayInput         — fixed-length list
 *   OptionInput        — None toggle + inner value
 *   StructInput        — field group, rendered recursively
 *   EnumInput          — variant dropdown + variant fields
 */

import React, { useCallback, useId } from "react"
import { PublicKey } from "@solana/web3.js"
import { type FieldType, type TypeDefinition } from "../../types/idl"
import { type ArgValue, defaultArgValue } from "../../types/builder"
import { validateArgValue } from "../../lib/argValidator"

// ─── SHARED PROPS ─────────────────────────────────────────────────────────────

interface ArgInputProps {
  type: FieldType
  value: ArgValue
  onChange: (v: ArgValue) => void
  typeRegistry: Map<string, TypeDefinition>
  label?: string
  depth?: number
  disabled?: boolean
}

// ─── TYPE LABEL ───────────────────────────────────────────────────────────────

function typeLabelStr(type: FieldType): string {
  switch (type.kind) {
    case "primitive": return type.type
    case "vec":       return `Vec<${typeLabelStr(type.item)}>`
    case "option":    return `Option<${typeLabelStr(type.item)}>`
    case "coption":   return `COption<${typeLabelStr(type.item)}>`
    case "array":     return `[${typeLabelStr(type.item)}; ${type.len}]`
    case "defined":   return type.name
  }
}

// ─── VALIDATION INDICATOR ─────────────────────────────────────────────────────

function ValidationDot({ valid, msg }: { valid: boolean; msg: string | null }): React.ReactNode {
  if (valid) return null
  if (msg === null) return null
  return (
    <span className="arg-error" role="alert" title={msg}>
      {msg}
    </span>
  )
}

// ─── PRIMITIVE INPUT ──────────────────────────────────────────────────────────

function PrimitiveInput({
  type,
  value,
  onChange,
  label,
  disabled,
}: {
  type: import("../../types/idl").PrimitiveKind
  value: ArgValue
  onChange: (v: ArgValue) => void
  label?: string
  disabled?: boolean
}): React.ReactNode {
  const id = useId()

  // Bool → toggle
  if (type === "bool") {
    const checked = value.kind === "bool" ? value.value : false
    return (
      <div className="arg-field">
        {label !== undefined && (
          <label htmlFor={id} className="arg-label">
            {label} <span className="arg-type-badge">bool</span>
          </label>
        )}
        <button
          id={id}
          role="switch"
          aria-checked={checked}
          className={`arg-toggle ${checked ? "arg-toggle--on" : ""}`}
          onClick={() => onChange({ kind: "bool", value: !checked })}
          disabled={disabled}
          type="button"
        >
          <span className="arg-toggle__thumb" />
          <span className="arg-toggle__label">{checked ? "true" : "false"}</span>
        </button>
      </div>
    )
  }

  // PublicKey → text with base58 validation
  if (type === "publicKey") {
    const raw = value.kind === "primitive" ? value.raw : ""
    let addrValid = false
    if (raw.trim() !== "") {
      try { new PublicKey(raw.trim()); addrValid = true } catch { /* invalid */ }
    }

    return (
      <div className="arg-field">
        {label !== undefined && (
          <label htmlFor={id} className="arg-label">
            {label} <span className="arg-type-badge">publicKey</span>
          </label>
        )}
        <div className="arg-input-wrap">
          <input
            id={id}
            className={`arg-input arg-input--mono ${raw !== "" && !addrValid ? "arg-input--error" : ""}`}
            type="text"
            placeholder="base58 address…"
            value={raw}
            onChange={(e) => onChange({ kind: "primitive", raw: e.target.value })}
            disabled={disabled}
            spellCheck={false}
            aria-invalid={raw !== "" && !addrValid}
          />
          {raw !== "" && !addrValid && (
            <span className="arg-error">Invalid public key</span>
          )}
        </div>
      </div>
    )
  }

  // Everything else → text input
  const raw = value.kind === "primitive" ? value.raw : ""
  const placeholder = getPlaceholder(type)

  const validation = raw !== ""
    ? validateArgValue({ kind: "primitive", raw }, { kind: "primitive", type }, new Map())
    : { valid: true, errorMessage: null }

  return (
    <div className="arg-field">
      {label !== undefined && (
        <label htmlFor={id} className="arg-label">
          {label} <span className="arg-type-badge">{type}</span>
        </label>
      )}
      <div className="arg-input-wrap">
        <input
          id={id}
          className={`arg-input ${type === "bytes" ? "arg-input--mono" : ""} ${!validation.valid ? "arg-input--error" : ""}`}
          type="text"
          placeholder={placeholder}
          value={raw}
          onChange={(e) => onChange({ kind: "primitive", raw: e.target.value })}
          disabled={disabled}
          spellCheck={false}
          inputMode={isNumericType(type) ? "numeric" : "text"}
          aria-invalid={!validation.valid}
        />
        <ValidationDot valid={validation.valid} msg={validation.errorMessage} />
      </div>
    </div>
  )
}

function getPlaceholder(type: import("../../types/idl").PrimitiveKind): string {
  switch (type) {
    case "u8": return "0–255"
    case "u16": return "0–65535"
    case "u32": return "0–4294967295"
    case "u64": return "0–18446744073709551615"
    case "u128": return "0–340282366920938…"
    case "i8": return "-128–127"
    case "i16": return "-32768–32767"
    case "i32": return "-2147483648–2147483647"
    case "i64": return "-9223372036854775808–…"
    case "i128": return "-170141183460469…"
    case "f32": case "f64": return "0.0"
    case "bytes": return "deadbeef (hex)"
    case "string": return "text…"
    default: return ""
  }
}

function isNumericType(type: import("../../types/idl").PrimitiveKind): boolean {
  return type !== "string" && type !== "bytes" && type !== "publicKey" && type !== "bool"
}

// ─── VEC INPUT ────────────────────────────────────────────────────────────────

function VecInput({
  type,
  value,
  onChange,
  typeRegistry,
  label,
  disabled,
}: {
  type: FieldType
  value: ArgValue
  onChange: (v: ArgValue) => void
  typeRegistry: Map<string, TypeDefinition>
  label?: string
  disabled?: boolean
}): React.ReactNode {
  const items = value.kind === "vec" ? value.items : []

  const addItem = useCallback(() => {
    const newItem = defaultArgValue({ kind: "primitive", type } as any)
    onChange({ kind: "vec", items: [...items, newItem] })
  }, [items, onChange, type])

  const removeItem = useCallback((idx: number) => {
    onChange({ kind: "vec", items: items.filter((_, i) => i !== idx) })
  }, [items, onChange])

  const updateItem = useCallback((idx: number, v: ArgValue) => {
    const next = [...items]
    next[idx] = v
    onChange({ kind: "vec", items: next })
  }, [items, onChange])

  return (
    <div className="arg-field arg-field--compound">
      {label !== undefined && (
        <div className="arg-compound-header">
          <span className="arg-label">{label}</span>
          <span className="arg-type-badge">Vec&lt;{typeLabelStr(type)}&gt;</span>
          <span className="arg-count">{items.length} items</span>
        </div>
      )}
      <div className="arg-vec-list">
        {items.map((item, i) => (
          <div key={i} className="arg-vec-item">
            <span className="arg-vec-index">{i}</span>
            <div className="arg-vec-content">
              <ArgInput
                type={type}
                value={item}
                onChange={(v) => updateItem(i, v)}
                typeRegistry={typeRegistry}
                disabled={disabled}
              />
            </div>
            <button
              className="arg-vec-remove"
              onClick={() => removeItem(i)}
              disabled={disabled}
              type="button"
              aria-label={`Remove item ${i}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="arg-vec-add"
        onClick={addItem}
        disabled={disabled}
        type="button"
      >
        + Add item
      </button>
    </div>
  )
}

// ─── ARRAY INPUT ──────────────────────────────────────────────────────────────

function ArrayInput({
  type,
  len,
  value,
  onChange,
  typeRegistry,
  label,
  disabled,
}: {
  type: FieldType
  len: number
  value: ArgValue
  onChange: (v: ArgValue) => void
  typeRegistry: Map<string, TypeDefinition>
  label?: string
  disabled?: boolean
}): React.ReactNode {
  const items = value.kind === "array" ? value.items : Array.from({ length: len }, () => defaultArgValue(type))

  const updateItem = useCallback((idx: number, v: ArgValue) => {
    const next = [...items]
    next[idx] = v
    onChange({ kind: "array", items: next })
  }, [items, onChange])

  return (
    <div className="arg-field arg-field--compound">
      {label !== undefined && (
        <div className="arg-compound-header">
          <span className="arg-label">{label}</span>
          <span className="arg-type-badge">[{typeLabelStr(type)}; {len}]</span>
        </div>
      )}
      <div className="arg-vec-list">
        {items.map((item, i) => (
          <div key={i} className="arg-vec-item">
            <span className="arg-vec-index">{i}</span>
            <div className="arg-vec-content">
              <ArgInput
                type={type}
                value={item}
                onChange={(v) => updateItem(i, v)}
                typeRegistry={typeRegistry}
                disabled={disabled}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── OPTION INPUT ─────────────────────────────────────────────────────────────

function OptionInput({
  type,
  value,
  onChange,
  typeRegistry,
  label,
  disabled,
}: {
  type: FieldType
  value: ArgValue
  onChange: (v: ArgValue) => void
  typeRegistry: Map<string, TypeDefinition>
  label?: string
  disabled?: boolean
}): React.ReactNode {
  const isSome = value.kind === "option" && value.inner !== null
  const inner = value.kind === "option" ? value.inner : null

  const toggleSome = useCallback(() => {
    if (isSome) {
      onChange({ kind: "option", inner: null })
    } else {
      onChange({ kind: "option", inner: defaultArgValue(type) })
    }
  }, [isSome, onChange, type])

  const updateInner = useCallback((v: ArgValue) => {
    onChange({ kind: "option", inner: v })
  }, [onChange])

  return (
    <div className="arg-field arg-field--compound">
      {label !== undefined && (
        <div className="arg-compound-header">
          <span className="arg-label">{label}</span>
          <span className="arg-type-badge">Option&lt;{typeLabelStr(type)}&gt;</span>
        </div>
      )}
      <div className="arg-option-toggle-row">
        <button
          className={`arg-toggle arg-toggle--sm ${isSome ? "arg-toggle--on" : ""}`}
          role="switch"
          aria-checked={isSome}
          onClick={toggleSome}
          disabled={disabled}
          type="button"
        >
          <span className="arg-toggle__thumb" />
          <span className="arg-toggle__label">{isSome ? "Some" : "None"}</span>
        </button>
      </div>
      {isSome && inner !== null && (
        <div className="arg-option-inner">
          <ArgInput
            type={type}
            value={inner}
            onChange={updateInner}
            typeRegistry={typeRegistry}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  )
}

// ─── STRUCT INPUT ─────────────────────────────────────────────────────────────

function StructInput({
  typeDef,
  value,
  onChange,
  typeRegistry,
  label,
  depth,
  disabled,
}: {
  typeDef: TypeDefinition & { shape: { kind: "struct" } }
  value: ArgValue
  onChange: (v: ArgValue) => void
  typeRegistry: Map<string, TypeDefinition>
  label?: string
  depth: number
  disabled?: boolean
}): React.ReactNode {
  const fields = value.kind === "struct" ? value.fields : {}

  const updateField = useCallback((name: string, v: ArgValue) => {
    onChange({ kind: "struct", fields: { ...fields, [name]: v } })
  }, [fields, onChange])

  return (
    <div className="arg-field arg-field--compound" style={{ marginLeft: depth > 0 ? 12 : 0 }}>
      {label !== undefined && (
        <div className="arg-compound-header">
          <span className="arg-label">{label}</span>
          <span className="arg-type-badge">{typeDef.name}</span>
        </div>
      )}
      <div className="arg-struct-fields">
        {typeDef.shape.fields.map((field) => {
          const fieldValue = fields[field.name] ?? defaultArgValue(field.type)
          return (
            <ArgInput
              key={field.name}
              type={field.type}
              value={fieldValue}
              onChange={(v) => updateField(field.name, v)}
              typeRegistry={typeRegistry}
              label={field.name}
              depth={depth + 1}
              disabled={disabled}
            />
          )
        })}
      </div>
    </div>
  )
}

// ─── ENUM INPUT ───────────────────────────────────────────────────────────────

function EnumInput({
  typeDef,
  value,
  onChange,
  typeRegistry,
  label,
  depth,
  disabled,
}: {
  typeDef: TypeDefinition & { shape: { kind: "enum" } }
  value: ArgValue
  onChange: (v: ArgValue) => void
  typeRegistry: Map<string, TypeDefinition>
  label?: string
  depth: number
  disabled?: boolean
}): React.ReactNode {
  const id = useId()
  const currentVariant = value.kind === "enum" ? value.variant : (typeDef.shape.variants[0]?.name ?? "")
  const currentFields = value.kind === "enum" ? value.fields : {}

  const handleVariantChange = useCallback((variantName: string) => {
    onChange({ kind: "enum", variant: variantName, fields: {} })
  }, [onChange])

  const updateVariantField = useCallback((name: string, v: ArgValue) => {
    onChange({ kind: "enum", variant: currentVariant, fields: { ...currentFields, [name]: v } })
  }, [currentVariant, currentFields, onChange])

  const selectedVariantDef = typeDef.shape.variants.find((v) => v.name === currentVariant)

  return (
    <div className="arg-field arg-field--compound">
      {label !== undefined && (
        <label htmlFor={id} className="arg-label">
          {label} <span className="arg-type-badge">{typeDef.name}</span>
        </label>
      )}
      <select
        id={id}
        className="arg-enum-select"
        value={currentVariant}
        onChange={(e) => handleVariantChange(e.target.value)}
        disabled={disabled}
        aria-label={label ?? typeDef.name}
      >
        {typeDef.shape.variants.map((v) => (
          <option key={v.name} value={v.name}>{v.name}</option>
        ))}
      </select>

      {selectedVariantDef !== undefined && selectedVariantDef.fields.length > 0 && (
        <div className="arg-enum-fields">
          {selectedVariantDef.fields.map((f, i) => {
            if ("name" in f && "type" in f) {
              const namedField = f as { name: string; type: FieldType }
              const fv = currentFields[namedField.name] ?? defaultArgValue(namedField.type)
              return (
                <ArgInput
                  key={namedField.name}
                  type={namedField.type}
                  value={fv}
                  onChange={(v) => updateVariantField(namedField.name, v)}
                  typeRegistry={typeRegistry}
                  label={namedField.name}
                  depth={depth + 1}
                  disabled={disabled}
                />
              )
            }
            // Positional field
            const posType = f as FieldType
            const fv = currentFields[String(i)] ?? defaultArgValue(posType)
            return (
              <ArgInput
                key={i}
                type={posType}
                value={fv}
                onChange={(v) => updateVariantField(String(i), v)}
                typeRegistry={typeRegistry}
                label={`[${i}]`}
                depth={depth + 1}
                disabled={disabled}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── MAIN DISPATCHER ──────────────────────────────────────────────────────────

export function ArgInput({
  type,
  value,
  onChange,
  typeRegistry,
  label,
  depth = 0,
  disabled = false,
}: ArgInputProps): React.ReactNode {
  switch (type.kind) {
    case "primitive":
      return (
        <PrimitiveInput
          type={type.type}
          value={value}
          onChange={onChange}
          label={label}
          disabled={disabled}
        />
      )

    case "vec":
      return (
        <VecInput
          type={type.item}
          value={value}
          onChange={onChange}
          typeRegistry={typeRegistry}
          label={label}
          disabled={disabled}
        />
      )

    case "array":
      return (
        <ArrayInput
          type={type.item}
          len={type.len}
          value={value}
          onChange={onChange}
          typeRegistry={typeRegistry}
          label={label}
          disabled={disabled}
        />
      )

    case "option":
    case "coption":
      return (
        <OptionInput
          type={type.item}
          value={value}
          onChange={onChange}
          typeRegistry={typeRegistry}
          label={label}
          disabled={disabled}
        />
      )

    case "defined": {
      const typeDef = typeRegistry.get(type.name)
      if (typeDef === undefined) {
        // Unknown type — show raw JSON input as fallback
        const raw = value.kind === "primitive" ? value.raw : ""
        return (
          <div className="arg-field">
            {label !== undefined && (
              <label className="arg-label">
                {label} <span className="arg-type-badge arg-type-badge--unknown">{type.name}</span>
              </label>
            )}
            <input
              className="arg-input arg-input--mono"
              type="text"
              placeholder={`JSON for ${type.name}…`}
              value={raw}
              onChange={(e) => onChange({ kind: "primitive", raw: e.target.value })}
              disabled={disabled}
            />
          </div>
        )
      }

      if (typeDef.shape.kind === "struct") {
        return (
          <StructInput
            typeDef={typeDef as TypeDefinition & { shape: { kind: "struct" } }}
            value={value}
            onChange={onChange}
            typeRegistry={typeRegistry}
            label={label}
            depth={depth}
            disabled={disabled}
          />
        )
      }

      return (
        <EnumInput
          typeDef={typeDef as TypeDefinition & { shape: { kind: "enum" } }}
          value={value}
          onChange={onChange}
          typeRegistry={typeRegistry}
          label={label}
          depth={depth}
          disabled={disabled}
        />
      )
    }
  }
}