import { useState } from 'react'
import { GridIcon } from '../../components/BrandMark'
import { Button, Field, FormError, TextArea, TextInput } from '../../components/ui/form'
import { callLineAuth } from '../../lib/liff'
import { formatIdCard } from '../../lib/format'
import { clearProblem, collectProblems, digitsOnly, phoneProblem, requiredProblem, thaiIdProblem } from '../../lib/validate'

const EMPTY = { id_card: '', phone: '', full_name: '', business_name: '', address: '' }

/**
 * ผูกบัญชี LINE กับข้อมูลผู้เช่า (ครั้งแรกครั้งเดียว)
 * - connect : ผู้เช่าเดิม กรอกเลขบัตร + เบอร์โทร ให้ตรงกับที่สำนักงานบันทึก
 * - register: ไม่พบในระบบ → ลงทะเบียนผู้เช่าใหม่เอง
 * onLinked(res) = ผูกสำเร็จ (res มี session และ tenant)
 */
export default function ConnectPage({ line, onLinked }) {
  const [mode, setMode] = useState('connect')
  const [values, setValues] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [notFound, setNotFound] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const registering = mode === 'register'

  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setErrors(clearProblem(key))
  }

  function switchMode(next) {
    setMode(next)
    setErrors({})
    setError('')
    setNotFound('')
  }

  async function submit(e) {
    e.preventDefault()
    const problems = collectProblems({
      full_name: registering ? requiredProblem(values.full_name, 'ชื่อ-นามสกุล') : '',
      id_card: thaiIdProblem(values.id_card),
      phone: phoneProblem(values.phone),
      business_name: registering ? requiredProblem(values.business_name, 'ชื่อร้านหรือสินค้าที่ขาย') : '',
      address: registering ? requiredProblem(values.address, 'ที่อยู่') : '',
    })
    setErrors(problems)
    if (Object.keys(problems).length) return

    setBusy(true)
    setError('')
    try {
      const body = { action: mode, id_token: line.idToken, id_card: digitsOnly(values.id_card), phone: digitsOnly(values.phone) }
      if (registering) Object.assign(body, { full_name: values.full_name.trim(), business_name: values.business_name.trim(), address: values.address.trim() })
      const res = await callLineAuth(body)
      if (res.tenant) {
        await onLinked(res)
        return
      }
      // ไม่พบเลขบัตรนี้ในระบบ → ให้ลงทะเบียนเป็นผู้เช่าใหม่
      setMode('register')
      setNotFound(formatIdCard(digitsOnly(values.id_card)))
      setBusy(false)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
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

        <h1 className="mt-7 text-xl font-semibold text-ink">{registering ? 'ลงทะเบียนผู้เช่าใหม่' : 'ผูกบัญชี LINE กับข้อมูลผู้เช่า'}</h1>
        <p className="mt-1 text-muted">
          {registering
            ? 'กรอกข้อมูลจริงตามบัตรประชาชน ใช้ขอเช่าแผงและทำสัญญากับสำนักงานตลาด'
            : 'กรอกเลขบัตรประชาชนและเบอร์โทรที่ให้ไว้กับสำนักงานตลาด ทำครั้งเดียว ครั้งต่อไปเปิดจาก LINE ได้เลย'}
        </p>

        {notFound && (
          <p role="status" className="mt-4 rounded-lg bg-stall-reserved px-4 py-3 text-stall-reserved-ink">
            ไม่พบเลขบัตร {notFound} ในระบบ — ถ้าเคยเช่าแผงแล้ว ตรวจเลขบัตรอีกครั้งหรือติดต่อสำนักงาน ถ้าเป็นผู้เช่าใหม่
            กรอกข้อมูลด้านล่างเพื่อลงทะเบียน
          </p>
        )}

        <form noValidate onSubmit={submit} className="mt-5 space-y-4 rounded-2xl border border-line bg-white p-5">
          {registering && (
            <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
              <TextInput value={values.full_name} onChange={set('full_name')} autoComplete="name" maxLength={150} />
            </Field>
          )}
          <Field label="เลขบัตรประชาชน 13 หลัก" error={errors.id_card}>
            <TextInput value={values.id_card} onChange={set('id_card')} inputMode="numeric" autoComplete="off" maxLength={17} />
          </Field>
          <Field label="เบอร์โทร" error={errors.phone} hint={registering ? undefined : 'เบอร์เดียวกับที่ให้ไว้ตอนทำสัญญา'}>
            <TextInput value={values.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" maxLength={12} />
          </Field>
          {registering && (
            <>
              <Field label="ชื่อร้าน / สินค้าที่ขาย" error={errors.business_name}>
                <TextInput value={values.business_name} onChange={set('business_name')} maxLength={150} placeholder="เช่น ผลไม้ตามฤดูกาล" />
              </Field>
              <Field label="ที่อยู่" error={errors.address}>
                <TextArea value={values.address} onChange={set('address')} rows={3} maxLength={500} autoComplete="street-address" />
              </Field>
            </>
          )}
          <FormError>{error}</FormError>
          <Button type="submit" variant="primary" size="md" className="w-full" disabled={busy}>
            {busy ? 'กำลังตรวจสอบ…' : registering ? 'ลงทะเบียน' : 'ผูกบัญชี'}
          </Button>
          <p className="text-sm text-muted">เลขบัตรประชาชนใช้ยืนยันตัวตนเท่านั้น ผู้ที่ดูได้มีเฉพาะเจ้าหน้าที่ตลาด</p>
        </form>

        <div className="mt-5 text-center">
          {registering ? (
            <button type="button" onClick={() => switchMode('connect')} className="font-medium text-leaf-700 underline-offset-2 hover:underline">
              เคยเช่าแผงแล้ว? ผูกด้วยเลขบัตร + เบอร์โทร
            </button>
          ) : (
            <button type="button" onClick={() => switchMode('register')} className="font-medium text-leaf-700 underline-offset-2 hover:underline">
              ยังไม่เคยเช่าแผงกับตลาด? ลงทะเบียนผู้เช่าใหม่
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
