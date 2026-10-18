import { STALL_STATUS, STALL_STATUS_ORDER } from '../lib/labels'
import { formatNumber } from '../lib/format'

// รูปแบบช่องแผงตามสถานะ (มีทั้งสี ลวดลาย และเส้นขอบ — ไม่ใช้สีอย่างเดียวบอกสถานะ)
const CELL_STYLE = {
  vacant: 'bg-stall-vacant text-leaf-800 border-leaf-300',
  reserved: 'bg-stall-reserved text-stall-reserved-ink border-[#e7c56f]',
  rented: 'bg-stall-rented text-white border-stall-rented',
  maintenance: 'bg-stall-maint text-stall-maint-ink border-[#c9cfc6] stall-hatch',
}

/** ช่องแผงหนึ่งช่อง: แสดงเลขลำดับในโซน (A001 → 1) ส่วนรหัสเต็มอยู่ใน tooltip และ screen reader */
export function StallCell({ code, status, size = 'md', showCode = true }) {
  const digits = code?.replace(/^\D+/, '') ?? ''
  const number = digits ? String(Number(digits)) : ''
  const sizes = {
    sm: 'h-5 w-5 text-[0px]',
    // มือถือ 28px (แถวละ 10 ช่องพอดีจอ 360px), จอใหญ่ 36px
    md: 'h-7 min-w-7 text-[11px] sm:h-9 sm:min-w-9 sm:text-xs',
  }
  return (
    <span
      className={`inline-flex items-center justify-center rounded-[4px] border font-medium tabular-nums ${sizes[size]} ${CELL_STYLE[status] ?? CELL_STYLE.vacant}`}
      title={code ? `${code} ${STALL_STATUS[status] ?? status}` : undefined}
    >
      {showCode && size !== 'sm' ? number : null}
      {code && <span className="sr-only">{`${code} ${STALL_STATUS[status] ?? status}`}</span>}
    </span>
  )
}

/** ป้ายสถานะแผง (สี/ลายเดียวกับช่องในผัง) */
export function StallStatusBadge({ status }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ${CELL_STYLE[status] ?? CELL_STYLE.vacant}`}>
      {STALL_STATUS[status] ?? status}
    </span>
  )
}

/** คำอธิบายสี พร้อมจำนวนแผงแต่ละสถานะ */
export function StatusLegend({ counts, className = '' }) {
  return (
    <ul className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${className}`}>
      {STALL_STATUS_ORDER.map((status) => (
        <li key={status} className="flex items-center gap-2">
          <span className={`inline-block h-4 w-4 rounded-[3px] border ${CELL_STYLE[status]}`} aria-hidden="true" />
          <span className="text-muted">{STALL_STATUS[status]}</span>
          {counts && <span className="font-semibold text-ink tabular-nums">{formatNumber(counts[status] ?? 0)}</span>}
        </li>
      ))}
    </ul>
  )
}
