-- =====================================================================
--  ลบข้อมูลจำลองทั้งหมด (คู่กับ demo_data.sql)
--
--  วิธีใช้: คัดลอกไฟล์นี้ทั้งไฟล์ไปวางใน Supabase → SQL Editor → Run
--
--  ลบอะไรบ้าง — เฉพาะที่ผูกกับผู้เช่าจำลอง (เลขบัตรขึ้นต้นด้วย 00990000)
--    • ผู้เช่าจำลอง และสัญญาทุกฉบับของผู้เช่าเหล่านี้
--    • ใบแจ้งหนี้ / การชำระเงิน / ใบเสร็จ ของสัญญาเหล่านี้
--      (รวมถึงที่ทดลองออกเองในหน้าเว็บระหว่างทดลองใช้)
--    • เลขมิเตอร์ของแผงในช่วงเดือนที่ผู้เช่าจำลองเช่าอยู่
--  ไม่แตะ: ตลาด โซน แผง อัตราค่าน้ำไฟ ค่าธรรมเนียม ผู้ใช้ระบบ และข้อมูลผู้เช่าจริง
--  แผงที่ผู้เช่าจำลองเช่าอยู่จะกลับเป็น "ว่าง" อัตโนมัติ
--
--  หมายเหตุ: เลขที่สัญญา/ใบแจ้งหนี้ที่ข้อมูลจำลองใช้ไปจะถูกนำกลับมาใช้ใหม่
--  (ระบบนับต่อจากเลขสูงสุดที่ยังเหลืออยู่)
-- =====================================================================

do $remove$
declare
  v_tenants   int[];
  v_contracts int[];
  v_invoices  int[];
  v_payments  int[];
  n_receipts  int;  n_payments int;  n_readings int;  n_invoices int;  n_contracts int;  n_tenants int;
begin
  select array_agg(tenant_id) into v_tenants from public.tenants where id_card like '00990000%';
  if v_tenants is null then
    raise notice 'ไม่พบข้อมูลจำลอง ไม่มีอะไรต้องลบ';
    return;
  end if;
  select coalesce(array_agg(contract_id), '{}') into v_contracts from public.contracts where tenant_id = any (v_tenants);
  select coalesce(array_agg(invoice_id), '{}')  into v_invoices  from public.invoices  where contract_id = any (v_contracts);
  select coalesce(array_agg(payment_id), '{}')  into v_payments  from public.payments  where invoice_id = any (v_invoices);

  delete from public.receipts where payment_id = any (v_payments);
  get diagnostics n_receipts = row_count;
  delete from public.payments where payment_id = any (v_payments);
  get diagnostics n_payments = row_count;

  -- มิเตอร์: ที่อยู่ในใบแจ้งหนี้จำลอง + ที่ยังไม่ออกบิลของแผงในเดือนที่สัญญาจำลองครอบคลุม
  delete from public.utility_readings u
  where u.invoice_id = any (v_invoices)
     or (u.invoice_id is null and exists (
           select 1 from public.contracts c
           where c.contract_id = any (v_contracts) and c.stall_id = u.stall_id
             and c.status in ('active', 'expired')
             and c.start_date <= private.period_end(u.billing_period)
             and c.end_date >= private.period_start(u.billing_period)));
  get diagnostics n_readings = row_count;

  delete from public.invoices where invoice_id = any (v_invoices);
  get diagnostics n_invoices = row_count;
  delete from public.contracts where contract_id = any (v_contracts);   -- แผงกลับเป็นว่างอัตโนมัติ
  get diagnostics n_contracts = row_count;
  delete from public.tenants where tenant_id = any (v_tenants);
  get diagnostics n_tenants = row_count;

  raise notice 'ลบข้อมูลจำลองแล้ว: ผู้เช่า % · สัญญา % · ใบแจ้งหนี้ % · มิเตอร์ % · การชำระเงิน % · ใบเสร็จ %',
    n_tenants, n_contracts, n_invoices, n_readings, n_payments, n_receipts;
end
$remove$;

-- ตรวจผล: ต้องได้ 0
select count(*) as ผู้เช่าจำลองที่เหลือ from public.tenants where id_card like '00990000%';
