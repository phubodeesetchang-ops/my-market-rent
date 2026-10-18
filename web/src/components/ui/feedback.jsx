// หัวหน้า, แถบแจ้งผล, ป้ายสถานะ, ตาราง — ใช้ร่วมกันในหน้าจัดการข้อมูล
import { CONTRACT_STATUS } from '../../lib/labels'

/** หัวหน้า: ชื่อหน้า + คำอธิบาย + ปุ่มด้านขวา */
export function PageHeader({ title, description, actions }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description && <p className="text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  )
}

/** แถบแจ้งผลหลังทำรายการ (tone: ok | error) */
export function Notice({ notice, onClose }) {
  if (!notice) return null
  const error = notice.tone === 'error'
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`mt-5 flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 ${
        error ? 'bg-danger-bg text-danger' : 'bg-leaf-100 text-leaf-800'
      }`}
    >
      <span>{notice.text}</span>
      {onClose && (
        <button type="button" onClick={onClose} className="shrink-0 text-sm font-medium hover:underline">
          ปิด
        </button>
      )}
    </div>
  )
}

/** โหลดไม่สำเร็จ + ปุ่มลองใหม่ */
export function LoadError({ what, message, onRetry }) {
  return (
    <div role="alert" className="mt-6 rounded-lg bg-danger-bg px-4 py-3 text-danger">
      <p>
        โหลด{what}ไม่สำเร็จ: {message}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-semibold underline">
          ลองโหลดใหม่
        </button>
      )}
    </div>
  )
}

const TONE = {
  green: 'border-leaf-300 bg-leaf-100 text-leaf-800',
  solid: 'border-leaf-700 bg-leaf-700 text-white',
  amber: 'border-[#e7c56f] bg-stall-reserved text-stall-reserved-ink',
  gray: 'border-[#c9cfc6] bg-stall-maint text-stall-maint-ink',
  red: 'border-[#f4c7c1] bg-danger-bg text-danger',
  outline: 'border-leaf-300 bg-white text-leaf-800',
}

export function Badge({ tone = 'green', children, className = '' }) {
  return (
    <span className={`inline-block rounded-full border px-2.5 py-0.5 text-sm font-medium whitespace-nowrap ${TONE[tone]} ${className}`}>
      {children}
    </span>
  )
}

/** ใช้งาน / ระงับ */
export function ActiveBadge({ status, inactiveLabel = 'ระงับ' }) {
  return status === 'active' ? <Badge tone="green">ใช้งาน</Badge> : <Badge tone="gray">{inactiveLabel}</Badge>
}

const CONTRACT_TONE = { pending: 'amber', active: 'solid', expired: 'gray', cancelled: 'gray', rejected: 'red' }

export function ContractStatusBadge({ status }) {
  return <Badge tone={CONTRACT_TONE[status] ?? 'gray'}>{CONTRACT_STATUS[status] ?? status}</Badge>
}

/** กรอบตาราง: เลื่อนแนวนอนได้ในกรอบเมื่อจอแคบ */
export function DataTable({ label, children, className = '' }) {
  return (
    <div className={`overflow-x-auto rounded-xl border border-line ${className}`}>
      <table className="w-full min-w-max border-collapse text-left" aria-label={label}>
        {children}
      </table>
    </div>
  )
}

export function Th({ children, className = '' }) {
  return (
    <th scope="col" className={`border-b border-line bg-leaf-50 px-4 py-2.5 text-sm font-semibold text-muted ${className}`}>
      {children}
    </th>
  )
}

export function Td({ children, className = '' }) {
  return <td className={`border-b border-line px-4 py-2.5 align-top ${className}`}>{children}</td>
}

/** กล่องข้อความเมื่อไม่มีข้อมูล */
export function EmptyBox({ children }) {
  return <div className="rounded-xl border border-dashed border-leaf-300 bg-leaf-50 px-5 py-6 text-muted">{children}</div>
}
