/** โลโก้ระบบ: กริดแผงค้า 3×3 + ชื่อระบบ */
export function GridIcon({ className = 'size-8' }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2F7A3B" />
      <g fill="#E3F0E0">
        <rect x="6" y="6" width="5.5" height="5.5" rx="1" />
        <rect x="13.25" y="6" width="5.5" height="5.5" rx="1" />
        <rect x="20.5" y="6" width="5.5" height="5.5" rx="1" fill="#F6C453" />
        <rect x="6" y="13.25" width="5.5" height="5.5" rx="1" />
        <rect x="13.25" y="13.25" width="5.5" height="5.5" rx="1" fill="#2F7A3B" stroke="#E3F0E0" strokeWidth="1.2" />
        <rect x="20.5" y="13.25" width="5.5" height="5.5" rx="1" />
        <rect x="6" y="20.5" width="5.5" height="5.5" rx="1" />
        <rect x="13.25" y="20.5" width="5.5" height="5.5" rx="1" />
        <rect x="20.5" y="20.5" width="5.5" height="5.5" rx="1" />
      </g>
    </svg>
  )
}

export default function BrandMark({ className = '', compact = false }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <GridIcon />
      <div className="leading-tight">
        <div className="font-semibold text-leaf-800">แผงค้าตลาด</div>
        {!compact && <div className="whitespace-nowrap text-sm text-muted">ระบบบริหารแผงและค่าเช่า</div>}
      </div>
    </div>
  )
}
