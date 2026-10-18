import { formatNumber } from '../../lib/format'
import { Badge } from '../ui/feedback'

/** ป้ายสถานะเวลาของสัญญาที่ใช้งาน: เหลือ/เลยกำหนด/ยังไม่เริ่ม */
export function TimingBadge({ timing }) {
  if (!timing) return null
  if (timing.kind === 'overdue') return <Badge tone="red">เลยวันสิ้นสุด {formatNumber(timing.days)} วัน</Badge>
  if (timing.kind === 'expiring') return <Badge tone="amber">{timing.days === 0 ? 'หมดวันนี้' : `เหลือ ${formatNumber(timing.days)} วัน`}</Badge>
  if (timing.kind === 'upcoming') return <Badge tone="outline">เริ่มอีก {formatNumber(timing.days)} วัน</Badge>
  return null
}
