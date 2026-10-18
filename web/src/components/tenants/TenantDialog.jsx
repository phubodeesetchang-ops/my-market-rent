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

  async function remove() {
    setBusy(true)
    setError('')
    const { error: e, count } = await supabase.from('tenants').delete({ count: 'exact' }).eq('tenant_id', tenant.tenant_id)
    setBusy(false)
    setConfirm(null)
    if (e) {
      return setError(
        e.code === '23503' ? 'ลบไม่ได้ เพราะผู้เช่ารายนี้มีประวัติสัญญาเช่า ให้ใช้ "ระงับผู้เช่า" แทน' : thaiError(e),
      )
    }
    if (count === 0) return setError('ลบไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์ลบผู้เช่า')
    onDeleted(`ลบผู้เช่า ${tenant.full_name} แล้ว`)
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
      {confirm === 'delete' && (
        <div className="space-y-3">
          <p className="text-ink">
            ลบ <span className="font-semibold">{tenant.full_name}</span> ออกจากระบบถาวร? ลบได้เฉพาะผู้เช่าที่ยังไม่เคยมีสัญญาเช่า
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={() => setConfirm(null)} disabled={busy}>
              ไม่ลบ
            </Button>
            <Button variant="danger" onClick={remove} disabled={busy}>
              {busy ? 'กำลังลบ…' : 'ลบผู้เช่า'}
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
