import FullPageMessage from '../components/FullPageMessage'

/** แสดงเมื่อยังไม่ได้สร้างไฟล์ .env (ยังเชื่อม Supabase ไม่ได้) */
export default function SetupNeeded() {
  return (
    <FullPageMessage
      title="ยังไม่ได้ตั้งค่าการเชื่อมต่อ Supabase"
      body={
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>คัดลอกไฟล์ <code className="rounded bg-leaf-100 px-1">web/.env.example</code> เป็น <code className="rounded bg-leaf-100 px-1">web/.env</code></li>
          <li>ใส่ Project URL และ publishable key จาก Supabase Dashboard (Project Settings → API Keys)</li>
          <li>หยุดแล้วสั่ง <code className="rounded bg-leaf-100 px-1">npm run dev</code> ใหม่</li>
        </ol>
      }
    />
  )
}
