// ผังพื้นที่ของแต่ละตลาด — กำหนดแค่ "ตำแหน่ง" และ "รูปทรง" ของแต่ละโซน
// จำนวนช่องอ่านจากฐานข้อมูลจริง (เพิ่ม/ลบแผงแล้วผังขยาย/หดเอง)
//
// อ้างอิงโซนด้วยชื่อตลาด + ชื่อโซน ให้ตรงกับตาราง markets / zones
// โซนหรือตลาดที่ไม่ได้อยู่ในไฟล์นี้ จะแสดงต่อท้ายเป็นผังแบบแถวทั่วไปอัตโนมัติ
//
// grid:    วางกลุ่มด้วย CSS grid-template-areas (ตำแหน่งตามภาพผังจริง)
// shape:   'strip' = แถวเดียวยาว (จำนวนคอลัมน์ = จำนวนแผง)
//          'grid'  = กริด กำหนดจำนวนคอลัมน์ด้วย cols (แถวเพิ่มเองตามจำนวนแผง)
// cell:    'tall' ช่องสูง, 'wide' ช่องกว้าง (แผงรายปี), 'small' ช่องเล็ก (แผงรายเดือน)
// label:   ป้ายประเภทการเช่า (ตัวหนา) — ตำแหน่งตาม labelAt: 'top-left' | 'top-right' | 'bottom-left' | 'right'

export const SITE_PLANS = [
  {
    key: 'evening-otop',
    title: 'ผังพื้นที่ตลาดเย็น และอาคาร OTOP',
    // ตามภาพผัง:
    //   แถวบน (รายปี) เริ่มตรงขอบซ้ายของกริดใหญ่ ยาวไปทางขวา
    //   กริดเล็ก (รายเดือน) อยู่ซ้าย ระดับช่วงบนของกริดใหญ่ · กริดใหญ่ (รายเดือน) ติดกันทางขวา
    //   แถวล่าง (รายปี) เริ่มแนวเดียวกับแถวบน
    grid: {
      columns: 'auto auto 1fr',
      areas: ['.      top    top', 'small  big    .', '.      bottom bottom'],
    },
    blocks: [
      { area: 'top', market: 'อาคาร OTOP', zone: 'A', shape: 'strip', cell: 'tall', label: 'แผงเช่ารายปี', labelAt: 'top-right', style: { marginLeft: '-1rem' } },
      { area: 'small', market: 'ตลาดเย็น', zone: 'A', shape: 'grid', cols: 4, cell: 'small', label: 'แผงเช่ารายเดือน', labelAt: 'top-left', style: { marginTop: '4.5rem', marginRight: '1rem' } },
      { area: 'big', market: 'ตลาดเย็น', zone: 'B', shape: 'grid', cols: 5, cell: 'small', label: 'แผงเช่ารายเดือน', labelAt: 'right' },
      { area: 'bottom', market: 'อาคาร OTOP', zone: 'B', shape: 'strip', cell: 'wide', label: 'แผงเช่ารายปี', labelAt: 'bottom-left', style: { marginLeft: '-1rem' } },
    ],
  },
  {
    key: 'morning',
    title: 'ตลาดเช้า',
    // คงผังเดิม: โซนละหนึ่งแถว แถวละ 10 แผง
    zoneRows: { market: 'ตลาดเช้า', cols: 10, cell: 'small' },
  },
]

/** ตลาด (และโซน) นี้ถูกวางในผังพื้นที่หรือไม่ — ใช้เตือนก่อนเปลี่ยนชื่อ เพราะผังอ้างอิงด้วยชื่อ */
export function isPlaced(marketName, zoneName) {
  return SITE_PLANS.some((plan) =>
    plan.blocks
      ? plan.blocks.some((b) => b.market === marketName && (zoneName === undefined || b.zone === zoneName))
      : plan.zoneRows?.market === marketName && zoneName === undefined,
  )
}
