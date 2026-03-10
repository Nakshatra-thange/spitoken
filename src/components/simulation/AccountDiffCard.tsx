import  { useState, useMemo } from "react"
import { type AccountDiff } from "../../lib/simulator"
import { decodeAccountData, formatDecodedValue, type DecodedField } from "../../lib/borshDecoder"
import { type ProgramSchema } from "../../types/idl"

const LAMPORTS_PER_SOL = 1_000_000_000

function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL)
    .toFixed(9)
    .replace(/\.?0+$/, "")
}

function formatLamportDelta(delta: number): string {
  const sign = delta >= 0 ? "+" : "-"
  const abs = Math.abs(delta)

  const sol = (abs / LAMPORTS_PER_SOL)
    .toFixed(9)
    .replace(/\.?0+$/, "")

  return `${sign}${sol} SOL (${sign}${abs.toLocaleString()} lamports)`
}

interface Props {
  diff: AccountDiff
  schema: ProgramSchema | null
}

export function AccountDiffCard({ diff, schema }: Props): JSX.Element | null {
  const [expanded, setExpanded] = useState(
    diff.wasCreated || diff.wasClosed || diff.dataChanged
  )

  const beforeFields = useMemo((): DecodedField[] | null => {
    if (schema === null) return null
    if (diff.rawDataBefore === null) return null
    if (diff.rawDataBefore.length < 8) return null

    for (const [, acctDef] of schema.accountRegistry) {
      const disc = acctDef.discriminator

      let match = true
      for (let i = 0; i < 8; i++) {
        if ((diff.rawDataBefore[i] ?? 0) !== (disc[i] ?? 0)) {
          match = false
          break
        }
      }

      if (!match) continue

      try {
        const decoded = decodeAccountData(
          diff.rawDataBefore,
          acctDef.fields,
          schema.typeRegistry
        )

        return decoded.fields
      } catch {
        return null
      }
    }

    return null
  }, [diff.rawDataBefore, schema])

  const afterFields = useMemo((): DecodedField[] | null => {
    if (schema === null) return null
    if (diff.rawDataAfter === null) return null
    if (diff.rawDataAfter.length < 8) return null

    for (const [, acctDef] of schema.accountRegistry) {
      const disc = acctDef.discriminator

      let match = true
      for (let i = 0; i < 8; i++) {
        if ((diff.rawDataAfter[i] ?? 0) !== (disc[i] ?? 0)) {
          match = false
          break
        }
      }

      if (!match) continue

      try {
        const decoded = decodeAccountData(
          diff.rawDataAfter,
          acctDef.fields,
          schema.typeRegistry
        )

        return decoded.fields
      } catch {
        return null
      }
    }

    return null
  }, [diff.rawDataAfter, schema])

  const hasChanges =
    diff.wasCreated ||
    diff.wasClosed ||
    diff.dataChanged ||
    (diff.lamportDelta ?? 0) !== 0

  if (!hasChanges) return null

  return (
    <div
      className={`acct-diff-card 
        ${diff.wasCreated ? "acct-diff-card--created" : ""} 
        ${diff.wasClosed ? "acct-diff-card--closed" : ""}`}
    >
      <div
        className="acct-diff-card__header"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="acct-diff-card__chevron">
          {expanded ? "▾" : "▸"}
        </span>

        <code
          className="acct-diff-card__addr"
          title={diff.address}
        >
          {diff.address.slice(0, 6)}…{diff.address.slice(-4)}
        </code>

        <div className="acct-diff-card__badges">
          {diff.wasCreated && (
            <span className="acct-diff-badge acct-diff-badge--created">
              Created
            </span>
          )}

          {diff.wasClosed && (
            <span className="acct-diff-badge acct-diff-badge--closed">
              Closed
            </span>
          )}

          {diff.dataChanged &&
            !diff.wasCreated &&
            !diff.wasClosed && (
              <span className="acct-diff-badge acct-diff-badge--modified">
                Modified
              </span>
            )}

          {diff.lamportDelta !== null &&
            diff.lamportDelta !== 0 && (
              <span
                className={`acct-diff-badge ${
                  diff.lamportDelta > 0
                    ? "acct-diff-badge--gained"
                    : "acct-diff-badge--spent"
                }`}
              >
                {formatLamportDelta(diff.lamportDelta)}
              </span>
            )}
        </div>

        <button
          className="acct-diff-copy"
          onClick={(e) => {
            e.stopPropagation()
            void navigator.clipboard.writeText(diff.address)
          }}
          type="button"
        >
          ⧉
        </button>
      </div>

      {expanded && (
        <div className="acct-diff-card__body">
          {diff.lamportsBefore !== null &&
            diff.lamportsAfter !== null && (
              <div className="acct-diff-lamports">
                <span className="acct-diff-lamports__label">
                  SOL balance
                </span>

                <span className="acct-diff-lamports__before">
                  {lamportsToSol(diff.lamportsBefore)}
                </span>

                <span className="acct-diff-lamports__arrow">
                  →
                </span>

                <span
                  className={`acct-diff-lamports__after ${
                    (diff.lamportDelta ?? 0) > 0
                      ? "acct-diff-lamports__after--gained"
                      : "acct-diff-lamports__after--spent"
                  }`}
                >
                  {lamportsToSol(diff.lamportsAfter)}
                </span>
              </div>
            )}

          {diff.ownerAfter !== null &&
            diff.ownerBefore !== diff.ownerAfter && (
              <div className="acct-diff-owner">
                <span className="acct-diff-owner__label">
                  Owner
                </span>

                {diff.ownerBefore !== null && (
                  <>
                    <code>
                      {diff.ownerBefore.slice(0, 8)}…
                    </code>
                    <span>→</span>
                  </>
                )}

                <code>
                  {diff.ownerAfter.slice(0, 8)}…
                </code>
              </div>
            )}

          {beforeFields !== null &&
            afterFields !== null && (
              <div className="acct-diff-fields">
                {beforeFields.map((f) => {
                  const after = afterFields.find(
                    (a) => a.name === f.name
                  )

                  if (!after) return null

                  const beforeStr = formatDecodedValue(
                    f.value
                  )
                  const afterStr = formatDecodedValue(
                    after.value
                  )

                  if (beforeStr === afterStr) return null

                  return (
                    <div
                      key={f.name}
                      className="acct-diff-field-row"
                    >
                      <span className="acct-diff-field-name">
                        {f.name}
                      </span>

                      <span className="acct-diff-field-before">
                        {beforeStr}
                      </span>

                      <span>→</span>

                      <span className="acct-diff-field-after">
                        {afterStr}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}

          {beforeFields === null &&
            diff.dataChanged && (
              <div className="acct-diff-raw">
                <div>
                  Before:{" "}
                  {diff.rawDataBefore
                    ? diff.rawDataBefore.length
                    : 0}{" "}
                  bytes
                </div>

                <div>
                  After:{" "}
                  {diff.rawDataAfter
                    ? diff.rawDataAfter.length
                    : 0}{" "}
                  bytes
                </div>
              </div>
            )}
        </div>
      )}
    </div>
  )
}