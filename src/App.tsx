
import React, { useState } from "react"
import { useAppStore } from "./store/appStore"
import { IdlUploader } from "./components/idl/IdlUploader"
import { InstructionList } from "./components/idl/InstructionList"
import { AccountInspector } from "./components/inspector/AccountInspector"
import { PdaCalculator } from "./components/pda/PdaCalculator"
import { TransactionBuilder } from "./components/builder/TransactionBuilder"
import { SimulationPanel } from "./components/simulation/SimulationPanel"
import "./app.css"

type Tab = "instructions" | "builder" | "simulate" | "inspector" | "pda"

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "instructions", label: "Instructions", icon: "⬡" },
  { id: "builder",      label: "Builder",      icon: "⬢" },
  { id: "simulate",     label: "Simulate",     icon: "▶" },
  { id: "inspector",    label: "Inspector",    icon: "⊙" },
  { id: "pda",          label: "PDA",          icon: "⌖" },
]

// Tabs where the panel must fill the full remaining height (no scroll wrapper)
const FILL_TABS = new Set<Tab>(["builder", "simulate"])

export default function App(): React.ReactNode {
  const { schema, reset, idlStatus } = useAppStore()
  const [activeTab, setActiveTab] = useState<Tab>("instructions")
  const hasSchema = schema !== null

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
        {hasSchema && (
          <div className="topbar__right">
            <span className="topbar__loaded">
              <span className="topbar__loaded-dot" />
              {schema.name}
            </span>
            <button className="topbar__reset" onClick={reset} aria-label="Unload IDL">
              Unload
            </button>
          </div>
        )}
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
                  className={`tab-btn ${activeTab === tab.id ? "tab-btn--active" : ""} ${tab.id === "simulate" ? "tab-btn--simulate" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <span className="tab-btn__icon" aria-hidden="true">{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            <div
              className={`tab-panel ${FILL_TABS.has(activeTab) ? "tab-panel--fill" : ""}`}
              role="tabpanel"
            >
              {activeTab === "instructions" && <InstructionList />}
              {activeTab === "builder"      && <TransactionBuilder />}
              {activeTab === "simulate"     && <SimulationPanel />}
              {activeTab === "inspector"    && <AccountInspector />}
              {activeTab === "pda"          && <PdaCalculator />}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function LandingScreen({ idlStatus }: { idlStatus: ReturnType<typeof useAppStore>["idlStatus"] }): React.ReactNode {
  return (
    <div className="landing">
      <div className="landing__hero">
        <h1 className="landing__title">
          Inspect &amp; invoke any<br />Solana program
        </h1>
        <p className="landing__subtitle">
          Load an Anchor IDL — from a file or directly from chain — to visually
          build, simulate, and execute transactions without writing code.
        </p>
      </div>
      <div className="landing__loader">
        <IdlUploader />
        {idlStatus.kind === "idle" && (
          <div className="landing__examples">
            <p className="landing__examples-label">Try a known program:</p>
            <div className="landing__example-chips">
              <ExampleChip label="Marinade"                address="MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD" />
              <ExampleChip label="Metaplex Token Metadata" address="metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s" />
              <ExampleChip label="Jupiter v6"              address="JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ExampleChip({ label, address }: { label: string; address: string }): React.ReactNode {
  return (
    <button
      className="example-chip"
      onClick={() => window.dispatchEvent(new CustomEvent("spi:fill-address", { detail: { address } }))}
      title={address}
      aria-label={`Load ${label} IDL`}
    >
      {label}
    </button>
  )
}

function LogoMark(): React.ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polygon points="12,2 22,7 22,17 12,22 2,17 2,7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <polygon points="12,7 17,9.5 17,14.5 12,17 7,14.5 7,9.5" fill="currentColor" opacity="0.35" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  )
}