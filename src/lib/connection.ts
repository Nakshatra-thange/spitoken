import { Connection } from "@solana/web3.js"

// Use env variable if set, fall back to public devnet for dev
const RPC_ENDPOINT =
  (import.meta as { env?: Record<string, string> }).env?.["VITE_RPC_ENDPOINT"] ??
  "https://api.devnet.solana.com"

// Singleton connection — reused across the app
let _connection: Connection | null = null

export function getConnection(): Connection {
  if (_connection === null) {
    _connection = new Connection(RPC_ENDPOINT, "confirmed")
  }
  return _connection
}

export function setRpcEndpoint(endpoint: string): void {
  _connection = new Connection(endpoint, "confirmed")
}

export { RPC_ENDPOINT }