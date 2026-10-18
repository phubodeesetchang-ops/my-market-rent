import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatBaht, formatDate, formatPeriod, formatPhone } from '../../lib/format'
import { bahtText } from '../../lib/bahttext'
import { PAYMENT_METHOD, label } from '../../lib/labels'
import { useLoader } from '../../lib/useLoader'
import PrintLayout, { DocFields, DocHeader } from './PrintLayout'

async function fetchReceipt(id) {
  const { data, error } = await supabase
    .from('receipts')
    .select(
      'receipt_id, receipt_no, receipt_date, amount, users(full_name), ' +
        'payments(payment_id, payment_date, payment_method, transaction_ref, status, note, ' +
        'invoices(invoice_id, invoice_no, billing_period, total_amount, contracts(contract_no, tenants(full_name, business_name, phone), ' +
        'stalls(stall_code, unit_type, zones(zone_name, markets(market_name))))))',
    )
    .eq('receipt_id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('ไม่พบใบเสร็จนี้ หรือบัญชีนี้ไม่มีสิทธิ์ดู')
  return data
}

export default function ReceiptPrint() {
  const { id } = useParams()
  const { data: r, error } = useLoader(() => fetchReceipt(Number(id)), id)
  const pay = r?.payments
  const inv = pay?.invoices
  const contract = inv?.contracts
  const stall = contract?.stalls
  const voided = pay?.status === 'rejected'
  const partial = inv && Number(r.amount) < Number(inv.total_amount)
  const voidNote = voided ? (pay.note ?? '').split('\n').find((line) => line.startsWith('ยกเลิกใบเสร็จ')) : null

  return (
    <PrintLayout title={r?.receipt_no} backTo={pay ? `/admin/payments?tab=${voided ? 'rejected' : 'verified'}&month=${pay.payment_date.slice(0, 7)}` : '/admin/payments'} loading={!r && !error} error={error}>
      {r && (
        <>
          {voided && <span className="doc-stamp top-[58mm] left-[28mm] text-[32pt] text-danger">ยกเลิก</span>}
          <DocHeader marketName={stall?.zones?.markets?.market_name} docTitle="ใบเสร็จรับเงิน" number={r.receipt_no} dateLabel="วันที่" date={formatDate(r.receipt_date, { long: true })} />

          <section className="mt-3 grid grid-cols-2 gap-x-5">
            <DocFields
              rows={[
                ['ได้รับเงินจาก', contract?.tenants?.full_name],
                contract?.tenants?.business_name && ['ร้าน', contract.tenants.business_name],
                contract?.tenants?.phone && ['โทร', formatPhone(contract.tenants.phone)],
              ]}
            />
            <DocFields
              rows={[
                [stall?.unit_type === 'room' ? 'ห้อง' : 'แผง', `${stall?.stall_code} โซน ${stall?.zones?.zone_name}`],
                ['สัญญา', contract?.contract_no],
              ]}
            />
          </section>

          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="border-y border-ink/60 text-left">
                <th className="py-1 font-semibold">รายการ</th>
                <th className="py-1 text-right font-semibold">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line align-top">
                <td className="py-1.5 pr-3">
                  ค่าเช่าและค่าบริการ รอบ {formatPeriod(inv?.billing_period, { long: true })}
                  <span className="block text-[9.5pt] text-muted">
                    ตามใบแจ้งหนี้ {inv?.invoice_no} ยอด {formatBaht(inv?.total_amount)}
                    {partial ? ' (ชำระบางส่วน)' : ''}
                  </span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{formatBaht(r.amount, { withUnit: false })}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-b-2 border-ink/60">
                <td className="py-1.5 font-bold">
                  รวมเงิน <span className="font-normal text-muted">({bahtText(r.amount)})</span>
                </td>
                <td className="py-1.5 text-right font-bold tabular-nums">{formatBaht(r.amount, { withUnit: false })}</td>
              </tr>
            </tfoot>
          </table>

          <p className="mt-3">
            ชำระโดย {label(PAYMENT_METHOD, pay?.payment_method)}
            {pay?.transaction_ref ? ` · เลขอ้างอิง ${pay.transaction_ref}` : ''} · วันที่ชำระ {formatDate(pay?.payment_date, { long: true })}
          </p>

          {voided && (
            <p className="mt-3 rounded border border-danger px-3 py-2 text-danger">
              ใบเสร็จนี้ถูกยกเลิกแล้ว ใช้เป็นหลักฐานการชำระไม่ได้
              {voidNote ? <span className="block text-[9.5pt]">{voidNote}</span> : null}
            </p>
          )}

          <div className="mt-14 ml-auto w-56 text-center break-inside-avoid">
            <div className="border-b border-dotted border-ink/70 pb-1">&nbsp;</div>
            <p className="mt-1">ผู้รับเงิน</p>
            <p className="text-[9.5pt] text-muted">{r.users?.full_name ? `(${r.users.full_name})` : '(..............................................)'}</p>
          </div>
        </>
      )}
    </PrintLayout>
  )
}
