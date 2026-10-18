import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext(null)

/**
 * เก็บสถานะการเข้าสู่ระบบของเจ้าหน้าที่
 * - session  : ข้อมูลจาก Supabase Auth (undefined = กำลังตรวจ, null = ยังไม่ login)
 * - profile  : แถวของตัวเองในตาราง users (role, full_name, status)
 */
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  // ผลการโหลด profile ผูกกับ userId ที่โหลด → ถ้า userId เปลี่ยน ถือว่ายังไม่ได้โหลดของคนใหม่
  const [loaded, setLoaded] = useState({ userId: null, profile: null, error: null })
  // เพิ่มค่าเมื่อต้องการโหลด profile ใหม่ (เช่น แก้ชื่อตัวเองในหน้าผู้ใช้ระบบ) — ระหว่างโหลดยังใช้ข้อมูลเดิม
  const [profileRound, setProfileRound] = useState(0)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    // ห้ามเรียก supabase ใน callback นี้โดยตรง (ตามคำแนะนำของ Supabase) จึงแค่เก็บ session ไว้
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('users')
      .select('user_id, username, full_name, role, status, email')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!cancelled) setLoaded({ userId, profile: data ?? null, error: error ?? null })
      })
    return () => {
      cancelled = true
    }
  }, [userId, profileRound])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const refreshProfile = useCallback(() => setProfileRound((n) => n + 1), [])

  const value = useMemo(() => {
    const isCurrent = userId !== null && loaded.userId === userId
    const profile = isCurrent ? loaded.profile : null
    const profileError = isCurrent ? loaded.error : null
    const checking = session === undefined || (userId !== null && !isCurrent)
    const isActiveOfficer = profile?.status === 'active'

    let accessProblem = null
    if (!checking && session) {
      if (profileError) accessProblem = 'error'
      // login แล้วแต่ไม่มีแถวใน users = ไม่ใช่เจ้าหน้าที่ (เช่น บัญชีผู้เช่า)
      else if (!profile) accessProblem = 'not-officer'
      else if (!isActiveOfficer) accessProblem = 'inactive'
    }

    return {
      session,
      profile,
      role: isActiveOfficer ? profile.role : null,
      checking,
      accessProblem,
      profileError,
      signIn,
      signOut,
      refreshProfile,
    }
  }, [session, userId, loaded, signIn, signOut, refreshProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// oxlint-disable-next-line react/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องอยู่ภายใน <AuthProvider>')
  return ctx
}
