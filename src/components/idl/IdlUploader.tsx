import { useState, useRef, useCallback, useEffect, type DragEvent, type ChangeEvent } from "react"
import { parseIdl, parseIdlJson, IdlParseError } from "../../lib/idlParser"
import { fetchIdlFromChain, isValidPublicKey, OnChainIdlError } from "../../lib/onChainIdl"
import { getConnection } from "../../lib/connection"
import { useAppStore } from "../../store/appStore"

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function isErrorWithMessage(e: unknown): e is { message: string } {
  return typeof e === "object" && e !== null && "message" in e
}

function getErrorMessage(e: unknown): string {
  if (e instanceof IdlParseError || e instanceof OnChainIdlError) return e.message
  if (isErrorWithMessage(e)) return e.message
  return "An unexpected error occurred"
}

// ─── FILE HANDLER ─────────────────────────────────────────────────────────────

async function loadFromFile(file: File): Promise<void> {
  const { setIdlStatus, setSchema } = useAppStore.getState()

  if (!file.name.endsWith(".json")) {
    setIdlStatus({ kind: "error", message: "Please upload a .json IDL file" })
    return
  }

  setIdlStatus({ kind: "loading", source: "file", label: file.name })

  try {
    const text = await file.text()
    const raw = parseIdlJson(text)
    const programAddress = prompt("Enter program address for this IDL")
    const schema = await parseIdl(raw, programAddress ?? undefined)
    
    setSchema(schema)
  } catch (err) {
    setIdlStatus({ kind: "error", message: getErrorMessage(err) })
  }
}

// ─── ADDRESS HANDLER ──────────────────────────────────────────────────────────

async function loadFromChain(address: string): Promise<void> {
  const { setIdlStatus, setSchema } = useAppStore.getState()

  setIdlStatus({ kind: "loading", source: "chain", label: address })

  try {
    const connection = getConnection()
    const raw = await fetchIdlFromChain(address, connection)
const schema = await parseIdl(raw)
    setSchema(schema)
  } catch (err) {
    setIdlStatus({ kind: "error", message: getErrorMessage(err) })
  }
}

// ─── COMPONENT ────────────────────────────────────────────────────────────────

export function IdlUploader() {
  const [isDragging, setIsDragging] = useState(false)
  const [addressInput, setAddressInput] = useState("")
  const [addressError, setAddressError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { idlStatus } = useAppStore()
  useEffect(() => {
    function handleFillAddress(e: Event): void {
      const custom = e as CustomEvent<{ address: string }>
      const address = custom.detail?.address
      if (typeof address === "string") {
        setAddressInput(address)
        setAddressError(null)
      }
    }
  
    window.addEventListener("spi:fill-address", handleFillAddress)
  
    return () => {
      window.removeEventListener("spi:fill-address", handleFillAddress)
    }
  }, [])

  const isLoading = idlStatus.kind === "loading"

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)
      if (isLoading) return

      const file = e.dataTransfer.files[0]
      if (file !== undefined) {
        void loadFromFile(file)
      }
    },
    [isLoading]
  )

  const handleFileChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file !== undefined) {
      void loadFromFile(file)
    }
    // Reset so the same file can be re-uploaded
    if (fileInputRef.current !== null) {
      fileInputRef.current.value = ""
    }
  }, [])

  // ── Address submit ────────────────────────────────────────────────────────────
  const handleAddressSubmit = useCallback(() => {
    const trimmed = addressInput.trim()
    if (trimmed === "") {
      setAddressError("Enter a program address")
      return
    }
    if (!isValidPublicKey(trimmed)) {
      setAddressError("Not a valid Solana public key")
      return
    }
    setAddressError(null)
    void loadFromChain(trimmed)
  }, [addressInput])

  const handleAddressKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") handleAddressSubmit()
    },
    [handleAddressSubmit]
  )

  return (
    <div className="idl-uploader">
      {/* ── Drop zone ── */}
      <div
        className={`drop-zone ${isDragging ? "drop-zone--dragging" : ""} ${isLoading ? "drop-zone--loading" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => {
          if (!isLoading) fileInputRef.current?.click()
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload IDL JSON file"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click()
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          style={{ display: "none" }}
          onChange={handleFileChange}
          aria-hidden="true"
        />

        {idlStatus.kind === "loading" && idlStatus.source === "file" ? (
          <div className="drop-zone__inner">
            <LoadingSpinner />
            <span className="drop-zone__label">Parsing {idlStatus.label}…</span>
          </div>
        ) : (
          <div className="drop-zone__inner">
            <UploadIcon />
            <span className="drop-zone__label">
              {isDragging ? "Drop IDL here" : "Drop IDL JSON or click to browse"}
            </span>
            <span className="drop-zone__hint">.json · Anchor IDL</span>
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div className="divider">
        <span className="divider__text">or fetch from chain</span>
      </div>

      {/* ── Address input ── */}
      <div className="address-row">
        <div className="address-input-wrap">
          <input
            className={`address-input ${addressError !== null ? "address-input--error" : ""}`}
            type="text"
            placeholder="Program address (e.g. MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD)"
            value={addressInput}
            onChange={(e) => {
              setAddressInput(e.target.value)
              if (addressError !== null) setAddressError(null)
            }}
            onKeyDown={handleAddressKeyDown}
            disabled={isLoading}
            spellCheck={false}
            aria-label="Program address"
            aria-invalid={addressError !== null}
            aria-describedby={addressError !== null ? "address-error" : undefined}
          />
          {addressError !== null && (
            <span id="address-error" className="address-input__error" role="alert">
              {addressError}
            </span>
          )}
        </div>

        <button
          className="fetch-btn"
          onClick={handleAddressSubmit}
          disabled={isLoading || addressInput.trim() === ""}
          aria-label="Fetch IDL from chain"
        >
          {idlStatus.kind === "loading" && idlStatus.source === "chain" ? (
            <LoadingSpinner size={16} />
          ) : (
            "Fetch"
          )}
        </button>
      </div>

      {/* ── Global status messages ── */}
      {idlStatus.kind === "error" && (
        <div className="status-banner status-banner--error" role="alert">
          <ErrorIcon />
          <span>{idlStatus.message}</span>
        </div>
      )}

      {idlStatus.kind === "loading" && idlStatus.source === "chain" && (
        <div className="status-banner status-banner--info" role="status">
          <LoadingSpinner size={14} />
          <span>Fetching IDL from chain for {idlStatus.label}…</span>
        </div>
      )}
    </div>
  )
}

// ─── SMALL ICON COMPONENTS ────────────────────────────────────────────────────

function UploadIcon(){
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 16V8M12 8L9 11M12 8L15 11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M3 15C3 17.8 5.2 20 8 20H16C18.8 20 21 17.8 21 15"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

function LoadingSpinner({ size = 20 }: { size?: number }){
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="spinner"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="31.416"
        strokeDashoffset="10"
      />
    </svg>
  )
}

function ErrorIcon(){
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 8V12M12 16H12.01"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}