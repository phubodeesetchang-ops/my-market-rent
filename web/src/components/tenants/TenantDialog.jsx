import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatIdCard, formatPhone } from '../../lib/format'
import { stallPlace } from '../../lib/stalls'
import { can } from '../../auth/permissions'
import Modal, { DetailRows, ModalSection } from '../ui/Modal'
import { ActiveBadge, Badge, ContractStatusBadge } from '../ui/feedback'
import { Button, FormError } from '../ui/form'

const PER = { monthly: 'เดือน', yearly: 'ปี' }
const ORDER = { active: 0, pending: 1, expired: 2, cancelled: 3, rejected: 4 }

/** เลขบัตรประชาชน: ซ่อนไว้ก่อน กด "แสดง" แล้วจึงดึงจากฐานข้อมูล (ผ่านฟังก์ชัน get_tenant_id_card) */
function IdCardReveal({ tenantId }) {
  const [state, setState] = useState({ shown: false, loading: false, value: null, error: '' })

  async function show() {
    setState((s) => ({ ...s, loading: true, error: '' }))
    const { data, error } = await supabase.rpc('get_tenant_id_card', { p_tenant_id: tenantId })
    if (error) return setState({ shown: false, loading: false, value: null, error: thaiError(error) })
    setState({ shown: true, loading: false, value: data, error: '' })
  }

  const linkClass = 'ml-2 text-sm font-medium text-leaf-700 hover:underline disabled:opacity-60'
  if (state.shown) {
    return (
      <span>
        <span className="tabular-nums" data-testid="id-card">
          {state.value ? formatIdCard(state.value) : 'ยังไม่ได้บันทึก'}
        </span>
        <button type="button" className={linkClass} onClick={() => setState({ shown: false, loading: false, value: null, error: '' })}>
          ซ่อน
        </button>
      </span>
    )
  }
  return (
    <span>
      <span className="text-muted">ซ่อนไว้</span>
      <button type="button" className={linkClass} onClick={show} disabled={state.loading}>
        {state.loading ? 'กำลังโหลด…' : 'แสดงเลขบัตร'}
      </button>
      {state.error && <span className="block text-sm text-danger">{state.error}</span>}
    </span>
  )
}

function ContractItem({ c }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-3 py-2.5">
      <div className="min-w-0">
        <p className="font-medium text-ink">{stallPlace(c.stalls)}</p>
        <p className="text-sm text-muted">
          {c.contract_no} · {formatDate(c.start_date)} ถึง {formatDate(c.end_date)} · {formatBaht(c.rent_amount)}
          {PER[c.rent_period] ? ` / ${PER[c.rent_period]}` : ''}
        </p>
      </div>
      <ContractStatusBadge status={c.status} />
    </li>
  )
}

/** หน้าต่างข้อมูลผู้เช่า: รายละเอียด, สัญญาทั้งหมด, ปุ่มแก้ไข/ระงับ/ลบ */
export default function TenantDialog({ tenant, role, onClose, onEdit, onChanged, onDeleted }) {
  const [confirm, setConfirm] = useState(null) // 'status' | 'delete' | 'unlink'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const canOperate = can(role, 'manageOperations')
  const canDelete = can(role, 'deleteRecords')
  const contracts = [...(tenant.contracts ?? [])].sort(
    (a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9) || b.start_date.localeCompare(a.start_date),
  )
  const liveContracts = contracts.filter((c) => c.status === 'active' || c.status === 'pending').length
  const activeContracts = contracts.filter((c) => c.status === 'active')
  const pendingRequests = contracts.filter((c) => c.status === 'pending').length
  // เคยเช่าจริง (ใช้งาน/สิ้นสุด) = ต้องเก็บประวัติ → ลบเฉพาะข้อมูลส่วนตัว (ฐานข้อมูลตรวจใบแจ้งหนี้ซ้ำอีกชั้น)
  const hasHistory = contracts.some((c) => c.status === 'active' || c.status === 'expired')
  const suspending = tenant.status === 'active'

  async function toggleStatus() {
    setBusy(true)
    setError('')
    const next = suspending ? 'inactive' : 'active'
    const { data, error: e } = await supabase.from('tenants').update({ status: next }).eq('tenant_id', tenant.tenant_id).select('tenant_id')
    setBusy(false)
    setConfirm(null)
    if (e) return setError(thaiError(e))
    if (!data?.length) return setError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์แก้ไขผู้เช่า')
    onChanged(suspending ? `ระงับผู้เช่า ${tenant.full_name} แล้ว` : `เปิดใช้งานผู้เช่า ${tenant.full_name} แล้ว`)
  }

  async function unlinkLine() {
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase
      .from('tenants')
      .update({ line_user_id: null, auth_id: null })
      .eq('tenant_id', tenant.tenant_id)
      .select('tenant_id')
    setBusy(false)
    setConfirm(null)
    if (e) return setError(thaiError(e))
    if (!data?.length) return setError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์แก้ไขผู้เช่า')
    onChanged(`ยกเลิกการผูก LINE ของ ${tenant.full_name} แล้ว`)
  }

  // ลบผ่านฟังก์ชัน delete_tenant (migration 009): ไม่มีประวัติ = ลบจริง · มีประวัติ = ล้างข้อมูลส่วนตัว เก็บบิล/ใบเสร็จ
  async function remove() {
    setBusy(true)
    setError('')
    const { data, error: e } = await supabase.rpc('delete_tenant', { p_tenant_id: tenant.tenant_id })
    setBusy(false)
    setConfirm(null)
    if (e) return setError(thaiError(e))
    if (data?.mode === 'anonymized') {
      const cancelled = data.cancelled_requests > 0 ? ` · ยกเลิกคำขอเช่าที่ค้าง ${data.cancelled_requests} รายการ` : ''
      return onDeleted(`ลบข้อมูลส่วนตัวของ ${tenant.full_name} แล้ว — ประวัติสัญญา บิล และใบเสร็จยังอยู่ในรายงาน${cancelled}`)
    }
    onDeleted(`ลบผู้เช่า ${tenant.full_name} ออกจากระบบแล้ว`)
  }

  const footer = (canOperate || canDelete) && (
    <>
      <FormError>{error}</FormError>
      {confirm === 'status' && (
        <div className="space-y-3">
          <p className="text-ink">
            {suspending ? (
              <>
                ระงับ <span className="font-semibold">{tenant.full_name}</span>? ผู้เช่าที่ถูกระงับจะเข้าดูบิลและแจ้งชำระผ่าน LINE
                ไม่ได้ จนกว่าจะเปิดใช้งานอีกครั้ง
                {liveContracts > 0 && ` (สัญญาที่มีอยู่ ${liveContracts} สัญญาไม่ถูกยกเลิก)`}
              </>
            ) : (
              <>
                เปิดใช้งาน <span className="font-semibold">{tenant.full_name}</span> อีกครั้ง?
              </>
            )}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              ไม่ใช่
            </Button>
            <Button variant={suspending ? 'danger' : 'primary'} onClick={toggleStatus} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : suspending ? 'ระงับผู้เช่า' : 'เปิดใช้งาน'}
            </Button>
          </div>
        </div>
      )}
      {confirm === 'unlink' && (
        <div className="space-y-3">
          <p className="text-ink">
            ยกเลิกการผูก LINE ของ <span className="font-semibold">{tenant.full_name}</span>? บัญชี LINE เดิมจะดูข้อมูลไม่ได้ทันที
            ผู้เช่าผูกใหม่ได้เองโดยเปิด LINE ของตลาดแล้วกรอกเลขบัตร + เบอร์โทร (ใช้เมื่อเปลี่ยนมือถือ/บัญชี LINE หรือผูกผิดคน)
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              ไม่ใช่
            </Button>
            <Button variant="danger" onClick={unlinkLine} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : 'ยกเลิกการผูก'}
            </Button>
          </div>
        </div>
      )}
      {confirm === 'delete' && activeContracts.length > 0 && (
        <div className="space-y-3" data-testid="delete-blocked">
          <p className="text-ink">
            ยังลบ <span className="font-semibold">{tenant.full_name}</span> ไม่ได้ เพราะมีสัญญาที่ใช้งานอยู่{' '}
            {activeContracts.map((c) => `${c.contract_no} (${stallPlace(c.stalls)})`).join(', ')} — ยกเลิกหรือปิดสัญญาก่อน แล้วจึงลบผู้เช่า
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setConfirm(null)}>ปิด</Button>
            <Button variant="primary" onClick={() => navigate(`/admin/contracts?tab=active&open=${activeContracts[0].contract_id}`)}>
              เปิดสัญญา
            </Button>
          </div>
        </div>
      )}
      {confirm === 'delete' && activeContracts.length === 0 && (
        <div className="space-y-3">
          {hasHistory ? (
            <div className="space-y-1.5 text-ink">
              <p>
                ลบ <span className="font-semibold">{tenant.full_name}</span>?
              </p>
              <p className="text-muted">
                ผู้เช่ารายนี้มีประวัติการเช่า ระบบจะ<span className="font-semibold text-ink">ล้างข้อมูลส่วนตัว</span> (ชื่อ เลขบัตรประชาชน
                เบอร์โทร ที่อยู่ ชื่อร้าน และบัญชี LINE) และนำออกจากรายชื่อ ส่วนสัญญา ใบแจ้งหนี้ ใบเสร็จ และยอดรายได้ยังเก็บไว้ในรายงาน
                โดยแสดงชื่อเป็น &quot;ผู้เช่าที่ลบข้อมูลแล้ว&quot;
                {pendingRequests > 0 && ` · คำขอเช่าที่รออนุมัติ ${pendingRequests} รายการจะถูกยกเลิก`}
              </p>
              <p className="text-sm text-danger">ย้อนกลับไม่ได้ ถ้าแค่หยุดเช่าชั่วคราว ให้ใช้ &quot;ระงับผู้เช่า&quot; แทน</p>
            </div>
          ) : (
            <p className="text-ink">
              ลบ <span className="font-semibold">{tenant.full_name}</span> ออกจากระบบถาวร?
              {contracts.length > 0 && ' คำขอเช่าที่ยังไม่เคยอนุมัติของผู้เช่ารายนี้จะถูกลบไปด้วย'}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              ไม่ลบ
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? 'กำลังลบ…' : hasHistory ? 'ลบข้อมูลส่วนตัว' : 'ลบผู้เช่า'}
            </Button>
          </div>
        </div>
      )}
      {!confirm && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            {canOperate && (
              <Button variant="primary" onClick={onEdit}>
                แก้ไขข้อมูล
              </Button>
            )}
            {canOperate && tenant.status === 'active' && (
              <Button onClick={() => navigate(`/admin/contracts?new=1&tenant=${tenant.tenant_id}`)}>ทำสัญญาเช่า</Button>
            )}
            {canOperate && (
              <Button onClick={() => setConfirm('status')}>{suspending ? 'ระงับผู้เช่า' : 'เปิดใช้งาน'}</Button>
            )}
            {canOperate && tenant.line_user_id && <Button onClick={() => setConfirm('unlink')}>ยกเลิกการผูก LINE</Button>}
          </div>
          {canDelete && (
            <Button variant="danger-ghost" onClick={() => setConfirm('delete')}>
              ลบผู้เช่า
            </Button>
          )}
        </div>
      )}
    </>
  )

  return (
    <Modal
      title={tenant.full_name}
      subtitle="ผู้เช่า"
      badge={<ActiveBadge status={tenant.status} />}
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={footer || null}
    >
      <ModalSection title="ข้อมูลผู้เช่า">
        <DetailRows
          rows={[
            { label: 'ชื่อร้าน/กิจการ', value: tenant.business_name || <span className="text-muted">ยังไม่ระบุ</span> },
            {
              label: 'เบอร์โทร',
              value: tenant.phone ? (
                <a href={`tel:${tenant.phone}`} className="text-leaf-700 hover:underline">
                  {formatPhone(tenant.phone)}
                </a>
              ) : (
                <span className="text-muted">ยังไม่ระบุ</span>
              ),
            },
            {
              label: 'ที่อยู่',
              value: tenant.address ? (
                <span className="whitespace-pre-line">{tenant.address}</span>
              ) : (
                <span className="text-muted">ยังไม่ระบุ</span>
              ),
            },
            {
              label: 'เลขบัตรประชาชน',
              value: can(role, 'viewIdCard') ? (
                <IdCardReveal tenantId={tenant.tenant_id} />
              ) : (
                <span className="text-muted">ดูได้เฉพาะผู้ดูแลระบบและเจ้าหน้าที่</span>
              ),
            },
            {
              label: 'บัญชี LINE',
              value: tenant.line_user_id ? <Badge tone="green">ผูกแล้ว</Badge> : <span className="text-muted">ยังไม่ผูก</span>,
            },
            { label: 'ลงทะเบียนเมื่อ', value: formatDate(tenant.created_at) },
          ]}
        />
      </ModalSection>
      <ModalSection title={`สัญญาเช่า (${contracts.length})`}>
        {contracts.length === 0 ? (
          <p className="text-muted">ยังไม่มีสัญญาเช่า</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {contracts.map((c) => (
              <ContractItem key={c.contract_id} c={c} />
            ))}
          </ul>
        )}
      </ModalSection>
    </Modal>
  )
}
