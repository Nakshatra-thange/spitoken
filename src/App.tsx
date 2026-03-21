import React, { useState, useEffect } from "react"
import { type IdlLoadStatus, useAppStore } from "./store/appStore"
import { useBuilderStore } from "./store/builderStore"
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui"
import { IdlUploader } from "./components/idl/IdlUploader"
import { InstructionList } from "./components/idl/InstructionList"
import { AccountInspector } from "./components/inspector/AccountInspector"
import { PdaCalculator } from "./components/pda/PdaCalculator"
import { TransactionBuilder } from "./components/builder/TransactionBuilder"
import { SimulationPanel } from "./components/simulation/SimulationPanel"

import { decodeSessionFromUrl, encodeSessionToUrl } from "./lib/share"
import { downloadSession, loadSessionFile } from "./lib/session"

import "./app.css"

type Tab = "instructions" | "builder" | "simulate" | "inspector" | "pda"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "instructions", label: "Instructions", icon: "⬡" },
  { id: "builder", label: "Builder", icon: "⬢" },
  { id: "simulate", label: "Simulate", icon: "▶" },
  { id: "inspector", label: "Inspector", icon: "⊙" },
  { id: "pda", label: "PDA", icon: "⌖" },
]

const FILL_TABS = new Set<Tab>(["builder", "simulate"])

export default function App(): React.ReactNode {
  const { schema, reset, idlStatus, setSchema } = useAppStore()
  const { instances, setInstructions } = useBuilderStore()

  const [activeTab, setActiveTab] = useState<Tab>("instructions")

  const hasSchema = schema !== null

  // ─── LOAD FROM URL ─────────────────────────────────────
  useEffect(() => {
    const session = decodeSessionFromUrl()
    if (!session) return

    try {
      setSchema(session.idl as any)
      setInstructions(session.instructions)
    } catch (err) {
      console.error("Failed to restore session", err)
    }
  }, [setSchema, setInstructions])

  // ─── HANDLERS ──────────────────────────────────────────

  const handleSaveSession = () => {
    if (!schema) return

    downloadSession({
      idl: schema,
      instructions: instances,
      timestamp: Date.now(),
    })
  }

  const handleLoadSession = async (file: File) => {
    const session = await loadSessionFile(file)

    setSchema(session.idl as any)
    setInstructions(session.instructions)
  }

  const handleShare = () => {
    if (!schema) return

    const url =
      window.location.origin +
      encodeSessionToUrl({
        idl: schema,
        instructions: instances,
        timestamp: Date.now(),
      })

    navigator.clipboard.writeText(url)
  }

  // ─── UI ────────────────────────────────────────────────

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar__left">
          <span className="topbar__logo">
            <LogoMark />
            <span className="topbar__wordmark">SPI-Tokens</span>
          </span>
          <span className="topbar__tagline">Solana Program Invoker</span>
        </div>

        <div className="topbar__right">
          <WalletMultiButton />
          
          {hasSchema && (
            <>
              <span className="topbar__loaded">
                <span className="topbar__loaded-dot" />
                {schema.name}
              </span>

              {/* ─── SESSION ACTIONS ─── */}
              <button onClick={handleSaveSession}>Save</button>

              <label className="topbar__upload">
                Load
                <input
                  type="file"
                  accept=".json,.spi"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void handleLoadSession(file)
                  }}
                />
              </label>

              <button onClick={handleShare}>Share</button>

              <button onClick={reset}>Unload</button>
            </>
          )}
        </div>
      </header>

      <main className="main">
        {!hasSchema ? (
          <LandingScreen idlStatus={idlStatus} />
        ) : (
          <div className="workspace">
            <div className="tab-bar" role="tablist">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`tab-btn ${
                    activeTab === tab.id ? "tab-btn--active" : ""
                  }`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="tab-btn__icon">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              className={`tab-panel ${
                FILL_TABS.has(activeTab) ? "tab-panel--fill" : ""
              }`}
            >
              {activeTab === "instructions" && <InstructionList />}
              {activeTab === "builder" && <TransactionBuilder />}
              {activeTab === "simulate" && <SimulationPanel />}
              {activeTab === "inspector" && <AccountInspector />}
              {activeTab === "pda" && <PdaCalculator />}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── LANDING ─────────────────────────────────────────────

function LandingScreen({
  idlStatus,
}: {
  idlStatus: IdlLoadStatus
}): React.ReactNode {
  return (
    <div className="landing">
      <div className="landing__hero">
        <h1>Inspect & invoke any Solana program</h1>
        <p>Load an IDL to start building transactions visually.</p>
      </div>

      <IdlUploader />

      {idlStatus.kind === "idle" && (
        <div className="landing__examples">
          <ExampleChip label="Marinade" address="MarBmsSg..." />
          <ExampleChip label="Metaplex" address="metaqbxx..." />
        </div>
      )}
    </div>
  )
}

function ExampleChip({
  label,
  address,
}: {
  label: string
  address: string
}) {
  return (
    <button
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("spi:fill-address", { detail: { address } })
        )
      }
    >
      {label}
    </button>
  )
}

function LogoMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24">
      <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" stroke="currentColor" />
    </svg>
  )
}