import { GridIcon } from './BrandMark'

/** วงแหวนหมุนรอบไอคอนระบบ — size เป็น px */
export function LoadingMark({ size = 96 }) {
  const icon = Math.round(size * 0.52)
  return (
    <span className="relative inline-block" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 96 96" className="absolute inset-0 size-full animate-spin [animation-duration:1.1s]">
        <circle cx="48" cy="48" r="43" fill="none" stroke="#cde5c7" strokeWidth="5" />
        <circle cx="48" cy="48" r="43" fill="none" stroke="#2f7a3b" strokeWidth="5" strokeLinecap="round" strokeDasharray="70 200" />
      </svg>
      <GridIcon className="absolute inset-0 m-auto" style={{ width: icon, height: icon }} />
    </span>
  )
}

/** หน้ารอโหลดเต็มจอ (ก่อนเข้าระบบ / ระหว่างตรวจสิทธิ์ / ระหว่างเปิดหน้า) */
export default function LoadingScreen({ label = 'กำลังเปิด…' }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-leaf-50 px-6" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-4 text-center">
        <LoadingMark />
        <p className="text-muted">{label}</p>
      </div>
    </main>
  )
}
