import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatDateTime, formatPeriod, formatPhone, todayISO } from '../../lib/format'
import { contractTiming, liveRenewalOf, termLabel } from '../../lib/contracts'
import { stallPlace } from '../../lib/stalls'
import { outstandingOf } from '../../lib/payments'
import { useLoader } from '../../lib/useLoader'
import { can } from '../../auth/permissions'
import Modal, { DetailRows, ModalSection } from '../ui/Modal'
import { Badge, ContractStatusBadge } from '../ui/feedback'
import { Button, Field, FormError, TextArea } from '../ui/form'
import { TimingBadge } from './TimingBadge'

const PER = { monthly: 'เดือน', yearly: 'ปี' }
const NOTE_MAX = 500

/** ใบแจ้งหนี้ที่ยังไม่ชำระของสัญญา (เตือนก่อนยกเลิก) */
async function fetchUnpaid(contractId) {
  const { data, error } = await supabase
    .from('invoices')
    .select('invoice_id, invoice_no, billing_period, total_amount, payments(amount, status)')
    .eq('contract_id', contractId)
    .eq('status', 'unpaid')
    .order('billing_period')
  if (error) throw error
  return data
}

/** ยืนยันไม่อนุมัติ/ยกเลิก พร้อมช่องเหตุผล */
function ReasonConfirm({ kind, contract, busy, onBack, onConfirm }) {
  const [reason, setReason] = useState('')
  const unpaid = useLoader(() => (kind === 'cancel' ? fetchUnpaid(contract.contract_id) : Promise.resolve([])), `${kind}:${contract.contract_id}`)
  const total = (unpaid.data ?? []).reduce((n, i) => n + outstandingOf(i), 0)
  const reject = kind === 'reject'
  return (
    <div className="space-y-3">
      <p className="font-medium text-ink">
        {reject ? `ไม่อนุมัติคำขอ ${contract.contract_no}?` : `ยกเลิกสัญญา ${contract.contract_no}?`}
        <span className="font-normal text-muted">
          {' '}
          {reject ? 'แผงจะกลับเป็นว่าง (ถ้าไม่มีสัญญาอื่น)' : 'แผงจะกลับเป็นว่าง ถ้าไม่มีสัญญาอื่นที่ใช้งานอยู่'}
        </span>
      </p>
      {!reject && unpaid.data?.length > 0 && (
        <p role="alert" className="rounded-lg bg-stall-reserved/70 px-3 py-2 text-stall-reserved-ink">
          ยังมีใบแจ้งหนี้ค้างชำระ {unpaid.data.length} ใบ รวม {formatBaht(total)} (
          {unpaid.data.map((i) => formatPeriod(i.billing_period)).join(', ')}) — ยกเลิกสัญญาแล้วใบแจ้งหนี้ยังคงอยู่ ต้องตามเก็บต่อ
        </p>
      )}
      <Field label={reject ? 'เหตุผลที่ไม่อนุมัติ' : 'เหตุผลที่ยกเลิก'} optional hint="บันทึกในหมายเหตุของสัญญา (ผู้เช่าจะเห็นทาง LINE ในขั้นที่ 8)">
        <TextArea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={NOTE_MAX} />
      </Field>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onBack} disabled={busy}>
          ไม่ใช่
        </Button>
        <Button variant="danger" onClick={() => onConfirm(reason.trim())} disabled={busy || (!reject && unpaid.loading)}>
          {busy ? 'กำลังบันทึก…' : reject ? 'ไม่อนุมัติ' : 'ยกเลิกสัญญา'}
        </Button>
      </div>
    </div>
  )
}

/**
 * หน้าต่างรายละเอียดสัญญา/คำขอ + ปุ่มตามสถานะ
 * onAction('approve' | 'renew' | 'edit') → ผู้เรียกเปิดฟอร์ม · onChanged(text) หลังไม่อนุมัติ/ยกเลิก
 */
export default function ContractDialog({ contract, all, role, onClose, onAction, onChanged, onOpen }) {
  const [confirm, setConfirm] = useState(null) // 'reject' | 'cancel'
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const canOperate = can(role, 'manageOperations')
  const c = contract
  const t = c.tenants
  const from = c.renewed_from_id ? all.find((x) => x.contract_id === c.renewed_from_id) : null
  const renewal = liveRenewalOf(c, all)
  const timing = contractTiming(c, todayISO())

  async function closeWith(status, reason) {
    setBusy(true)
    setError('')
    const patch = { status, ...(reason ? { note: reason } : {}) }
    const { data, error: e } = await supabase.from('contracts').update(patch).eq('contract_id', c.contract_id).select('contract_id')
    setBusy(false)
    if (e) {
      setConfirm(null)
      return setError(thaiError(e))
    }
    if (!data?.length) {
      setConfirm(null)
      return setError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์จัดการสัญญา')
    }
    onChanged(status === 'rejected' ? `ไม่อนุมัติ ${c.contract_no} แล้ว` : `ยกเลิก ${c.contract_no} แล้ว`)
  }

  const linkClass = 'font-medium text-leaf-700 hover:underline'
  const rows = [
    { label: 'แผง/ห้อง', value: stallPlace(c.stalls) },
    {
      label: 'ระยะเวลา',
      value: (
        <>
          {formatDate(c.start_date)} ถึง {formatDate(c.end_date)}
          <span className="text-muted"> ({termLabel(c.start_date, c.end_date)})</span>
        </>
      ),
    },
    { label: 'ค่าเช่า', value: `${formatBaht(c.rent_amount)} / ${PER[c.rent_period] ?? '-'}` },
    { label: 'เงินประกัน', value: c.deposit_amount !== null && c.deposit_amount !== undefined ? formatBaht(c.deposit_amount) : 'ไม่มี' },
    {
      label: c.status === 'pending' ? 'ส่งคำขอเมื่อ' : 'สร้างเมื่อ',
      value: (
        <>
          {formatDateTime(c.created_at)}
          <span className="text-muted"> · {c.created_by ? 'เจ้าหน้าที่สร้าง' : 'ผู้เช่าส่งผ่าน LINE'}</span>
        </>
      ),
    },
    from && {
      label: 'ต่ออายุจาก',
      value: (
        <button type="button" className={linkClass} onClick={() => onOpen(from.contract_id)}>
          {from.contract_no} (สิ้นสุด {formatDate(from.end_date)})
        </button>
      ),
    },
    renewal && {
      label: 'สัญญาต่ออายุ',
      value: (
        <button type="button" className={linkClass} onClick={() => onOpen(renewal.contract_id)}>
          {renewal.contract_no} · <ContractStatusBadge status={renewal.status} />
        </button>
      ),
    },
  ]

  const footer = canOperate && (c.status === 'pending' || c.status === 'active') && (
    <>
      <FormError>{error}</FormError>
      {confirm ? (
        <ReasonConfirm kind={confirm} contract={c} busy={busy} onBack={() => setConfirm(null)} onConfirm={(r) => closeWith(confirm === 'reject' ? 'rejected' : 'cancelled', r)} />
      ) : c.status === 'pending' ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => onAction('approve')}>
              อนุมัติ…
            </Button>
            <Button onClick={() => onAction('edit')}>แก้ไขคำขอ</Button>
          </div>
          <Button variant="danger-ghost" onClick={() => setConfirm('reject')}>
            ไม่อนุมัติ
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {renewal ? (
              <span className="text-sm text-muted">ต่ออายุแล้ว ({renewal.contract_no})</span>
            ) : (
              <Button variant="primary" onClick={() => onAction('renew')}>
                ต่ออายุ…
              </Button>
            )}
            <Button onClick={() => onAction('edit')}>แก้ไขสัญญา</Button>
          </div>
          <Button variant="danger-ghost" onClick={() => setConfirm('cancel')}>
            ยกเลิกสัญญา
          </Button>
        </div>
      )}
    </>
  )

  return (
    <Modal
      title={c.contract_no}
      subtitle={c.status === 'pending' ? (c.renewed_from_id ? 'คำขอต่ออายุสัญญา' : 'คำขอเช่า') : 'สัญญาเช่า'}
      badge={
        <span className="flex flex-wrap gap-2">
          <ContractStatusBadge status={c.status} />
          {timing && <TimingBadge timing={timing} />}
        </span>
      }
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={footer || null}
    >
      <ModalSection title="ผู้เช่า">
        <p className="font-semibold text-ink">
          {t?.full_name ?? '-'}
          {t?.business_name && <span className="font-normal text-muted"> ({t.business_name})</span>}
          {t?.status === 'inactive' && (
            <Badge tone="gray" className="ml-2">
              ผู้เช่าถูกระงับ
            </Badge>
          )}
        </p>
        {t?.phone && (
          <a href={`tel:${t.phone}`} className="text-leaf-700 hover:underline">
            {formatPhone(t.phone)}
          </a>
        )}
      </ModalSection>
      <ModalSection title="รายละเอียดสัญญา">
        <DetailRows rows={rows} />
      </ModalSection>
      {c.note && (
        <ModalSection title="หมายเหตุ">
          <p className="whitespace-pre-line text-ink">{c.note}</p>
        </ModalSection>
      )}
    </Modal>
  )
}
