import { STALL_STATUS } from '../lib/labels'
import { formatNumber } from '../lib/format'
import { stallTitle } from '../lib/stalls'

// ขนาดช่อง (--u กว้าง, --room สูงของห้อง) และช่องไฟ (--g) — ทุกโซนในผังใช้ค่าเดียวกัน จึงตรงแนวกันเสมอ
const SCOPE = {
  md: { '--u': '44px', '--g': '6px', '--room': '60px' },
  // มือถือ: 8 ช่องต่อแถวพอดีจอ (หักขอบหน้า 32px + ขอบการ์ด 26px + ช่องไฟ 7 × 5px)
  sm: { '--u': 'min(38px, calc((100vw - 93px) / 8))', '--g': '5px', '--room': 'calc(min(38px, calc((100vw - 93px) / 8)) * 1.35)' },
}

// สีช่องตามสถานะ (ซ่อมบำรุงมีลายเส้น ไม่ใช้สีอย่างเดียวบอกสถานะ)
const CELL_STATUS = {
  vacant: 'bg-white text-leaf-800 ring-1 ring-inset ring-leaf-300 hover:bg-leaf-50',
  reserved: 'bg-stall-reserved text-stall-reserved-ink ring-1 ring-inset ring-[#e7c56f] hover:bg-[#f8e0a3]',
  rented: 'bg-stall-rented text-white hover:bg-leaf-800',
  maintenance: 'bg-stall-maint text-stall-maint-ink stall-hatch ring-1 ring-inset ring-[#c9cfc6] hover:bg-[#dcdfda]',
}

const cellHeight = (cell) => (cell === 'room' ? 'h-[var(--room)]' : 'h-[var(--u)]')
const unitWord = (zone) => (zone.stalls[0]?.unit_type === 'room' ? 'ห้อง' : 'แผง')

/** ช่องแผงที่กดได้ */
function StallButton({ stall, cell, onSelect }) {
  const number = String(Number(stall.stall_code.replace(/^\D+/, '')) || stall.stall_code)
  const label = `${stallTitle(stall)} ${STALL_STATUS[stall.status] ?? stall.status}`
  return (
    <button
      type="button"
      onClick={() => onSelect?.(stall.stall_id)}
      title={label}
      aria-label={label}
      data-stall={stall.stall_code}
      className={`flex w-[var(--u)] items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition-colors
        focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[#F6C453]
        ${cellHeight(cell)} ${CELL_STATUS[stall.status] ?? CELL_STATUS.vacant}`}
    >
      {number}
    </button>
  )
}

/** ปุ่มเพิ่มแผงของโซน (แผงใหม่ต่อท้ายแถวตรงแนวเดิม) */
function AddButton({ zone, onAdd, adding, className = '' }) {
  return (
    <button
      type="button"
      onClick={onAdd}
      disabled={adding}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-leaf-700 hover:bg-leaf-100 disabled:opacity-60 ${className}`}
    >
      {adding ? 'กำลังเพิ่ม…' : `+ เพิ่ม${unitWord(zone)}`}
      <span className="sr-only"> ในโซน {zone.zone_name}</span>
    </button>
  )
}

/**
 * แผงของโซนหนึ่ง เรียงเป็นกริด cols ช่องต่อแถว (เกินแล้วขึ้นแถวใหม่ตรงแนวเดิม)
 * size: 'md' จอใหญ่ · 'sm' มือถือ
 */
export function StallBlock({ zone, cols = 10, cell = 'stall', size = 'md', onSelect }) {
  const columns = Math.max(1, cols)
  return (
    <div
      role="group"
      aria-label={`โซน ${zone.zone_name}`}
      className="grid w-max gap-[var(--g)]"
      style={{ ...SCOPE[size], gridTemplateColumns: `repeat(${columns}, var(--u))` }}
    >
      {zone.stalls.map((s) => (
        <StallButton key={s.stall_id} stall={s} cell={cell} onSelect={onSelect} />
      ))}
      {zone.stalls.length === 0 && (
        <span className={`col-span-full flex items-center rounded-lg border border-dashed border-line px-3 text-sm text-muted ${cellHeight(cell)}`}>
          ยังไม่มี{unitWord(zone)}
        </span>
      )}
    </div>
  )
}

function zoneCounts(zone) {
  const vacant = zone.stalls.filter((s) => s.status === 'vacant').length
  return `${formatNumber(zone.stalls.length)} ${unitWord(zone)} · ว่าง ${formatNumber(vacant)}`
}

/** ป้ายของโซน 2 บรรทัดเสมอ (โซนที่อยู่แถวเดียวกันจึงเริ่มช่องที่ความสูงเดียวกัน) */
function BlockLabel({ market, zone, label, onAdd, adding }) {
  return (
    <div className="mb-2 leading-snug whitespace-nowrap">
      <p className="flex h-7 items-center gap-2">
        <span className="shrink-0 font-semibold text-ink">{label}</span>
        {onAdd && <AddButton zone={zone} onAdd={onAdd} adding={adding} className="shrink-0" />}
      </p>
      <p className="text-sm text-muted tabular-nums">
        {market.market_name} โซน {zone.zone_name} · {zoneCounts(zone)}
      </p>
    </div>
  )
}

function MissingZone({ market, zone, style }) {
  return (
    <div style={style} className="self-start rounded-lg border border-dashed border-leaf-300 px-4 py-3 text-sm text-muted">
      ไม่พบ {market} โซน {zone} ในฐานข้อมูล
    </div>
  )
}

/** ผังพื้นที่แบบกำหนดตำแหน่งบนกริดคอลัมน์เท่ากัน (เช่น ตลาดเย็น + อาคาร OTOP) */
export function SitePlan({ plan, zoneIndex, onSelect, onAdd, addingZoneId }) {
  return (
    <div
      data-plan={plan.key}
      className="grid w-max gap-y-7 pb-2"
      style={{ ...SCOPE.md, gridTemplateColumns: `repeat(${plan.columns}, calc(var(--u) + var(--g)))` }}
    >
      {plan.blocks.map((b) => {
        const style = { gridColumn: `${b.col} / span ${b.cols}`, gridRow: b.row }
        const found = zoneIndex.get(`${b.market}|${b.zone}`)
        if (!found) return <MissingZone key={`${b.market}|${b.zone}`} market={b.market} zone={b.zone} style={style} />
        return (
          <div key={found.zone.zone_id} data-zone={`${b.market}|${b.zone}`} className="min-w-0 self-start" style={style}>
            <BlockLabel
              market={found.market}
              zone={found.zone}
              label={b.label}
              onAdd={onAdd ? () => onAdd(found.market, found.zone) : undefined}
              adding={addingZoneId === found.zone.zone_id}
            />
            <StallBlock zone={found.zone} cols={b.cols} cell={b.cell} onSelect={onSelect} />
          </div>
        )
      })}
    </div>
  )
}

/** ผังแบบโซนละแถว (ตลาดเช้า และตลาด/โซนที่ไม่ได้กำหนดผังไว้) — ทุกโซนเริ่มคอลัมน์เดียวกัน */
export function ZoneRowsPlan({ market, zones = market.zones, cols = 10, cell = 'stall', onSelect, onAdd, addingZoneId }) {
  return (
    <div className="grid w-max grid-cols-[7.5rem_auto] items-start gap-x-3 gap-y-3" style={SCOPE.md}>
      {zones.map((zone) => (
        <div key={zone.zone_id} data-zone={`${market.market_name}|${zone.zone_name}`} className="contents">
          <div className="leading-tight">
            <p className="whitespace-nowrap">
              <span className="text-sm text-muted">โซน </span>
              <span className="font-semibold text-ink">{zone.zone_name}</span>
              <span className="text-sm text-muted tabular-nums"> · ว่าง {formatNumber(zone.stalls.filter((s) => s.status === 'vacant').length)}</span>
            </p>
            {onAdd && <AddButton zone={zone} onAdd={() => onAdd(market, zone)} adding={addingZoneId === zone.zone_id} className="-ml-1.5 mt-0.5" />}
          </div>
          <StallBlock zone={zone} cols={cols} cell={cell} onSelect={onSelect} />
        </div>
      ))}
    </div>
  )
}

/**
 * ผังสำหรับมือถือ: โซนละการ์ด แถวละ 8 ช่อง (ทุกการ์ดตรงแนวเดียวกัน)
 * items: [{ market, zone, label?, cell? }]
 */
export function ZoneStack({ items, cols = 8, onSelect, onAdd, addingZoneId }) {
  return (
    <div className="space-y-3">
      {items.map(({ market, zone, label, cell }) => (
        <section
          key={zone.zone_id}
          data-zone={`${market.market_name}|${zone.zone_name}`}
          className="rounded-xl border border-line bg-white px-3 pt-2.5 pb-3"
        >
          <div className="mb-2 flex items-start justify-between gap-3">
            <div className="min-w-0 leading-snug">
              <h3 className="font-semibold text-ink">
                {market.market_name} โซน {zone.zone_name}
              </h3>
              <p className="text-sm text-muted tabular-nums">
                {label ? `${label} · ` : ''}
                {zoneCounts(zone)}
              </p>
            </div>
            {onAdd && <AddButton zone={zone} onAdd={() => onAdd(market, zone)} adding={addingZoneId === zone.zone_id} className="mt-0.5 shrink-0" />}
          </div>
          <StallBlock
            zone={zone}
            cols={cols}
            cell={cell ?? (zone.stalls[0]?.unit_type === 'room' ? 'room' : 'stall')}
            size="sm"
            onSelect={onSelect}
          />
        </section>
      ))}
    </div>
  )
}
