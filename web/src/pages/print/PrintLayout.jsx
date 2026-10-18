import { useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * กรอบหน้าพิมพ์: แถบปุ่มด้านบน (ไม่ออกตอนพิมพ์) + แผ่น A5
 * title = ชื่อแท็บ/ชื่อไฟล์ตอนบันทึกเป็น PDF (เช่น เลขที่เอกสาร)
 */
export default function PrintLayout({ title, backTo, loading, error, children }) {
  useEffect(() => {
    if (!title) return
    const before = document.title
    document.title = title
    return () => {
      document.title = before
    }
  }, [title])

  return (
    <div className="min-h-dvh bg-leaf-50 pb-10 print:bg-white print:pb-0">
      <div className="sticky top-0 z-10 border-b border-line bg-white/95 px-4 py-3 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-[148mm] flex-wrap items-center justify-between gap-2">
          <Link to={backTo} className="font-medium text-leaf-700 hover:underline">
            ‹ กลับ
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">กระดาษ A5 · เลือก "บันทึกเป็น PDF" เพื่อส่งให้ผู้เช่าได้</span>
            <button
              type="button"
              onClick={() => window.print()}
              disabled={loading || Boolean(error)}
              className="rounded-lg bg-leaf-700 px-4 py-2 font-semibold text-white hover:bg-leaf-800 disabled:opacity-60"
            >
              พิมพ์ / บันทึก PDF
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto px-4 pt-6 print:overflow-visible print:p-0">
        {error ? (
          <p role="alert" className="mx-auto max-w-[148mm] rounded-lg bg-danger-bg px-4 py-3 text-danger">
            {error}
          </p>
        ) : loading ? (
          <p className="mx-auto max-w-[148mm] text-muted">กำลังเตรียมเอกสาร…</p>
        ) : (
          <article className="paper relative mx-auto text-ink shadow-[0_8px_30px_-12px_rgb(30_43_34/0.35)]">{children}</article>
        )}
      </div>
    </div>
  )
}

/** หัวเอกสาร: ชื่อตลาดซ้าย ชื่อเอกสาร + เลขที่ + วันที่ขวา */
export function DocHeader({ marketName, docTitle, number, dateLabel, date }) {
  return (
    <header className="flex items-start justify-between gap-4 border-b-2 border-leaf-700 pb-3">
      <div className="min-w-0">
        <p className="text-[13pt] font-bold leading-tight text-leaf-800">{marketName}</p>
        <p className="text-[9pt] text-muted">ระบบบริหารแผงค้าและจัดเก็บค่าเช่าตลาด</p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[15pt] font-bold leading-tight">{docTitle}</p>
        <p className="font-semibold tabular-nums">เลขที่ {number}</p>
        <p className="text-[9.5pt] text-muted">
          {dateLabel} {date}
        </p>
      </div>
    </header>
  )
}

/** ช่องข้อมูลสองคอลัมน์แบบกระชับ */
export function DocFields({ rows }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5">
      {rows.filter(Boolean).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
