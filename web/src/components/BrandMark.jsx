/** โลโก้ระบบ: หลังคาผ้าใบลายทาง + แผงค้า (สีตามสถานะแผง) — แบบเดียวกับ favicon */
export function GridIcon({ className = 'size-8', style }) {
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} aria-hidden="true">
      <rect width="32" height="32" rx="7" fill="#2F7A3B" />
      <rect x="5" y="6" width="22" height="2" rx="1" fill="#245F2E" />
      <path d="M6 7.5H12.67V11.5A3.33 2 0 0 1 6 11.5Z" fill="#F2F8F1" />
      <path d="M12.67 7.5H19.33V11.5A3.33 2 0 0 1 12.67 11.5Z" fill="#F6C453" />
      <path d="M19.33 7.5H26V11.5A3.33 2 0 0 1 19.33 11.5Z" fill="#F2F8F1" />
      <rect x="7" y="16" width="8" height="5.5" rx="1.2" fill="#E3F0E0" />
      <rect x="17" y="16" width="8" height="5.5" rx="1.2" fill="#F6C453" />
      <rect x="7" y="23" width="8" height="5" rx="1.2" fill="#E3F0E0" />
      <rect x="17.6" y="23.6" width="6.8" height="3.8" rx="1" fill="#2F7A3B" stroke="#E3F0E0" strokeWidth="1.2" />
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
