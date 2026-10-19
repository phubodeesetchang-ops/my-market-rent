import { MATERIAL_SYMBOLS } from '../../lib/materialSymbols'

/**
 * ไอคอน Google Material Symbols (Rounded) แบบ SVG ในตัว
 * name = ชื่อไอคอนตาม fonts.google.com/icons เช่น 'receipt_long' · fill = แบบทึบ (ถ้ามี)
 * ไอคอนประกอบข้อความ จึงซ่อนจากโปรแกรมอ่านหน้าจอ (aria-hidden)
 */
export default function MaterialIcon({ name, fill = false, className = 'size-5', style }) {
  const d = (fill && MATERIAL_SYMBOLS[`${name}_fill`]) || MATERIAL_SYMBOLS[name]
  if (!d) return null
  return (
    <svg viewBox="0 -960 960 960" className={`shrink-0 ${className}`} style={style} fill="currentColor" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}
