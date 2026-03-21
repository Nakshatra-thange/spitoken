import { useState } from "react"
import { useBuilderStore } from "../../store/builderStore"
import { type AccountSlot } from "../../types/idl"
interface NativeAccount {
  address: string
  isSigner: boolean
  isWritable: boolean
}

function nativeToAccountSlot(acc: NativeAccount): AccountSlot {
  return {
    name: acc.address.slice(0, 6) || "account",
    isMut: acc.isWritable,
    isSigner: acc.isSigner,
    isOptional: false,
    pda: null,
    docs: [],
  }
}



export function NativeBuilder() {
  const [programId, setProgramId] = useState("")
  const [accounts, setAccounts] = useState<NativeAccount[]>([])
  const [data, setData] = useState("")
  const { addInstruction } = useBuilderStore()
  const addAccount = () => {
    setAccounts((prev) => [
      ...prev,
      { address: "", isSigner: false, isWritable: false },
    ])
  }

  const updateAccount = (
    i: number,
    field: keyof NativeAccount,
    value: string | boolean
  ) => {
    setAccounts((prev) => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      return next
    })
  }

  

  return (

    
    <div className="native-builder">
      <h3>Manual Instruction</h3>

      <input
        placeholder="Program ID"
        value={programId}
        onChange={(e) => setProgramId(e.target.value)}
      />
      

      <div>
        <h4>Accounts</h4>
        {accounts.map((acc, i) => (
          <div key={i} className="native-account-row">
            <input
              placeholder="Address"
              value={acc.address}
              onChange={(e) => updateAccount(i, "address", e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={acc.isSigner}
                onChange={(e) => updateAccount(i, "isSigner", e.target.checked)}
              />
              Signer
            </label>
            <label>
              <input
                type="checkbox"
                checked={acc.isWritable}
                onChange={(e) => updateAccount(i, "isWritable", e.target.checked)}
              />
              Writable
            </label>
          </div>
        ))}

        <button onClick={addAccount}>+ Add Account</button>
        
      </div>

      <textarea
        placeholder="Instruction data (hex)"
        value={data}
        onChange={(e) => setData(e.target.value)}
      />

<button
  onClick={() => {
    addInstruction({
      name: `native_${programId.slice(0, 6) || "instruction"}`,
      discriminator: new Uint8Array(),
      accounts: accounts.map(nativeToAccountSlot),
      args: [],
      docs: data.trim() ? [`raw_data_hex:${data.trim()}`] : [],
      returns: null,
    })
  }}
>
  Add Instruction
</button>
    </div>
  )
}