import { Link } from 'react-router-dom'

/** หน้าที่ยังไม่ได้ทำ — บอกว่าจะทำในขั้นไหนของแผนงาน */
export default function UpcomingPage({ title, step, detail }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <div className="mt-6 rounded-xl border border-dashed border-leaf-300 bg-leaf-50 px-5 py-6">
        <p className="font-medium text-ink">หน้านี้ยังไม่พร้อมใช้งาน จะทำในขั้นที่ {step}</p>
        {detail && <p className="mt-1 text-muted">{detail}</p>}
        <Link to="/admin" className="mt-4 inline-block font-medium text-leaf-700 hover:underline">
          กลับไปหน้าภาพรวม
        </Link>
      </div>
    </div>
  )
}
