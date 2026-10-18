import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatBaht, formatDate, formatNumber, formatPeriod, formatPhone } from '../../lib/format'
import { bahtText } from '../../lib/bahttext'
import { RENT_PERIOD, label } from '../../lib/labels'
import { outstandingOf, paidOf } from '../../lib/payments'
import { useLoader } from '../../lib/useLoader'
import { PromptPayQR } from '../../components/payments/PromptPayQR'
import PrintLayout, { DocFields, DocHeader } from './PrintLayout'

async function fetchInvoice(id) {
  const [inv, readings] = await Promise.all([
    supabase
      .from('invoices')
      .select(
        'invoice_id, invoice_no, billing_period, rent_amount, water_amount, electricity_amount, fee_amount, total_amount, due_date, status, created_at, ' +
          'payments(payment_id, amount, status), ' +
          'contracts(contract_no, rent_period, tenants(full_name, business_name, phone), ' +
          'stalls(stall_code, unit_type, zones(zone_name, markets(market_name, promptpay_id, promptpay_name))))',
      )
      .eq('invoice_id', id)
      .maybeSingle(),
    supabase.from('utility_readings').select('utility_type, previous_reading, current_reading, unit_used, rate_per_unit').eq('invoice_id', id),
  ])
  if (inv.error) throw inv.error
  if (readings.error) throw readings.error
  if (!inv.data) throw new Error('ไม่พบใบแจ้งหนี้นี้ หรือบัญชีนี้ไม่มีสิทธิ์ดู')
  return { inv: inv.data, readings: readings.data }
}

const meter = (r) =>
  r ? `${formatNumber(r.previous_reading)} → ${formatNumber(r.current_reading)} = ${formatNumber(r.unit_used)} หน่วย × ${formatBaht(r.rate_per_unit, { withUnit: false })}` : 'ไม่ได้จดมิเตอร์'

export default function InvoicePrint() {
  const { id } = useParams()
  const { data, error } = useLoader(() => fetchInvoice(Number(id)), id)
  const inv = data?.inv
  const contract = inv?.contracts
  const stall = contract?.stalls
  const market = stall?.zones?.markets
  const paid = inv ? paidOf(inv) : 0
  const outstanding = inv ? outstandingOf(inv) : 0
  const reading = (type) => data?.readings.find((r) => r.utility_type === type)
  const rows = inv
    ? [
        ['ค่าเช่า', contract?.rent_period === 'yearly' ? (Number(inv.rent_amount) > 0 ? 'ค่าเช่ารายปี' : 'สัญญารายปี (ไม่มีค่าเช่าเดือนนี้)') : label(RENT_PERIOD, contract?.rent_period), inv.rent_amount],
        ['ค่าน้ำ', meter(reading('water')), inv.water_amount],
        ['ค่าไฟฟ้า', meter(reading('electricity')), inv.electricity_amount],
        ['ค่าธรรมเนียม', 'ค่าบริการส่วนกลางของตลาด', inv.fee_amount],
      ]
    : []

  return (
    <PrintLayout title={inv?.invoice_no} backTo={inv ? `/admin/invoices?period=${inv.billing_period}&open=${inv.invoice_id}` : '/admin/invoices'} loading={!data && !error} error={error}>
      {inv && (
        <>
          {inv.status === 'paid' && <span className="doc-stamp top-[44mm] right-[8mm] text-[16pt] text-leaf-700">ชำระแล้ว</span>}
          {inv.status === 'cancelled' && <span className="doc-stamp top-[60mm] left-[30mm] text-[30pt] text-danger">ยกเลิก</span>}
          <DocHeader marketName={market?.market_name} docTitle="ใบแจ้งหนี้" number={inv.invoice_no} dateLabel="วันที่ออก" date={formatDate(inv.created_at, { long: true })} />

          <section className="mt-3 grid grid-cols-2 gap-x-5">
            <DocFields
              rows={[
                ['ผู้เช่า', contract?.tenants?.full_name],
                contract?.tenants?.business_name && ['ร้าน', contract.tenants.business_name],
                contract?.tenants?.phone && ['โทร', formatPhone(contract.tenants.phone)],
              ]}
            />
            <DocFields
              rows={[
                [stall?.unit_type === 'room' ? 'ห้อง' : 'แผง', `${stall?.stall_code} โซน ${stall?.zones?.zone_name}`],
                ['สัญญา', contract?.contract_no],
                ['รอบบิล', formatPeriod(inv.billing_period, { long: true })],
              ]}
            />
          </section>

          <table className="mt-4 w-full border-collapse">
            <thead>
              <tr className="border-y border-ink/60 text-left">
                <th className="py-1 font-semibold">รายการ</th>
                <th className="py-1 font-semibold">รายละเอียด</th>
                <th className="py-1 text-right font-semibold">จำนวนเงิน</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([name, detail, amount]) => (
                <tr key={name} className="border-b border-line align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{name}</td>
                  <td className="py-1 pr-2 text-[9.5pt] text-muted">{detail}</td>
                  <td className="py-1 text-right tabular-nums">{formatBaht(amount, { withUnit: false })}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-b-2 border-ink/60">
                <td colSpan={2} className="py-1.5 font-bold">
                  รวมทั้งสิ้น <span className="font-normal text-muted">({bahtText(inv.total_amount)})</span>
                </td>
                <td className="py-1.5 text-right font-bold tabular-nums">{formatBaht(inv.total_amount, { withUnit: false })}</td>
              </tr>
              {paid > 0 && inv.status !== 'cancelled' && (
                <>
                  <tr>
                    <td colSpan={2} className="pt-1 text-muted">
                      ชำระแล้ว
                    </td>
                    <td className="pt-1 text-right tabular-nums">{formatBaht(paid, { withUnit: false })}</td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="font-semibold">
                      คงค้าง
                    </td>
                    <td className="text-right font-semibold tabular-nums">{formatBaht(outstanding, { withUnit: false })}</td>
                  </tr>
                </>
              )}
            </tfoot>
          </table>

          <p className="mt-3">
            <span className="font-semibold">กรุณาชำระภายใน {formatDate(inv.due_date, { long: true })}</span>
          </p>

          {inv.status === 'unpaid' && outstanding > 0 && (
            <section className="mt-3 flex items-center gap-4 rounded-lg border border-line p-3 break-inside-avoid">
              {market?.promptpay_id ? (
                <>
                  <PromptPayQR promptpayId={market.promptpay_id} amount={outstanding} size={112} caption={false} />
                  <div className="min-w-0 text-[10pt] leading-relaxed">
                    <p className="font-semibold">สแกนจ่ายด้วยแอปธนาคาร (พร้อมเพย์)</p>
                    <p>
                      ยอด <span className="font-semibold tabular-nums">{formatBaht(outstanding)}</span>
                    </p>
                    <p className="text-muted">
                      {market.promptpay_name ? `ชื่อบัญชี ${market.promptpay_name}` : ''}
                    </p>
                    <p className="mt-1 text-muted">โอนแล้วส่งสลิปทาง LINE ของตลาด หรือแสดงที่สำนักงาน · ชำระเงินสดได้ที่สำนักงานตลาด</p>
                  </div>
                </>
              ) : (
                <p className="text-muted">ชำระเงินสดได้ที่สำนักงานตลาด</p>
              )}
            </section>
          )}
        </>
      )}
    </PrintLayout>
  )
}
