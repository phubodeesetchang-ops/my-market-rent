import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { outstandingOf, paidOf } from '../lib/payments'
import { thaiError } from '../lib/errors'
import { formatBaht, formatDate, formatPeriod, formatNumber, formatPhone, todayISO } from '../lib/format'
import { CONTRACT_STATUS, RENT_PERIOD, STALL_STATUS, UNIT_TYPE } from '../lib/labels'
import Modal, { DetailRows, ModalSection } from './ui/Modal'
import { Button, FormError } from './ui/form'
import { StallStatusBadge } from './MarketMap'
import { stallTitle } from '../lib/stalls'
import { can } from '../auth/permissions'

const PER = { monthly: 'เดือน', yearly: 'ปี' }

/** ดึงสัญญา (ใช้งาน/รออนุมัติ) และใบแจ้งหนี้ที่ยังไม่ชำระของแผงนี้ */
async function fetchStallDetail(stallId) {
  const [contracts, invoices] = await Promise.all([
    supabase
      .from('contracts')
      .select(
        'contract_id, contract_no, status, start_date, end_date, rent_amount, rent_period, deposit_amount, created_at, tenants(tenant_id, full_name, business_name, phone)',
      )
      .eq('stall_id', stallId)
      .in('status', ['active', 'pending'])
      .order('start_date'),
    supabase
      .from('invoices')
      .select('invoice_id, invoice_no, billing_period, total_amount, due_date, payments(amount, status), contracts!inner(stall_id)')
      .eq('contracts.stall_id', stallId)
      .eq('status', 'unpaid')
      .order('due_date'),
  ])
  if (contracts.error) throw contracts.error
  if (invoices.error) throw invoices.error
  return { contracts: contracts.data, invoices: invoices.data }
}

function TenantContract({ contract }) {
  const t = contract.tenants
  const per = PER[contract.rent_period]
  return (
    <div className="space-y-2">
      <div>
        <p className="font-semibold text-ink">
          {t?.full_name ?? '-'}
          {t?.business_name && <span className="font-normal text-muted"> ({t.business_name})</span>}
        </p>
        {t?.phone && (
          <a href={`tel:${t.phone}`} className="text-leaf-700 hover:underline">
            {formatPhone(t.phone)}
          </a>
        )}
      </div>
      <DetailRows
        rows={[
          ['เลขที่สัญญา', contract.contract_no],
          ['ระยะเวลา', `${formatDate(contract.start_date)} ถึง ${formatDate(contract.end_date)}`],
          ['ค่าเช่าตามสัญญา', `${formatBaht(contract.rent_amount)}${per ? ` / ${per}` : ''}`],
          ['เงินประกัน', contract.deposit_amount != null ? formatBaht(contract.deposit_amount) : 'ไม่มี'],
        ]}
      />
    </div>
  )
}


/**
 * หน้าต่างข้อมูลแผง (เด้งขึ้นมา + เบลอพื้นหลัง)
 * info = { market, zone, stall } · role = บทบาทผู้ใช้ (ใช้แสดง/ซ่อนปุ่ม)
 * onEdit = กด "แก้ไขข้อมูลแผง" (ผู้เรียกสลับไปเปิดฟอร์มแก้ไข)
 */
export default function StallDialog({ info, role, onClose, onChanged, onDeleted, onEdit }) {
  const { market, zone, stall } = info
  const [detail, setDetail] = useState({ key: null, data: null, error: null })
  const [busy, setBusy] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [actionError, setActionError] = useState('')
  const navigate = useNavigate()

  // โหลดใหม่เมื่อเปลี่ยนแผง หรือสถานะแผงเปลี่ยน
  const key = `${stall.stall_id}:${stall.status}`
  useEffect(() => {
    let cancelled = false
    fetchStallDetail(stall.stall_id)
      .then((data) => !cancelled && setDetail({ key, data, error: null }))
      .catch((e) => !cancelled && setDetail({ key, data: null, error: thaiError(e) }))
    return () => {
      cancelled = true
    }
  }, [stall.stall_id, key])

  const loading = detail.key !== key
  const contracts = detail.data?.contracts ?? []
  const active = contracts.filter((c) => c.status === 'active')
  const pending = contracts.filter((c) => c.status === 'pending')
  const invoices = detail.data?.invoices ?? []
  const today = todayISO()
  const outstanding = invoices.reduce((sum, i) => sum + outstandingOf(i), 0)
  const overdue = invoices.filter((i) => i.due_date < today).length

  const canOperate = can(role, 'manageOperations')
  const canDelete = can(role, 'deleteRecords')
  const free = stall.status === 'vacant' || stall.status === 'maintenance'

  async function toggleMaintenance() {
    setActionError('')
    setBusy('maint')
    const next = stall.status === 'maintenance' ? 'vacant' : 'maintenance'
    const { error } = await supabase.from('stalls').update({ status: next }).eq('stall_id', stall.stall_id)
    setBusy(null)
    if (error) return setActionError(thaiError(error))
    onChanged()
  }

  async function deleteStall() {
    setActionError('')
    setBusy('delete')
    const { error, count } = await supabase.from('stalls').delete({ count: 'exact' }).eq('stall_id', stall.stall_id)
    setBusy(null)
    if (error) {
      setConfirmDelete(false)
      return setActionError(
        error.code === '23503'
          ? 'ลบไม่ได้ เพราะแผงนี้มีประวัติสัญญาเช่าหรือการจดมิเตอร์ ให้ตั้งเป็นซ่อมบำรุงแทน'
          : thaiError(error),
      )
    }
    if (count === 0) {
      setConfirmDelete(false)
      return setActionError('ลบไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์ลบแผง')
    }
    onDeleted()
  }

  const period = RENT_PERIOD[stall.rent_period] ?? '-'
  const per = PER[stall.rent_period]

  const footer = (canOperate || canDelete) && (
    <>
      <FormError>{actionError}</FormError>
      {confirmDelete ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="font-medium text-ink">ลบ{stallTitle(stall)} ออกจากผังถาวร?</p>
          <div className="flex gap-2">
            <Button onClick={() => setConfirmDelete(false)}>ไม่ลบ</Button>
            <Button variant="danger" onClick={deleteStall} disabled={busy === 'delete'}>
              {busy === 'delete' ? 'กำลังลบ…' : `ลบ${stallTitle(stall)}`}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {canOperate && stall.status === 'vacant' && (
              <Button variant="primary" onClick={() => navigate(`/admin/contracts?new=1&stall=${stall.stall_id}`)}>
                ทำสัญญาเช่า
              </Button>
            )}
            {canOperate && onEdit && (
              <Button variant={stall.status === 'vacant' ? 'secondary' : 'primary'} onClick={onEdit}>
                แก้ไขข้อมูล{UNIT_TYPE[stall.unit_type] ?? 'แผง'}
              </Button>
            )}
            {canOperate &&
              (free ? (
                <Button onClick={toggleMaintenance} disabled={busy === 'maint'}>
                  {busy === 'maint' ? 'กำลังบันทึก…' : stall.status === 'maintenance' ? 'เลิกซ่อมบำรุง (เปิดให้เช่า)' : 'ตั้งเป็นซ่อมบำรุง'}
                </Button>
              ) : (
                <p className="text-sm text-muted">สถานะ{STALL_STATUS[stall.status]}เปลี่ยนตามสัญญาเช่าอัตโนมัติ</p>
              ))}
          </div>
          {canDelete && free && (
            <Button variant="danger-ghost" onClick={() => setConfirmDelete(true)}>
              ลบแผงนี้
            </Button>
          )}
        </div>
      )}
    </>
  )

  return (
    <Modal
      title={stallTitle(stall)}
      subtitle={`${market.market_name} โซน ${zone.zone_name}`}
      badge={<StallStatusBadge status={stall.status} />}
      onClose={onClose}
      footer={footer || null}
    >
      <ModalSection title={`ข้อมูล${UNIT_TYPE[stall.unit_type] ?? 'แผง'}`}>
        <DetailRows
          rows={[
            ['ประเภท', `${UNIT_TYPE[stall.unit_type] ?? 'แผง'}เช่า${period}`],
            ['ขนาด', stall.size ? `${formatNumber(stall.size)} ${stall.size_unit ?? ''}` : 'ยังไม่ระบุ'],
            ['ค่าเช่าเริ่มต้น', stall.base_rent != null ? `${formatBaht(stall.base_rent)}${per ? ` / ${per}` : ''}` : 'ยังไม่กำหนด'],
          ]}
        />
      </ModalSection>

      <ModalSection title="ผู้เช่าและสัญญา">
        {loading && <p className="text-muted">กำลังโหลด…</p>}
        {!loading && detail.error && <p className="text-danger">{detail.error}</p>}
        {!loading && !detail.error && (
          <div className="space-y-4">
            {active.length === 0 && pending.length === 0 && <p className="text-muted">ยังไม่มีผู้เช่า</p>}
            {active.map((c) => (
              <TenantContract key={c.contract_id} contract={c} />
            ))}
            {pending.map((c) => (
              <div key={c.contract_id} className="rounded-lg bg-stall-reserved/60 px-4 py-3">
                <p className="mb-2 font-medium text-stall-reserved-ink">
                  คำขอเช่า{CONTRACT_STATUS.pending} ส่งเมื่อ {formatDate(c.created_at)}
                </p>
                <TenantContract contract={c} />
                {canOperate && (
                  <Button
                    variant="primary"
                    className="mt-3"
                    onClick={() => navigate(`/admin/contracts?tab=pending&open=${c.contract_id}`)}
                  >
                    พิจารณาคำขอนี้
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </ModalSection>

      <ModalSection title="ยอดค้างชำระ">
        {loading && <p className="text-muted">กำลังโหลด…</p>}
        {!loading && !detail.error && invoices.length === 0 && <p className="text-muted">ไม่มียอดค้างชำระ</p>}
        {!loading && invoices.length > 0 && (
          <div className="space-y-2">
            <p>
              <span className="text-xl font-semibold text-ink tabular-nums">{formatBaht(outstanding)}</span>
              <span className="text-muted">
                {' '}
                จาก {invoices.length} ใบ{overdue > 0 && <span className="font-medium text-danger"> (เกินกำหนด {overdue} ใบ)</span>}
              </span>
            </p>
            <ul className="divide-y divide-line rounded-lg border border-line text-sm">
              {invoices.map((i) => (
                <li key={i.invoice_id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                  <span>
                    <Link to={`/admin/invoices?period=${i.billing_period}&open=${i.invoice_id}`} className="font-medium text-leaf-700 hover:underline">
                      {i.invoice_no}
                    </Link>
                    <span className="text-muted"> รอบ {formatPeriod(i.billing_period)}</span>
                  </span>
                  <span className="tabular-nums">
                    {formatBaht(outstandingOf(i))}
                    {paidOf(i) > 0 && <span className="text-muted"> (จ่ายแล้ว {formatBaht(paidOf(i), { withUnit: false })})</span>}
                    <span className={i.due_date < today ? 'text-danger' : 'text-muted'}>
                      {' '}
                      ครบกำหนด {formatDate(i.due_date)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ModalSection>
    </Modal>
  )
}
