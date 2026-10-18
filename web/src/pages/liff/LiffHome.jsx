import BrandMark from '../../components/BrandMark'

/** หน้าแรกของผู้เช่า (เปิดผ่าน LINE LIFF) — โครงไว้ก่อน จะทำจริงในขั้นที่ 8 */
export default function LiffHome() {
  return (
    <main className="min-h-dvh bg-leaf-50">
      <header className="border-b border-leaf-300/70 bg-leaf-100 px-4 py-3">
        <BrandMark compact />
      </header>
      <div className="mx-auto max-w-md px-4 py-8">
        <h1 className="text-xl font-semibold text-ink">สำหรับผู้เช่าแผง</h1>
        <p className="mt-2 text-muted">
          หน้านี้จะเปิดผ่าน LINE ของตลาด ใช้ดูแผนผังและจองแผง ดูใบแจ้งหนี้ แจ้งชำระเงิน และดูใบเสร็จ
        </p>
        <p className="mt-6 rounded-xl border border-dashed border-leaf-300 bg-white px-4 py-4 text-ink">
          ยังไม่พร้อมใช้งาน จะทำในขั้นที่ 8 (LINE Login)
        </p>
      </div>
    </main>
  )
}
