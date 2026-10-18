import { createContext, useContext } from 'react'

/** ข้อมูลของผู้เช่าที่เข้าผ่าน LINE: { tenant, line, client, refreshTenant, signOut } */
export const LiffContext = createContext(null)

export function useLiff() {
  const ctx = useContext(LiffContext)
  if (!ctx) throw new Error('useLiff ต้องอยู่ภายในหน้า /liff')
  return ctx
}
