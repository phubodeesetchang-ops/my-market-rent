import { useCallback, useEffect, useRef, useState } from 'react'
import { thaiError } from './errors'

/**
 * โหลดข้อมูลแบบ async สำหรับหน้าจัดการข้อมูล
 * - key  : เปลี่ยนเมื่อไหร่โหลดใหม่ (เช่น id ที่เลือก)
 * - ระหว่างโหลดใหม่ยังแสดงข้อมูลเดิมไว้ ไม่ให้หน้ากระพริบ
 * คืนค่า { data, error, loading, reload }
 */
export function useLoader(load, key = '') {
  const [round, setRound] = useState(0)
  const fullKey = `${key}#${round}`
  const [state, setState] = useState({ key: null, data: null, error: null })
  // เก็บฟังก์ชันล่าสุดไว้ใน ref: ฟังก์ชัน load ถูกสร้างใหม่ทุก render จึงใช้ key เป็นตัวบอกว่าต้องโหลดใหม่
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  })

  useEffect(() => {
    let cancelled = false
    loadRef.current().then(
      (data) => !cancelled && setState({ key: fullKey, data, error: null }),
      (e) => !cancelled && setState((prev) => ({ key: fullKey, data: prev.data, error: thaiError(e) })),
    )
    return () => {
      cancelled = true
    }
  }, [fullKey])

  const reload = useCallback(() => setRound((n) => n + 1), [])
  return { data: state.data, error: state.error, loading: state.key !== fullKey, reload }
}
