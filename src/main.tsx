import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Buffer } from "buffer"
import { SolanaWalletProvider } from './solana/wallet';
import App from './App';
(window as any).Buffer = Buffer

window.process = window.process || { env: {} } as any;
createRoot(document.getElementById('root')!).render(
  <StrictMode>
  <SolanaWalletProvider>
  
    <App />
    </SolanaWalletProvider>
  </StrictMode>
 
)
