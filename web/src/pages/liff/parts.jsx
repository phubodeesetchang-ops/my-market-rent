// ชิ้นส่วนที่ใช้ร่วมกันในหน้าผู้เช่า (LIFF)
import { Link } from 'react-router-dom'
import { Badge } from '../../components/ui/feedback'
import { invoiceState } from '../../lib/tenantView'

export function Card({ children, className = '', as: Tag = 'section', ...props }) {
  return (
    <Tag className={`rounded-2xl border border-line bg-white p-4 ${className}`} {...props}>
      {children}
    </Tag>
  )
}

export function SectionTitle({ children, aside }) {
  return (
    <div className="mt-6 mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-lg font-semibold text-ink">{children}</h2>
      {aside}
    </div>
  )
}

export function BackLink({ to, children = 'กลับ' }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 py-1 font-medium text-leaf-700">
      <span aria-hidden="true">‹</span> {children}
    </Link>
  )
}

export function PageTitle({ children, sub }) {
  return (
    <div className="mb-3">
      <h1 className="text-xl font-semibold text-ink">{children}</h1>
      {sub && <p className="text-muted">{sub}</p>}
    </div>
  )
}

export function Loading({ rows = 3 }) {
  return (
    <div className="space-y-3" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-leaf-100" />
      ))}
    </div>
  )
}

export function ErrorBox({ message, onRetry }) {
  return (
    <div role="alert" className="rounded-2xl bg-danger-bg px-4 py-3 text-danger">
      <p>{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-1 font-semibold underline">
          ลองใหม่
        </button>
      )}
    </div>
  )
}

const INVOICE_BADGE = {
  paid: ['green', 'ชำระแล้ว'],
  checking: ['amber', 'รอตรวจสอบ'],
  overdue: ['red', 'เกินกำหนด'],
  partial: ['outline', 'ชำระบางส่วน'],
  unpaid: ['outline', 'รอชำระ'],
  cancelled: ['gray', 'ยกเลิก'],
}

export function InvoiceBadge({ invoice }) {
  const [tone, text] = INVOICE_BADGE[invoiceState(invoice)]
  return <Badge tone={tone}>{text}</Badge>
}
