// ข้อมูลของผู้เช่าที่เข้าผ่าน LINE — ทุกคำสั่งใช้ client ของผู้เช่า (RLS ให้เห็นเฉพาะของตัวเอง)
import { liffSupabase } from './liff'

// ห้าม select('*') กับ tenants (คอลัมน์ id_card ถูกปิดไว้ — ดู migration 002)
export const TENANT_COLS = 'tenant_id, full_name, phone, address, business_name, line_user_id, status, created_at'

const STALL_EMBED = 'stalls(stall_id, stall_code, unit_type, size, size_unit, zones(zone_name, markets(market_name)))'

const must = ({ data, error }) => {
  if (error) throw error
  return data
}

/** ข้อมูลผู้เช่าของบัญชีที่ login อยู่ (null = ยังไม่ผูก หรือถูกระงับ) */
export async function fetchMe() {
  return must(await liffSupabase().from('tenants').select(TENANT_COLS).maybeSingle())
}

/** ใบแจ้งหนี้ทั้งหมด (ไม่รวมใบที่ยกเลิก) ใหม่สุดก่อน */
export async function fetchInvoices() {
  return must(
    await liffSupabase()
      .from('invoices')
      .select(
        `invoice_id, invoice_no, billing_period, total_amount, due_date, status, created_at, payments(payment_id, amount, status), contracts(contract_id, ${STALL_EMBED})`,
      )
      .neq('status', 'cancelled')
      .order('billing_period', { ascending: false })
      .order('invoice_id', { ascending: false }),
  )
}

/** ใบแจ้งหนี้หนึ่งใบ พร้อมมิเตอร์ การชำระ ใบเสร็จ และพร้อมเพย์ของตลาด */
export async function fetchInvoice(id) {
  const client = liffSupabase()
  const [inv, readings] = await Promise.all([
    client
      .from('invoices')
      .select(
        'invoice_id, invoice_no, billing_period, rent_amount, water_amount, electricity_amount, fee_amount, total_amount, due_date, status, created_at, ' +
          'payments(payment_id, payment_date, amount, payment_method, slip_image, transaction_ref, status, note, created_at, receipts(receipt_id, receipt_no)), ' +
          'contracts(contract_id, contract_no, rent_period, tenant_id, stalls(stall_code, unit_type, zones(zone_name, markets(market_name, promptpay_id, promptpay_name))))',
      )
      .eq('invoice_id', id)
      .order('created_at', { referencedTable: 'payments', ascending: false })
      .maybeSingle(),
    client.from('utility_readings').select('utility_type, previous_reading, current_reading, unit_used, rate_per_unit').eq('invoice_id', id),
  ])
  const invoice = must(inv)
  if (!invoice) throw new Error('ไม่พบใบแจ้งหนี้นี้ในบัญชีของคุณ')
  return { invoice, readings: must(readings) }
}

/** สัญญาและคำขอเช่าทั้งหมดของตัวเอง ใหม่สุดก่อน */
export async function fetchContracts() {
  return must(
    await liffSupabase()
      .from('contracts')
      .select(`contract_id, contract_no, start_date, end_date, rent_amount, rent_period, status, note, created_at, ${STALL_EMBED}`)
      .order('created_at', { ascending: false }),
  )
}

/** ใบเสร็จล่าสุด */
export async function fetchRecentReceipts(limit = 3) {
  return must(
    await liffSupabase()
      .from('receipts')
      .select('receipt_id, receipt_no, receipt_date, amount, payments(status, invoices(billing_period))')
      .order('receipt_date', { ascending: false })
      .order('receipt_id', { ascending: false })
      .limit(limit),
  )
}

/** ใบเสร็จหนึ่งใบ */
export async function fetchReceipt(id) {
  const data = must(
    await liffSupabase()
      .from('receipts')
      .select(
        'receipt_id, receipt_no, receipt_date, amount, ' +
          'payments(payment_id, payment_date, payment_method, transaction_ref, status, note, ' +
          'invoices(invoice_id, invoice_no, billing_period, total_amount, contracts(contract_no, tenants(full_name, business_name), ' +
          'stalls(stall_code, unit_type, zones(zone_name, markets(market_name))))))',
      )
      .eq('receipt_id', id)
      .maybeSingle(),
  )
  if (!data) throw new Error('ไม่พบใบเสร็จนี้ในบัญชีของคุณ')
  return data
}

/** ตลาด โซน แผง (พร้อมสถานะ) สำหรับเลือกขอเช่า */
export async function fetchMarkets() {
  return must(
    await liffSupabase()
      .from('markets')
      .select('market_id, market_name, market_type, zones(zone_id, zone_name, stalls(stall_id, stall_code, status, unit_type, size, size_unit, base_rent, rent_period))')
      .eq('status', 'active')
      .order('market_id')
      .order('zone_name', { referencedTable: 'zones' })
      .order('stall_code', { referencedTable: 'zones.stalls' }),
  )
}
