import BrandMark from './BrandMark'

/** หน้าข้อความเต็มจอ ใช้ตอนกำลังโหลด / ไม่มีสิทธิ์ / ยังไม่ได้ตั้งค่า */
export default function FullPageMessage({ title, body, children }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-leaf-50 px-4 py-10">
      <div className="w-full max-w-md">
        <BrandMark className="mb-6" />
        <h1 className="text-xl font-semibold text-ink" aria-live="polite">{title}</h1>
        {body && <div className="mt-2 text-muted">{body}</div>}
        {children && <div className="mt-6 flex flex-wrap gap-3">{children}</div>}
      </div>
    </main>
  )
}
