import { useEffect, useId, useLayoutEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const WIDTH = { md: 'max-w-lg', lg: 'max-w-2xl' }

// หน้าต่างที่เปิดซ้อนกัน: Esc/Tab ทำงานกับหน้าต่างบนสุดเท่านั้น
const openStack = []

/**
 * หน้าต่างเด้งขึ้น + เบลอพื้นหลัง (ใช้ร่วมกันทุกหน้า)
 * - Esc / กดพื้นหลัง / ปุ่ม "ปิด" = ปิด (ยกเว้นตอน busy เช่นกำลังบันทึก)
 * - Tab วนอยู่ในหน้าต่าง, ล็อกการเลื่อนหน้าหลัง, ปิดแล้วคืนโฟกัสให้ปุ่มที่เปิด
 * - ส่ง onSubmit มา = เนื้อหาและ footer อยู่ใน <form> (ปุ่ม type="submit" ใน footer ใช้ได้)
 * - initialFocus="field" = โฟกัสช่องกรอกแรก (ฟอร์ม) แทนปุ่มปิด
 */
export default function Modal({
  title,
  subtitle,
  badge,
  onClose,
  onSubmit,
  footer,
  children,
  size = 'md',
  busy = false,
  initialFocus = 'close',
  closeOnBackdrop = true,
}) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()
  // เก็บ onClose/busy ล่าสุดไว้ใน ref เพื่อไม่ให้ effect ด้านล่างรันซ้ำ (โฟกัสจะกระโดด)
  const latest = useRef({ onClose, busy })
  useEffect(() => {
    latest.current = { onClose, busy }
  })

  // useLayoutEffect: ตั้งโฟกัสและปุ่ม Esc ก่อนหน้าต่างปรากฏบนจอ (ไม่มีช่วงที่เห็นหน้าต่างแต่กด Esc ไม่ได้)
  useLayoutEffect(() => {
    const opener = document.activeElement
    const field = initialFocus === 'field' ? panelRef.current?.querySelector('input, select, textarea') : null
    ;(field ?? closeRef.current)?.focus()

    const self = {}
    openStack.push(self)
    const onKey = (e) => {
      if (openStack.at(-1) !== self) return
      if (e.key === 'Escape') {
        if (!latest.current.busy) latest.current.onClose()
        return
      }
      if (e.key !== 'Tab' || !panelRef.current) return
      const items = [...panelRef.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      openStack.splice(openStack.indexOf(self), 1)
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
    // ตั้งค่าครั้งเดียวตอนเปิดหน้าต่าง
  }, [initialFocus])

  const close = () => {
    if (!latest.current.busy) latest.current.onClose()
  }

  const body = (
    <>
      <div className="divide-y divide-line">{children}</div>
      {footer && (
        <footer className="sticky bottom-0 z-10 space-y-3 border-t border-line bg-leaf-50 px-6 py-4">{footer}</footer>
      )}
    </>
  )

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-ink/25 backdrop-blur-[3px]"
        onClick={closeOnBackdrop ? close : undefined}
        aria-hidden="true"
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`dialog-in relative max-h-[92dvh] w-full ${WIDTH[size] ?? WIDTH.md} overflow-y-auto rounded-t-2xl bg-white shadow-[0_24px_64px_-16px_rgb(30_43_34/0.4)] sm:rounded-2xl`}
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-white px-6 pt-5 pb-4">
          <div className="min-w-0">
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 id={titleId} className="text-2xl font-semibold text-ink">
                {title}
              </h2>
              {badge}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            disabled={busy}
            className="shrink-0 rounded-lg px-3 py-1.5 font-medium text-leaf-800 hover:bg-leaf-100 disabled:opacity-50"
          >
            ปิด
          </button>
        </header>
        {onSubmit ? (
          <form noValidate onSubmit={onSubmit}>
            {body}
          </form>
        ) : (
          body
        )}
      </section>
    </div>
  )
}

/** หัวข้อย่อยในหน้าต่าง */
export function ModalSection({ title, children, aside }) {
  return (
    <section className="px-6 py-4">
      {(title || aside) && (
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          {title && <h3 className="font-semibold text-leaf-800">{title}</h3>}
          {aside}
        </div>
      )}
      {children}
    </section>
  )
}

/** รายการ "หัวข้อ : ค่า" สองคอลัมน์ — rows เป็น [หัวข้อ, ค่า] หรือ { label, value } */
export function DetailRows({ rows }) {
  return (
    <dl className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
      {rows.filter(Boolean).map((row) => (Array.isArray(row) ? row : [row.label, row.value])).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
