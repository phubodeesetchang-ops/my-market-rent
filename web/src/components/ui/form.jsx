import { cloneElement, useId } from 'react'

// ชุดช่องกรอกและปุ่มที่ใช้ร่วมกันทุกฟอร์ม (หน้าตาเดียวกับหน้า login)

const CONTROL =
  'block w-full rounded-lg border border-line bg-white px-3 py-2 text-ink placeholder:text-muted/60 focus:border-leaf-700 focus:outline-none focus:ring-2 focus:ring-leaf-300 disabled:bg-leaf-50 disabled:text-muted aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20'

/**
 * ป้ายชื่อ + ช่องกรอก + คำอธิบาย + ข้อความผิดพลาด
 * ส่งช่องกรอกเป็น children ตัวเดียว Field จะผูก id / aria ให้เอง
 */
export function Field({ label, optional = false, hint, error, children, className = '' }) {
  const id = useId()
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const control = cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
  })
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block font-medium text-ink">
        {label}
        {optional && <span className="font-normal text-muted"> (ไม่บังคับ)</span>}
      </label>
      {control}
      {hint && (
        <p id={hintId} className="mt-1 text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="mt-1 text-sm font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({ className = '', ...props }) {
  return <input type="text" className={`${CONTROL} ${className}`} {...props} />
}

export function SelectInput({ className = '', children, ...props }) {
  return (
    <select className={`${CONTROL} pr-8 ${className}`} {...props}>
      {children}
    </select>
  )
}

export function TextArea({ className = '', rows = 3, ...props }) {
  return <textarea rows={rows} className={`${CONTROL} ${className}`} {...props} />
}

/** ตัวเลือกแบบปุ่มวงกลม (radio) วางเรียงกัน */
export function RadioGroup({ legend, name, value, onChange, options, hint }) {
  return (
    <fieldset>
      <legend className="mb-1 font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1.5">
        {options.map((o) => (
          <label key={o.value} className="inline-flex items-center gap-2">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 accent-leaf-700"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </fieldset>
  )
}

const VARIANT = {
  primary: 'bg-leaf-700 font-semibold text-white hover:bg-leaf-800',
  secondary: 'border border-leaf-300 bg-white font-medium text-leaf-800 hover:bg-leaf-100',
  ghost: 'font-medium text-leaf-800 hover:bg-leaf-100',
  danger: 'bg-danger font-semibold text-white hover:bg-[#912018]',
  'danger-ghost': 'font-medium text-danger hover:bg-danger-bg',
}
const SIZE = { sm: 'px-3 py-1.5', md: 'px-4 py-2' }

export function Button({ variant = 'secondary', size = 'sm', type = 'button', className = '', ...props }) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
      {...props}
    />
  )
}

/** ข้อความผิดพลาดรวมของฟอร์ม (อยู่เหนือปุ่มบันทึก) */
export function FormError({ children }) {
  if (!children) return null
  return (
    <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-danger">
      {children}
    </p>
  )
}

/** แถวปุ่มท้ายฟอร์ม: ยกเลิก + บันทึก */
export function FormActions({ onCancel, busy, submitLabel = 'บันทึก', busyLabel = 'กำลังบันทึก…' }) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button onClick={onCancel} disabled={busy}>
        ยกเลิก
      </Button>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? busyLabel : submitLabel}
      </Button>
    </div>
  )
}
