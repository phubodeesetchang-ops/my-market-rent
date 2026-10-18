import { STALL_STATUS } from '../lib/labels'
import { formatNumber } from '../lib/format'
import { stallTitle } from '../lib/stalls'

// สีช่องตามสถานะ (มีลายเส้นสำหรับซ่อมบำรุง ไม่ใช้สีอย่างเดียวบอกสถานะ)
const CELL_STATUS = {
  vacant: 'bg-white text-leaf-800 hover:bg-leaf-100',
  reserved: 'bg-stall-reserved text-stall-reserved-ink hover:bg-[#f8e0a3]',
  rented: 'bg-stall-rented text-white hover:bg-leaf-800',
  maintenance: 'bg-stall-maint text-stall-maint-ink stall-hatch hover:bg-[#dcdfda]',
}

// ขนาดช่องตามภาพผัง: แถวรายปีด้านบนเป็นช่องสูง ด้านล่างเป็นช่องกว้าง แผงรายเดือนเป็นช่องเล็ก
const CELL_SIZE = {
  small: 'h-10 w-10',
  tall: 'h-20 w-[3.25rem]',
  wide: 'h-[3.25rem] w-[4.125rem]', // 8 ช่องกว้าง ≈ 10 ช่องสูง → แถวบน-ล่างยาวเท่ากัน
}

/** ช่องแผงที่กดได้ */
function StallButton({ stall, size, onSelect }) {
  const number = String(Number(stall.stall_code.replace(/^\D+/, '')) || stall.stall_code)
  const label = `${stallTitle(stall)} ${STALL_STATUS[stall.status] ?? stall.status}`
  return (
    <button
      type="button"
      onClick={() => onSelect?.(stall.stall_id)}
      title={label}
      aria-label={label}
      data-stall={stall.stall_code}
      className={`flex items-center justify-center text-sm font-semibold tabular-nums transition-colors
        focus-visible:outline-[3px] focus-visible:-outline-offset-[5px] focus-visible:outline-[#F6C453] focus-visible:rounded-none
        ${CELL_SIZE[size]} ${CELL_STATUS[stall.status] ?? CELL_STATUS.vacant}`}
    >
      {number}
    </button>
  )
}

/**
 * กลุ่มแผงหนึ่งโซน วาดเป็นกรอบหนา เส้นแบ่งช่องบาง (เหมือนภาพผังที่วาดด้วยมือ)
 * shape 'strip' = แถวเดียว, 'grid' = กริดตามจำนวน cols
 */
export function StallBlock({ zone, shape = 'grid', cols = 10, cell = 'small', onSelect }) {
  const stalls = zone.stalls
  const columns = shape === 'strip' ? Math.max(stalls.length, 1) : cols
  // เติมช่องว่างให้แถวสุดท้ายเต็ม กรอบจะได้เป็นสี่เหลี่ยมเสมอ
  const fillers = stalls.length === 0 ? columns : (columns - (stalls.length % columns)) % columns

  return (
    <div
      className="inline-grid gap-[2px] rounded-[3px] border-[3px] border-ink bg-ink"
      style={{ gridTemplateColumns: `repeat(${columns}, auto)` }}
      role="group"
      aria-label={`โซน ${zone.zone_name}`}
    >
      {stalls.map((s) => (
        <StallButton key={s.stall_id} stall={s} size={cell} onSelect={onSelect} />
      ))}
      {Array.from({ length: fillers }, (_, i) => (
        <span key={`f${i}`} className={`${CELL_SIZE[cell]} bg-leaf-50`} aria-hidden="true" />
      ))}
    </div>
  )
}

const unitWord = (zone) => (zone.stalls[0]?.unit_type === 'room' ? 'ห้อง' : 'แผง')

// ตำแหน่งป้ายรอบกลุ่ม (ป้ายลอยอยู่นอกกรอบ ไม่ดันตำแหน่งกลุ่มอื่น)
const LABEL_POS = {
  'top-left': 'bottom-full left-0 mb-2 flex-col',
  'top-right': 'bottom-full right-0 mb-1.5 flex-row items-baseline gap-x-2.5',
  'bottom-left': 'top-full left-0 mt-1.5 flex-row items-baseline gap-x-2.5',
  right: 'left-full top-0 ml-5 flex-col',
}

/** ป้ายของกลุ่ม: ประเภทการเช่า (ตัวหนา) + ตลาด/โซน/จำนวน + ปุ่มเพิ่มแผง */
function BlockLabel({ market, zone, label, at = 'top-left', onAdd, adding }) {
  return (
    <div className={`absolute flex whitespace-nowrap leading-snug ${LABEL_POS[at]}`}>
      <span className="font-semibold text-ink">{label}</span>
      <span className="text-sm text-muted tabular-nums">
        {market.market_name} โซน {zone.zone_name}, {formatNumber(zone.stalls.length)} {unitWord(zone)}
      </span>
      {onAdd && (
        <button
          type="button"
          onClick={() => onAdd(market, zone)}
          disabled={adding}
          className="self-start text-sm font-medium text-leaf-700 hover:underline disabled:opacity-50"
        >
          {adding ? 'กำลังเพิ่ม…' : '+ เพิ่มแผง'}
        </button>
      )}
    </div>
  )
}

function MissingZone({ market, zone, style }) {
  return (
    <div style={style} className="self-start rounded-md border border-dashed border-leaf-300 px-4 py-3 text-sm text-muted">
      ไม่พบ {market} โซน {zone} ในฐานข้อมูล
    </div>
  )
}

/** ผังพื้นที่แบบกำหนดตำแหน่งด้วย grid-template-areas (เช่น ตลาดเย็น + อาคาร OTOP) */
export function SitePlan({ plan, zoneIndex, onSelect, onAdd, addingZoneId }) {
  return (
    <div
      data-plan={plan.key}
      className="grid min-w-max gap-y-6 pt-8 pb-10 pr-48"
      style={{
        gridTemplateColumns: plan.grid.columns,
        gridTemplateAreas: plan.grid.areas.map((r) => `"${r}"`).join(' '),
      }}
    >
      {plan.blocks.map((b) => {
        const style = { gridArea: b.area, ...b.style }
        const found = zoneIndex.get(`${b.market}|${b.zone}`)
        if (!found) return <MissingZone key={`${b.market}|${b.zone}`} market={b.market} zone={b.zone} style={style} />
        return (
          <div key={found.zone.zone_id} data-zone={`${b.market}|${b.zone}`} className="relative self-start justify-self-start" style={style}>
            <BlockLabel
              market={found.market}
              zone={found.zone}
              label={b.label}
              at={b.labelAt}
              onAdd={onAdd}
              adding={addingZoneId === found.zone.zone_id}
            />
            <StallBlock zone={found.zone} shape={b.shape} cols={b.cols} cell={b.cell} onSelect={onSelect} />
          </div>
        )
      })}
    </div>
  )
}

/** ผังแบบโซนละหนึ่งแถว (ตลาดเช้า และตลาด/โซนที่ไม่ได้กำหนดผังไว้) */
export function ZoneRowsPlan({ market, zones = market.zones, cols = 10, cell = 'small', onSelect, onAdd, addingZoneId }) {
  return (
    <div className="flex min-w-max flex-col gap-2.5">
      {zones.map((zone) => (
        <div key={zone.zone_id} data-zone={`${market.market_name}|${zone.zone_name}`} className="flex items-center gap-3">
          <div className="w-16 shrink-0 text-sm">
            <span className="text-muted">โซน </span>
            <span className="font-semibold text-ink">{zone.zone_name}</span>
          </div>
          <StallBlock zone={zone} shape="grid" cols={Math.max(cols, 1)} cell={cell} onSelect={onSelect} />
          {onAdd && (
            <button
              type="button"
              onClick={() => onAdd(market, zone)}
              disabled={addingZoneId === zone.zone_id}
              className="text-sm font-medium text-leaf-700 hover:underline disabled:opacity-50"
              aria-label={`เพิ่มแผงในโซน ${zone.zone_name}`}
            >
              {addingZoneId === zone.zone_id ? 'กำลังเพิ่ม…' : '+ เพิ่มแผง'}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
