import { useState } from 'react'
import { ContractStatusBadge } from '../../components/ui/feedback'
import { Button, Field, FormError, TextArea, TextInput } from '../../components/ui/form'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatPhone, maskIdCard } from '../../lib/format'
import { fetchContracts } from '../../lib/liffData'
import { useLiff } from '../../lib/liffContext'
import { stallLine } from '../../lib/tenantView'
import { useLoader } from '../../lib/useLoader'
import { clearProblem, collectProblems, digitsOnly, phoneProblem, requiredProblem } from '../../lib/validate'
import { Card, PageTitle, SectionTitle } from './parts'

const PER = { monthly: 'เดือน', yearly: 'ปี' }

async function loadProfile(client, tenantId) {
  const [idCard, contracts] = await Promise.all([
    client.rpc('get_tenant_id_card', { p_tenant_id: tenantId }).then(({ data, error }) => (error ? null : data)),
    fetchContracts(),
  ])
  return { idCard, contracts }
}

function EditForm({ tenant, onDone, onCancel }) {
  const { client } = useLiff()
  const [values, setValues] = useState({ phone: tenant.phone ?? '', business_name: tenant.business_name ?? '', address: tenant.address ?? '' })
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (key) => (e) => {
    setValues((v) => ({ ...v, [key]: e.target.value }))
    setErrors(clearProblem(key))
  }

  async function submit(e) {
    e.preventDefault()
    const problems = collectProblems({
      phone: phoneProblem(values.phone),
      business_name: requiredProblem(values.business_name, 'ชื่อร้าน'),
      address: requiredProblem(values.address, 'ที่อยู่'),
    })
    setErrors(problems)
    if (Object.keys(problems).length) return
    setBusy(true)
    setError('')
    const { data, error: e2 } = await client
      .from('tenants')
      .update({ phone: digitsOnly(values.phone), business_name: values.business_name.trim(), address: values.address.trim() })
      .eq('tenant_id', tenant.tenant_id)
      .select('tenant_id')
    if (e2 || !data?.length) {
      setError(e2 ? thaiError(e2) : 'บันทึกไม่สำเร็จ ลองปิดแล้วเปิดใหม่')
      setBusy(false)
      return
    }
    await onDone()
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4" aria-label="แก้ไขข้อมูลติดต่อ">
      <Field label="เบอร์โทร" error={errors.phone}>
        <TextInput value={values.phone} onChange={set('phone')} inputMode="tel" maxLength={12} />
      </Field>
      <Field label="ชื่อร้าน / สินค้าที่ขาย" error={errors.business_name}>
        <TextInput value={values.business_name} onChange={set('business_name')} maxLength={150} />
      </Field>
      <Field label="ที่อยู่" error={errors.address}>
        <TextArea value={values.address} onChange={set('address')} rows={3} maxLength={500} />
      </Field>
      <FormError>{error}</FormError>
      <div className="flex gap-2">
        <Button onClick={onCancel} disabled={busy} size="md" className="flex-1">
          ยกเลิก
        </Button>
        <Button type="submit" variant="primary" size="md" className="flex-1" disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึก'}
        </Button>
      </div>
    </form>
  )
}

export default function LiffProfile() {
  const { tenant, line, client, refreshTenant } = useLiff()
  const { data } = useLoader(() => loadProfile(client, tenant.tenant_id), `profile-${tenant.tenant_id}`)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState('')

  const rows = [
    ['ชื่อ-นามสกุล', tenant.full_name],
    ['เลขบัตรประชาชน', data ? maskIdCard(data.idCard) : '…'],
    ['เบอร์โทร', formatPhone(tenant.phone)],
    ['ชื่อร้าน', tenant.business_name || '-'],
    ['ที่อยู่', tenant.address || '-'],
    ['บัญชี LINE', line.name || 'ผูกแล้ว'],
  ]

  return (
    <>
      <PageTitle>ข้อมูลของฉัน</PageTitle>
      {notice && (
        <p role="status" className="mb-3 rounded-lg bg-leaf-100 px-4 py-2.5 text-leaf-800">
          {notice}
        </p>
      )}
      <Card>
        {editing ? (
          <EditForm
            tenant={tenant}
            onCancel={() => setEditing(false)}
            onDone={async () => {
              await refreshTenant()
              setEditing(false)
              setNotice('บันทึกข้อมูลติดต่อแล้ว')
            }}
          />
        ) : (
          <>
            <dl className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
              {rows.map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-muted">{k}</dt>
                  <dd className="min-w-0 break-words whitespace-pre-line text-ink">{v}</dd>
                </div>
              ))}
            </dl>
            <Button
              size="md"
              className="mt-4 w-full"
              onClick={() => {
                setNotice('')
                setEditing(true)
              }}
            >
              แก้ไขเบอร์โทร ชื่อร้าน ที่อยู่
            </Button>
            <p className="mt-2 text-sm text-muted">ชื่อหรือเลขบัตรไม่ถูกต้อง ติดต่อสำนักงานตลาดเพื่อแก้ไข</p>
          </>
        )}
      </Card>

      <SectionTitle>สัญญาและคำขอเช่าทั้งหมด</SectionTitle>
      {!data ? (
        <div className="h-20 animate-pulse rounded-2xl bg-leaf-100" />
      ) : data.contracts.length === 0 ? (
        <Card className="border-dashed text-muted">ยังไม่มีสัญญาเช่า</Card>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white" aria-label="สัญญาทั้งหมด">
          {data.contracts.map((c) => (
            <li key={c.contract_id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 font-medium text-ink">{stallLine(c.stalls)}</p>
                <ContractStatusBadge status={c.status} />
              </div>
              <p className="text-sm text-muted">
                {c.contract_no} · {formatDate(c.start_date)} – {formatDate(c.end_date)} · {formatBaht(c.rent_amount)}
                {PER[c.rent_period] ? ` / ${PER[c.rent_period]}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}

      {!line.inClient && !line.mock && (
        <Button
          variant="ghost"
          size="md"
          className="mt-6 w-full"
          onClick={async () => {
            await client.auth.signOut({ scope: 'local' })
            line.liff.logout()
            window.location.replace('/liff')
          }}
        >
          ออกจากระบบ
        </Button>
      )}
    </>
  )
}
