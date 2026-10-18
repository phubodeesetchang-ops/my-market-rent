import { useState } from 'react'
import { GridIcon } from '../../components/BrandMark'
import { Button, Field, FormError, TextInput } from '../../components/ui/form'
import { callLineAuth } from '../../lib/liff'
import { clearProblem, collectProblems, digitsOnly, phoneProblem } from '../../lib/validate'

/** เลขบัตร 13 หลัก (ไม่ตรวจหลักสุดท้าย เพราะระบบเทียบกับเลขที่สำนักงานบันทึกไว้อยู่แล้ว) */
function idCardProblem(value) {
  const d = digitsOnly(value)
  if (!d) return 'กรุณากรอกเลขบัตรประชาชน'
  if (d.length !== 13) return `เลขบัตรประชาชนต้องมี 13 หลัก (กรอกมา ${d.length} หลัก)`
  return ''
}

/**
 * ผูกบัญชี LINE กับข้อมูลผู้เช่า (ครั้งแรกครั้งเดียว)
 * ผู้เช่าต้องมีข้อมูลที่สำนักงานก่อน แล้วกรอกเลขบัตร + เบอร์โทรให้ตรงกับที่บันทึกไว้ (ไม่มีการลงทะเบียนเอง)
 * onLinked(res) = ผูกสำเร็จ (res มี session และ tenant)
 */
export default function ConnectPage({ line, onLinked }) {
  const [values, setValues] = useState({ id_card: '', phone: '' })
  const [errors, setErrors] = useState({})
  const [notFound, setNotFound] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setErrors(clearProblem(key))
    setNotFound(false)
  }

  async function submit(e) {
    e.preventDefault()
    const problems = collectProblems({ id_card: idCardProblem(values.id_card), phone: phoneProblem(values.phone) })
    setErrors(problems)
    if (Object.keys(problems).length) return

    setBusy(true)
    setError('')
    setNotFound(false)
    try {
      const res = await callLineAuth({ action: 'connect', id_token: line.idToken, id_card: digitsOnly(values.id_card), phone: digitsOnly(values.phone) })
      if (res.tenant) {
        await onLinked(res)
        return
      }
      setNotFound(true)
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <main className="min-h-dvh bg-leaf-50 px-5 pt-8 pb-12">
      <div className="mx-auto max-w-md">
        <div className="flex items-center gap-3">
          <GridIcon className="size-10 shrink-0" />
          <div className="min-w-0 leading-tight">
            <p className="font-semibold text-leaf-800">แผงค้าตลาด</p>
            <p className="truncate text-sm text-muted">{line.name ? `LINE: ${line.name}` : 'เข้าใช้งานผ่าน LINE'}</p>
          </div>
        </div>

        <h1 className="mt-7 text-xl font-semibold text-ink">ผูกบัญชี LINE กับข้อมูลผู้เช่า</h1>
        <p className="mt-1 text-muted">
          กรอกเลขบัตรประชาชนและเบอร์โทรที่ให้ไว้กับสำนักงานตลาด ทำครั้งเดียว ครั้งต่อไปเปิดจาก LINE ได้เลย
        </p>

        {notFound && (
          <div role="status" className="mt-4 rounded-lg bg-stall-reserved px-4 py-3 text-stall-reserved-ink">
            <p className="font-semibold">ไม่พบข้อมูลผู้เช่าที่ตรงกับเลขบัตรนี้</p>
            <p className="mt-0.5">ตรวจเลขบัตรอีกครั้ง หรือถ้ายังไม่เคยเช่าแผง ติดต่อสำนักงานตลาดเพื่อเพิ่มข้อมูลผู้เช่าก่อน แล้วกลับมาผูกบัญชีที่นี่</p>
          </div>
        )}

        <form noValidate onSubmit={submit} className="mt-5 space-y-4 rounded-2xl border border-line bg-white p-5">
          <Field label="เลขบัตรประชาชน 13 หลัก" error={errors.id_card}>
            <TextInput value={values.id_card} onChange={set('id_card')} inputMode="numeric" autoComplete="off" maxLength={17} />
          </Field>
          <Field label="เบอร์โทร" error={errors.phone} hint="เบอร์เดียวกับที่ให้ไว้ตอนทำสัญญา">
            <TextInput value={values.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" maxLength={12} />
          </Field>
          <FormError>{error}</FormError>
          <Button type="submit" variant="primary" size="md" className="w-full" disabled={busy}>
            {busy ? 'กำลังตรวจสอบ…' : 'ผูกบัญชี'}
          </Button>
          <p className="text-sm text-muted">เลขบัตรประชาชนใช้ยืนยันตัวตนเท่านั้น ผู้ที่ดูได้มีเฉพาะเจ้าหน้าที่ตลาด</p>
        </form>
      </div>
    </main>
  )
}
