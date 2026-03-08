/**
 * AccountInspector.tsx
 *
 * Panel that lets users paste an account address, fetch it from chain,
 * see raw info (owner, lamports, executable, hex/base64), and — if the
 * account matches a discriminator in the loaded IDL — see a fully decoded
 * field-by-field breakdown.
 */

import {
    useState,
    useCallback,
    type KeyboardEvent,
  } from "react"
  import { useAppStore } from "../../store/appStore"
  import { getConnection } from "../../lib/connection"
  import {
    fetchAndInspectAccount,
    AccountFetchError,
    type AccountInspectResult,
    type RawAccountInfo,
  } from "../../lib/accountFetcher"
  import {
    formatDecodedValue,
    type DecodedField,
    type DecodedValue,
  } from "../../lib/borshDecoder"
  
  // ─── HELPERS ─────────────────────────────────────────────────────────────────
  
  function isValidLookingAddress(s: string): boolean {
    return s.trim().length >= 32 && s.trim().length <= 44
  }
  
  function truncate(s: string, head = 6, tail = 4): string {
    if (s.length <= head + tail + 3) return s
    return `${s.slice(0, head)}…${s.slice(-tail)}`
  }
  
  function copyToClipboard(text: string): void {
    void navigator.clipboard.writeText(text)
  }
  
  function solDisplay(lamports: number): string {
    const sol = lamports / 1_000_000_000
    if (sol < 0.0001) return `${lamports.toLocaleString()} lamports`
    return `◎ ${sol.toFixed(6)}`
  }
  
  // ─── COPY BUTTON ──────────────────────────────────────────────────────────────
  
  function CopyButton({ text, label = "Copy" }: { text: string; label?: string }){
    const [copied, setCopied] = useState(false)
    const handleClick = (): void => {
      copyToClipboard(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    return (
      <button className="copy-btn" onClick={handleClick} title={label} aria-label={label}>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    )
  }
  
  // ─── RAW ACCOUNT INFO ─────────────────────────────────────────────────────────
  
  type RawView = "hex" | "base64"
  
  function RawInfoPanel({ info }: { info: RawAccountInfo }) {
    const [rawView, setRawView] = useState<RawView>("hex")
    const [hexExpanded, setHexExpanded] = useState(false)
  
    return (
      <div className="insp-section">
        {/* ── Meta grid ── */}
        <div className="insp-meta-grid">
          <MetaCell label="Address">
            <span className="meta-mono">{truncate(info.address, 8, 6)}</span>
            <CopyButton text={info.address} label="Copy address" />
          </MetaCell>
  
          <MetaCell label="Balance">
            <span className="meta-value">{solDisplay(info.lamports)}</span>
          </MetaCell>
  
          <MetaCell label="Owner">
            <span className="meta-mono" title={info.owner}>
              {info.ownerName !== null
                ? info.ownerName
                : truncate(info.owner, 6, 4)}
            </span>
            <CopyButton text={info.owner} label="Copy owner address" />
          </MetaCell>
  
          <MetaCell label="Executable">
            <span className={`meta-badge ${info.executable ? "meta-badge--green" : "meta-badge--neutral"}`}>
              {info.executable ? "Yes" : "No"}
            </span>
          </MetaCell>
  
          <MetaCell label="Data Size">
            <span className="meta-value">{info.dataLength.toLocaleString()} bytes</span>
          </MetaCell>
  
          <MetaCell label="Rent Epoch">
            <span className="meta-value">{info.rentEpoch.toLocaleString()}</span>
          </MetaCell>
        </div>
  
        {/* ── Raw data view ── */}
        <div className="insp-raw-header">
          <span className="insp-label">Raw Data</span>
          <div className="insp-raw-tabs">
            <button
              className={`insp-tab ${rawView === "hex" ? "insp-tab--active" : ""}`}
              onClick={() => setRawView("hex")}
            >Hex</button>
            <button
              className={`insp-tab ${rawView === "base64" ? "insp-tab--active" : ""}`}
              onClick={() => setRawView("base64")}
            >Base64</button>
          </div>
          <CopyButton
            text={rawView === "hex" ? info.hexRaw : info.base64}
            label={`Copy ${rawView}`}
          />
        </div>
  
        {rawView === "hex" ? (
          <div className="insp-hex-wrap">
            <pre className={`insp-hex ${hexExpanded ? "" : "insp-hex--collapsed"}`}>
              {info.hexDump}
            </pre>
            {info.dataLength > 256 && (
              <button
                className="insp-expand-btn"
                onClick={() => setHexExpanded((v) => !v)}
              >
                {hexExpanded ? "Show less" : `Show all ${info.dataLength} bytes`}
              </button>
            )}
          </div>
        ) : (
          <div className="insp-hex-wrap">
            <pre className={`insp-hex insp-hex--base64 ${hexExpanded ? "" : "insp-hex--collapsed"}`}>
              {info.base64}
            </pre>
            {info.base64.length > 300 && (
              <button
                className="insp-expand-btn"
                onClick={() => setHexExpanded((v) => !v)}
              >
                {hexExpanded ? "Show less" : "Show full base64"}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
  
  function MetaCell({
    label,
    children,
  }: {
    label: string
    children: React.ReactNode
  }){
    return (
      <div className="meta-cell">
        <span className="meta-cell__label">{label}</span>
        <span className="meta-cell__value">{children}</span>
      </div>
    )
  }
  
  // ─── DECODED FIELD TREE ───────────────────────────────────────────────────────
  
  function DecodedFieldRow({
    field,
    depth,
  }: {
    field: DecodedField
    depth: number
  }) {
    const [expanded, setExpanded] = useState(true)
    const hasChildren = isExpandable(field.value)
  
    return (
      <>
        <div
          className={`field-row ${hasChildren ? "field-row--expandable" : ""}`}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
          onClick={hasChildren ? () => setExpanded((v) => !v) : undefined}
          role={hasChildren ? "button" : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
        >
          <span className="field-row__chevron">
            {hasChildren ? (expanded ? "▾" : "▸") : ""}
          </span>
          <span className="field-row__name">{field.name}</span>
          <span className="field-row__type">{field.value.typeLabel}</span>
          <span className="field-row__value">
            <FormattedValue value={field.value} />
          </span>
          <span className="field-row__offset">
            +{field.offset}
          </span>
        </div>
  
        {hasChildren && expanded && renderChildren(field.value, depth + 1)}
      </>
    )
  }
  
  function isExpandable(value: DecodedValue): boolean {
    switch (value.kind) {
      case "struct":
      case "vec":
      case "array":
      case "enum":
        return true
      case "option":
        return value.inner !== null
      default:
        return false
    }
  }
  
  function renderChildren(value: DecodedValue, depth: number) {
    switch (value.kind) {
      case "struct":
        return (
          <>
            {value.fields.map((f) => (
              <DecodedFieldRow key={`${f.name}-${f.offset}`} field={f} depth={depth} />
            ))}
          </>
        )
      case "vec":
      case "array":
        return (
          <>
            {value.items.map((f) => (
              <DecodedFieldRow key={`${f.name}-${f.offset}`} field={f} depth={depth} />
            ))}
          </>
        )
      case "enum":
        return (
          <>
            {value.fields.map((f) => (
              <DecodedFieldRow key={`${f.name}-${f.offset}`} field={f} depth={depth} />
            ))}
          </>
        )
      case "option":
        if (value.inner === null) return <></>
        return <DecodedFieldRow field={value.inner} depth={depth} />
      default:
        return <></>
    }
  }
  
  function FormattedValue({ value }: { value: DecodedValue }){
    const formatted = formatDecodedValue(value)
  
    // Public keys get a copy button
    if (value.kind === "publicKey") {
      return (
        <span className="field-value-pubkey">
          <span title={value.value}>{truncate(value.value, 6, 4)}</span>
          <CopyButton text={value.value} label="Copy address" />
        </span>
      )
    }
    if (value.kind === "bool") {
      return (
        <span className={`field-value-bool ${value.value ? "field-value-bool--true" : "field-value-bool--false"}`}>
          {formatted}
        </span>
      )
    }
    if (value.kind === "enum") {
      return <span className="field-value-enum">{formatted}</span>
    }
    if (value.kind === "uint" || value.kind === "int" || value.kind === "float") {
      return <span className="field-value-number">{formatted}</span>
    }
    if (value.kind === "string") {
      return <span className="field-value-string">{formatted}</span>
    }
    return <span className="field-value-default">{formatted}</span>
  }
  
  function DecodedAccountPanel({ result }: { result: AccountInspectResult }) {
    const { discriminatorMatch } = result
    if (!discriminatorMatch.matched) return null
  
    const { accountDef, decodeResult, decodeError } = discriminatorMatch
  
    return (
      <div className="insp-section">
        <div className="insp-match-banner">
          <MatchIcon />
          <span>
            Matched account type: <strong>{accountDef.name}</strong>
          </span>
          <span className="insp-discriminator" title="First 8 bytes of sha256('account:<Name>')">
            disc: 0x{Array.from(accountDef.discriminator).map(b => b.toString(16).padStart(2,"0")).join("")}
          </span>
        </div>
  
        {decodeError !== null ? (
          <div className="insp-decode-error">
            <span className="insp-decode-error__label">Decode error</span>
            <span className="insp-decode-error__msg">{decodeError}</span>
          </div>
        ) : decodeResult !== null ? (
          <div className="field-table">
            <div className="field-table__header">
              <span style={{ paddingLeft: 32 }}>Field</span>
              <span>Type</span>
              <span>Value</span>
              <span>Offset</span>
            </div>
            {decodeResult.fields.map((field) => (
              <DecodedFieldRow key={`${field.name}-${field.offset}`} field={field} depth={0} />
            ))}
          </div>
        ) : null}
      </div>
    )
  }
  
  // ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
  
  export function AccountInspector() {
    const { schema } = useAppStore()
    const [addressInput, setAddressInput] = useState("")
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [result, setResult] = useState<AccountInspectResult | null>(null)
  
    const handleFetch = useCallback(async () => {
      const trimmed = addressInput.trim()
      if (trimmed === "") return
  
      setLoading(true)
      setError(null)
      setResult(null)
  
      try {
        const conn = getConnection()
        const inspectResult = await fetchAndInspectAccount(conn, trimmed, schema)
        setResult(inspectResult)
      } catch (err) {
        setError(
          err instanceof AccountFetchError
            ? err.message
            : err instanceof Error
              ? err.message
              : "An unexpected error occurred"
        )
      } finally {
        setLoading(false)
      }
    }, [addressInput, schema])
  
    const handleKeyDown = useCallback(
      (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") void handleFetch()
      },
      [handleFetch]
    )
  
    return (
      <div className="account-inspector">
        {/* ── Header ── */}
        <div className="insp-header">
          <h2 className="insp-title">Account Inspector</h2>
          <p className="insp-subtitle">
            Paste any account address to inspect its data.
            {schema !== null && (
              <> IDL loaded — discriminators will be matched against <strong>{schema.accountRegistry.size}</strong> account type{schema.accountRegistry.size !== 1 ? "s" : ""}.</>
            )}
          </p>
        </div>
  
        {/* ── Address input ── */}
        <div className="insp-input-row">
          <input
            className="insp-address-input"
            type="text"
            placeholder="Account address (base58)…"
            value={addressInput}
            onChange={(e) => {
              setAddressInput(e.target.value)
              if (error !== null) setError(null)
            }}
            onKeyDown={handleKeyDown}
            disabled={loading}
            spellCheck={false}
            aria-label="Account address"
          />
          <button
            className="insp-fetch-btn"
            onClick={() => void handleFetch()}
            disabled={loading || !isValidLookingAddress(addressInput)}
          >
            {loading ? <MiniSpinner /> : "Inspect"}
          </button>
        </div>
  
        {/* ── Error ── */}
        {error !== null && (
          <div className="insp-error" role="alert">
            <ErrorIcon />
            <span>{error}</span>
          </div>
        )}
  
        {/* ── Results ── */}
        {result !== null && (
          <div className="insp-results">
            {/* Decoded type panel appears first when matched — most valuable info */}
            {result.discriminatorMatch.matched && (
              <DecodedAccountPanel result={result} />
            )}
  
            {/* Raw info always shown */}
            <RawInfoPanel info={result.raw} />
  
            {/* Note if IDL loaded but no match */}
            {!result.discriminatorMatch.matched && schema !== null && (
              <div className="insp-no-match">
                <InfoIcon />
                <span>
                  No discriminator match found in the loaded IDL. Showing raw data only.
                </span>
              </div>
            )}
          </div>
        )}
  
        {/* ── Empty state ── */}
        {result === null && !loading && error === null && (
          <div className="insp-empty">
            <SearchIcon />
            <p>Enter an account address above to inspect it</p>
            {schema !== null && (
              <p className="insp-empty__hint">
                Try pasting an address owned by <strong>{schema.name}</strong>
              </p>
            )}
          </div>
        )}
      </div>
    )
  }
  
  // ─── SMALL ICONS ──────────────────────────────────────────────────────────────
  
  function MiniSpinner() {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="spinner" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          strokeDasharray="31.416" strokeDashoffset="10" />
      </svg>
    )
  }
  
  function CopyIcon(){
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  }
  
  function CheckIcon(){
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M20 6L9 17L4 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  
  function MatchIcon(){
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  
  function ErrorIcon() {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  function InfoIcon() {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
        <path d="M12 16v-4M12 8h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  
  function SearchIcon(){
    return (
      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M21 21l-4.35-4.35" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }