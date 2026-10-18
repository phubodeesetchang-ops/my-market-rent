import { UNIT_TYPE } from './labels'

/** นับจำนวนแผงแยกตามสถานะ */
export function countByStatus(stalls) {
  const counts = { vacant: 0, reserved: 0, rented: 0, maintenance: 0 }
  for (const s of stalls) counts[s.status] = (counts[s.status] ?? 0) + 1
  return counts
}

/** ดัชนีโซน: 'ชื่อตลาด|ชื่อโซน' → { market, zone } */
export function indexZones(markets) {
  const index = new Map()
  for (const market of markets) {
    for (const zone of market.zones) index.set(`${market.market_name}|${zone.zone_name}`, { market, zone })
  }
  return index
}

/** หาแผงจากรหัส พร้อมตลาดและโซนที่อยู่ */
export function findStall(markets, stallId) {
  for (const market of markets) {
    for (const zone of market.zones) {
      const stall = zone.stalls.find((s) => s.stall_id === stallId)
      if (stall) return { market, zone, stall }
    }
  }
  return null
}

/** ค่าเริ่มต้นของแผงใหม่ในโซน: ใช้ค่าเดียวกับแผงล่าสุดในโซน ถ้าโซนว่างใช้ค่าตามประเภทตลาด */
export function newStallDefaults(market, zone) {
  const last = zone.stalls.at(-1)
  if (last) {
    return { unit_type: last.unit_type, base_rent: last.base_rent, rent_period: last.rent_period, size: last.size, size_unit: last.size_unit }
  }
  return market.market_type === 'building'
    ? { unit_type: 'room', base_rent: null, rent_period: 'yearly' }
    : { unit_type: 'stall', base_rent: 150, rent_period: 'monthly' }
}

/** ชื่อเรียกแผง เช่น "แผง A001" / "ห้อง B003" */
export function stallTitle(stall) {
  return `${UNIT_TYPE[stall.unit_type] ?? 'แผง'} ${stall.stall_code}`
}

/** ชื่อแผงพร้อมตลาด จากข้อมูลที่ embed มา stalls(stall_code, unit_type, zones(zone_name, markets(market_name))) */
export function stallPlace(stall) {
  if (!stall) return '-'
  const market = stall.zones?.markets?.market_name
  return market ? `${market} ${stallTitle(stall)}` : stallTitle(stall)
}

/** รหัสแผงถัดไปของโซน (ตรงกับที่ฐานข้อมูลตั้งให้เมื่อไม่ระบุรหัส: ชื่อโซน + เลข 3 หลัก) */
export function nextStallCode(zone) {
  const max = Math.max(0, ...zone.stalls.map((s) => Number(/(\d+)$/.exec(s.stall_code)?.[1] ?? 0)))
  return `${zone.zone_name}${String(max + 1).padStart(3, '0')}`
}
