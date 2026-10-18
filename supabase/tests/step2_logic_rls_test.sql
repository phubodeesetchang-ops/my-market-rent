-- =====================================================================
--  ทดสอบขั้นที่ 2 : เลขอัตโนมัติ, สถานะแผงตามสัญญา, สิทธิ์ตามบทบาท (RLS)
--
--  รันบน PostgreSQL ทดสอบในเครื่อง (ไม่ใช่ Supabase จริง) ที่จำลอง auth.uid()
--  และ role anon / authenticated แบบเดียวกับ Supabase หลังรัน migration + seed แล้ว
--  ทุกบรรทัด PASS = ผ่าน, ถ้ามี FAIL สคริปต์จะหยุดทันที
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

-- ---------- ตัวช่วยทดสอบ ----------
create or replace function pg_temp.ok(label text, cond boolean) returns void
language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS  %', label;
end $$;

create or replace function pg_temp.fails(label text, stmt text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'PASS  % → %', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL (ควร error แต่ผ่าน): %', label;
end $$;

-- จำนวนแถวที่คำสั่ง update/delete ทำได้จริง (RLS ปฏิเสธแบบเงียบ = 0)
create or replace function pg_temp.affected(stmt text) returns int
language plpgsql as $$
declare n int;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- ---------- สลับผู้ใช้ (จำลอง JWT ของ Supabase) ----------
\set as_postgres  'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_anon      'set role anon; select set_config(''request.jwt.claims'', ''{"role":"anon"}'', false) \\g /dev/null'
\set as_admin     'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_staff     'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_manager   'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}'', false) \\g /dev/null'
\set as_inactive  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000004","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant1   'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant2   'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_stranger  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'

-- ---------- ข้อมูลตั้งต้นของการทดสอบ (ทำในฐานะ postgres) ----------
:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test'),
  ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test'),
  ('a0000000-0000-0000-0000-000000000004', 'old-staff@test'),
  ('b0000000-0000-0000-0000-000000000001', 'line-tenant1'),
  ('b0000000-0000-0000-0000-000000000002', 'line-tenant2'),
  ('c0000000-0000-0000-0000-000000000001', 'stranger');
insert into users (user_id, username, full_name, role, status) values
  ('a0000000-0000-0000-0000-000000000001', 'admin',    'ผู้ดูแลระบบ', 'admin',   'active'),
  ('a0000000-0000-0000-0000-000000000002', 'staff',    'เจ้าหน้าที่',  'staff',   'active'),
  ('a0000000-0000-0000-0000-000000000003', 'manager',  'ผู้บริหาร',   'manager', 'active'),
  ('a0000000-0000-0000-0000-000000000004', 'oldstaff', 'เจ้าหน้าที่เก่า', 'staff', 'inactive');
insert into tenants (full_name, id_card, phone, line_user_id, auth_id) values
  ('สมชาย ใจดี',  '1234567890123', '0810000001', 'U-tenant1', 'b0000000-0000-0000-0000-000000000001'),
  ('สมหญิง รักดี', '9876543210987', '0810000002', 'U-tenant2', 'b0000000-0000-0000-0000-000000000002');

-- รหัสแผงที่ใช้ทดสอบ (ตลาดเช้า)
select s.stall_id as s_a001 from stalls s join zones z using (zone_id) join markets m using (market_id)
 where m.market_name = 'ตลาดเช้า' and s.stall_code = 'A001' \gset
select s.stall_id as s_a002 from stalls s join zones z using (zone_id) join markets m using (market_id)
 where m.market_name = 'ตลาดเช้า' and s.stall_code = 'A002' \gset
select s.stall_id as s_b001 from stalls s join zones z using (zone_id) join markets m using (market_id)
 where m.market_name = 'ตลาดเช้า' and s.stall_code = 'B001' \gset
select s.stall_id as s_c001 from stalls s join zones z using (zone_id) join markets m using (market_id)
 where m.market_name = 'ตลาดเช้า' and s.stall_code = 'C001' \gset
select z.zone_id as zone_a from zones z join markets m using (market_id)
 where m.market_name = 'ตลาดเช้า' and z.zone_name = 'A' \gset

\echo ''
\echo '=== A. ผู้ที่ยังไม่ login (anon) ==='
:as_anon
select pg_temp.fails('anon อ่านตารางแผงไม่ได้', 'select count(*) from stalls');
select pg_temp.fails('anon เรียกดูเลขบัตรไม่ได้', 'select get_tenant_id_card(1)');

\echo ''
\echo '=== B. login แล้วแต่ไม่ได้ผูกกับผู้เช่า/เจ้าหน้าที่ ==='
:as_stranger
select pg_temp.ok('ไม่เห็นแผงเลย', (select count(*) from stalls) = 0);
select pg_temp.ok('ไม่เห็นผู้เช่าเลย', (select count(*) from tenants) = 0);
select pg_temp.fails('ดูเลขบัตรประชาชนของใครไม่ได้', 'select get_tenant_id_card(1)');
select pg_temp.fails('ส่งคำขอเช่าไม่ได้', format(
  'insert into contracts (stall_id, start_date, end_date) values (%s, ''2026-11-01'', ''2027-10-31'')', :s_c001));

\echo ''
\echo '=== C. ผู้เช่า: ดูข้อมูลและส่งคำขอเช่า ==='
:as_tenant1
select pg_temp.ok('เห็นแผงทั้งหมด 96 แผง', (select count(*) from stalls) = 96);
select pg_temp.ok('เห็นตลาด 3 แห่ง อัตราน้ำไฟ 6 รายการ ค่าธรรมเนียม 3 รายการ',
  (select count(*) from markets) = 3 and (select count(*) from utility_rates) = 6 and (select count(*) from fees) = 3);
select pg_temp.ok('เห็นข้อมูลผู้เช่าแค่ของตัวเอง', (select count(*) from tenants) = 1
  and (select full_name from tenants) = 'สมชาย ใจดี');
select pg_temp.fails('อ่านคอลัมน์ id_card ตรง ๆ ไม่ได้', 'select id_card from tenants');
select pg_temp.fails('ใช้ select * กับ tenants ไม่ได้ (เพราะมี id_card)', 'select * from tenants');
select pg_temp.ok('ดูเลขบัตรของตัวเองผ่านฟังก์ชันได้', get_tenant_id_card(1) = '1234567890123');
select pg_temp.fails('ดูเลขบัตรของคนอื่นไม่ได้', 'select get_tenant_id_card(2)');
select pg_temp.ok('แก้สถานะแผงไม่ได้ (0 แถว)',
  pg_temp.affected(format('update stalls set status = ''maintenance'' where stall_id = %s', :s_a001)) = 0);

-- ส่งคำขอเช่าโดยแอบใส่ tenant_id คนอื่น ค่าเช่า 1 บาท สถานะ active → ระบบต้องแก้ให้ถูกเอง
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status)
values (2, :s_a001, '2026-11-01', '2027-10-31', 1, 'yearly', 'active');
select pg_temp.ok('คำขอเช่าถูกบันทึกเป็นของตัวเอง สถานะรออนุมัติ ค่าเช่าตามแผง 150/เดือน',
  (select count(*) from contracts where tenant_id = 1 and status = 'pending'
     and rent_amount = 150 and rent_period = 'monthly' and created_by is null) = 1);
select pg_temp.ok('ได้เลขสัญญา CT-2569-0001', (select contract_no from contracts) = 'CT-2569-0001');
select pg_temp.ok('แผง A001 เปลี่ยนเป็น "จอง" อัตโนมัติ',
  (select status from stalls where stall_id = :s_a001) = 'reserved');
select pg_temp.fails('แก้ค่าเช่าในคำขอของตัวเองไม่ได้', 'update contracts set rent_amount = 1');
select pg_temp.ok('แก้เบอร์โทรของตัวเองได้', pg_temp.affected('update tenants set phone = ''0899999999''') = 1);
select pg_temp.fails('แก้สถานะผู้เช่าของตัวเองไม่ได้', 'update tenants set status = ''inactive''');
select pg_temp.fails('เพิ่มผู้เช่าใหม่เองไม่ได้', 'insert into tenants (full_name) values (''x'')');
select pg_temp.fails('จดมิเตอร์เองไม่ได้', format(
  'insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading, rate_per_unit) values (%s, ''water'', ''2026-10'', 0, 1, 5)', :s_a001));

:as_tenant2
select pg_temp.fails('ผู้เช่าอีกคนจองแผงที่ถูกจองแล้วไม่ได้', format(
  'insert into contracts (stall_id, start_date, end_date) values (%s, ''2026-11-01'', ''2027-10-31'')', :s_a001));
select pg_temp.ok('ผู้เช่าอีกคนไม่เห็นสัญญาของผู้เช่าคนแรก', (select count(*) from contracts) = 0);
select pg_temp.ok('ผู้เช่าอีกคนเห็นว่าแผง A001 "จอง" แล้ว',
  (select status from stalls where stall_id = :s_a001) = 'reserved');

\echo ''
\echo '=== D. เจ้าหน้าที่ (staff) ==='
:as_staff
select pg_temp.ok('เห็นผู้เช่าทั้งหมด', (select count(*) from tenants) = 2);
select pg_temp.fails('อ่านคอลัมน์ id_card ตรง ๆ ไม่ได้เหมือนกัน', 'select id_card from tenants');
select pg_temp.ok('ดูเลขบัตรผ่านฟังก์ชันได้', get_tenant_id_card(2) = '9876543210987');

update contracts set status = 'active', deposit_amount = 300 where contract_no = 'CT-2569-0001';
select contract_id as c1 from contracts where contract_no = 'CT-2569-0001' \gset
select pg_temp.ok('อนุมัติสัญญาแล้วแผง A001 เป็น "เช่า"', (select status from stalls where stall_id = :s_a001) = 'rented');
select pg_temp.fails('เปลี่ยนสัญญาที่ใช้งานกลับเป็นรออนุมัติไม่ได้',
  'update contracts set status = ''pending'' where contract_no = ''CT-2569-0001''');

select pg_temp.fails('ตั้งแผงว่างเป็น "เช่า" เองไม่ได้', format('update stalls set status = ''rented'' where stall_id = %s', :s_a002));
select pg_temp.ok('ตั้งแผงว่างเป็น "ซ่อมบำรุง" ได้',
  pg_temp.affected(format('update stalls set status = ''maintenance'' where stall_id = %s', :s_a002)) = 1);
select pg_temp.fails('จองแผงที่ซ่อมบำรุงไม่ได้', format(
  'insert into contracts (tenant_id, stall_id, start_date, end_date) values (2, %s, ''2026-11-01'', ''2027-10-31'')', :s_a002));
select pg_temp.ok('ตั้งกลับเป็น "ว่าง" ได้',
  pg_temp.affected(format('update stalls set status = ''vacant'' where stall_id = %s', :s_a002)) = 1);
select pg_temp.fails('ตั้งแผงที่เช่าอยู่เป็น "ว่าง" เองไม่ได้', format('update stalls set status = ''vacant'' where stall_id = %s', :s_a001));

insert into stalls (zone_id) values (:zone_a);
select pg_temp.ok('เพิ่มแผงใหม่ในโซน A โดยไม่ใส่รหัส → ได้ A011',
  (select stall_code from stalls where zone_id = :zone_a order by stall_id desc limit 1) = 'A011');

select pg_temp.fails('ทำสัญญาใหม่บนแผงที่เช่าอยู่ไม่ได้', format(
  'insert into contracts (tenant_id, stall_id, start_date, end_date, status) values (2, %s, ''2027-11-01'', ''2028-10-31'', ''active'')', :s_a001));
select pg_temp.fails('ต่ออายุโดยวันเริ่มทับสัญญาเดิมไม่ได้', format(
  'insert into contracts (tenant_id, stall_id, start_date, end_date, status, renewed_from_id) values (1, %s, ''2027-10-01'', ''2028-10-31'', ''active'', %s)', :s_a001, :c1));
select pg_temp.fails('ต่ออายุให้ผู้เช่าคนอื่นไม่ได้', format(
  'insert into contracts (tenant_id, stall_id, start_date, end_date, status, renewed_from_id) values (2, %s, ''2027-11-01'', ''2028-10-31'', ''active'', %s)', :s_a001, :c1));
insert into contracts (tenant_id, stall_id, start_date, end_date, status, renewed_from_id)
values (1, :s_a001, '2027-11-01', '2028-10-31', 'active', :c1);
select pg_temp.ok('ต่ออายุสัญญาได้ → CT-2569-0002 ค่าเช่าตามแผง ผู้สร้าง = staff',
  (select count(*) from contracts where contract_no = 'CT-2569-0002' and renewed_from_id = :c1
     and rent_amount = 150 and created_by = 'a0000000-0000-0000-0000-000000000002') = 1);

-- สัญญาเก่าที่หมดอายุแล้ว → ปุ่มปิดสัญญาที่หมดอายุ
insert into contracts (tenant_id, stall_id, start_date, end_date, status)
values (2, :s_b001, '2025-01-01', '2025-12-31', 'active');
select pg_temp.ok('แผง B001 เป็น "เช่า"', (select status from stalls where stall_id = :s_b001) = 'rented');
select pg_temp.ok('expire_contracts() ปิดสัญญาที่หมดอายุ 1 สัญญา', expire_contracts() = 1);
select pg_temp.ok('สัญญานั้นเป็น "สิ้นสุด" และแผง B001 กลับเป็น "ว่าง"',
  (select status from contracts where contract_no = 'CT-2569-0003') = 'expired'
  and (select status from stalls where stall_id = :s_b001) = 'vacant');

-- ใบแจ้งหนี้
insert into invoices (contract_id, billing_period, rent_amount, water_amount, electricity_amount, fee_amount, due_date)
values ((select contract_id from contracts where contract_no = 'CT-2569-0001'), '2026-11', 150, 25, 60, 5, '2026-12-05');
insert into invoices (contract_id, billing_period, rent_amount, due_date)
values ((select contract_id from contracts where contract_no = 'CT-2569-0002'), '2027-11', 150, '2027-12-05');
select pg_temp.ok('เลขใบแจ้งหนี้ตามรอบบิล: INV-256911-0001 และ INV-257011-0001',
  (select string_agg(invoice_no, ',' order by invoice_id) from invoices) = 'INV-256911-0001,INV-257011-0001');
select invoice_id as inv1 from invoices where invoice_no = 'INV-256911-0001' \gset
select invoice_id as inv2 from invoices where invoice_no = 'INV-257011-0001' \gset
select pg_temp.ok('ผู้ออกใบแจ้งหนี้ = staff อัตโนมัติ',
  (select bool_and(created_by = 'a0000000-0000-0000-0000-000000000002') from invoices));
select pg_temp.fails('แก้เลขใบแจ้งหนี้ไม่ได้', 'update invoices set invoice_no = ''X'' where invoice_no = ''INV-256911-0001''');
select pg_temp.ok('staff ลบใบแจ้งหนี้ไม่ได้ (0 แถว)', pg_temp.affected('delete from invoices') = 0);
select pg_temp.ok('staff แก้บทบาทตัวเองไม่ได้ (0 แถว)', pg_temp.affected('update users set role = ''admin''') = 0);
select pg_temp.ok('staff เห็นข้อมูลผู้ใช้ระบบแค่ของตัวเอง', (select count(*) from users) = 1);
select pg_temp.fails('staff เพิ่มตลาดไม่ได้', 'insert into markets (market_name, market_type) values (''x'', ''market'')');
select pg_temp.fails('staff แก้อัตราค่าไฟไม่ได้', 'insert into utility_rates (market_id, utility_type, rate_per_unit, effective_from) values (1, ''water'', 9, ''2030-01-01'')');

\echo ''
\echo '=== E. ผู้เช่าแจ้งชำระเงิน ==='
:as_tenant1
select pg_temp.ok('เห็นใบแจ้งหนี้ของตัวเอง 2 ใบ', (select count(*) from invoices) = 2);
insert into payments (invoice_id, amount, payment_method, slip_image, status, verified_by, verified_at)
values ((select invoice_id from invoices where invoice_no = 'INV-256911-0001'), 240, 'promptpay', 'slips/1/slip.jpg', 'verified', 'b0000000-0000-0000-0000-000000000001', now());
select pg_temp.ok('แอบตั้งสถานะ "ตรวจแล้ว" ไม่ได้ → ถูกบันทึกเป็น "รอตรวจสอบ"',
  (select count(*) from payments where status = 'pending' and verified_by is null and verified_at is null) = 1);
select pg_temp.ok('วันที่ชำระเป็นวันที่ไทยอัตโนมัติ', (select payment_date from payments) = (now() at time zone 'Asia/Bangkok')::date);
select pg_temp.ok('แก้การชำระเงินเองไม่ได้ (0 แถว)', pg_temp.affected('update payments set amount = 1') = 0);
-- แจ้งชำระซ้ำอีกครั้งแบบขอข้อมูลกลับ (.insert().select()) แล้วลบทิ้งในฐานะระบบ
insert into payments (invoice_id, amount, payment_method)
values ((select invoice_id from invoices where invoice_no = 'INV-256911-0001'), 1, 'transfer')
returning payment_id as tmp_payment \gset
select pg_temp.ok('แจ้งชำระแล้วได้ข้อมูลแถวใหม่กลับมาทันที (.insert().select())', :tmp_payment > 0);
:as_postgres
delete from payments where payment_id = :tmp_payment;
:as_tenant1
:as_tenant2
select pg_temp.ok('ผู้เช่าอีกคนไม่เห็นใบแจ้งหนี้/การชำระของคนแรก',
  (select count(*) from invoices) = 0 and (select count(*) from payments) = 0);
select pg_temp.fails('ผู้เช่าอีกคนแจ้งชำระบิลของคนแรกไม่ได้',
  format('insert into payments (invoice_id, amount, payment_method) values (%s, 240, ''transfer'')', :inv1));

:as_staff
update invoices set status = 'cancelled' where invoice_no = 'INV-257011-0001';
:as_tenant1
select pg_temp.fails('แจ้งชำระบิลที่ยกเลิกแล้วไม่ได้',
  format('insert into payments (invoice_id, amount, payment_method) values (%s, 150, ''transfer'')', :inv2));

\echo ''
\echo '=== F. เจ้าหน้าที่ตรวจสลิปและออกใบเสร็จ ==='
:as_staff
update payments set status = 'verified' where status = 'pending';
select pg_temp.ok('ตรวจสลิปแล้ว ผู้ตรวจ = staff และมีเวลาตรวจอัตโนมัติ',
  (select count(*) from payments where status = 'verified'
     and verified_by = 'a0000000-0000-0000-0000-000000000002' and verified_at is not null) = 1);
-- (ตั้งแต่ migration 007 ระบบออกใบเสร็จให้เองเมื่อตรวจผ่าน)
select pg_temp.ok('ออกใบเสร็จให้อัตโนมัติ: เลข RC-<พ.ศ.><เดือนนี้>-0001 ผู้ออก = staff',
  (select receipt_no from receipts) = 'RC-' || ((now() at time zone 'Asia/Bangkok')::date + interval '543 years')::date::text::varchar(4)
                                       || to_char((now() at time zone 'Asia/Bangkok'), 'MM') || '-0001'
  and (select issued_by from receipts) = 'a0000000-0000-0000-0000-000000000002');
select receipt_no as "ใบเสร็จที่ออก" from receipts;
select pg_temp.ok('ยอดครบ → ใบแจ้งหนี้เป็น "ชำระแล้ว" อัตโนมัติ', (select status from invoices where invoice_id = :inv1) = 'paid');
:as_tenant1
select pg_temp.ok('ผู้เช่าเห็นใบเสร็จของตัวเอง', (select count(*) from receipts) = 1);
:as_tenant2
select pg_temp.ok('ผู้เช่าอีกคนไม่เห็นใบเสร็จนี้', (select count(*) from receipts) = 0);

\echo ''
\echo '=== G. ผู้บริหาร (manager) ดูได้อย่างเดียว ==='
:as_manager
select pg_temp.ok('เห็นสัญญาทั้งหมด 3 สัญญา และผู้เช่า 2 คน',
  (select count(*) from contracts) = 3 and (select count(*) from tenants) = 2);
select pg_temp.ok('เห็นใบแจ้งหนี้ การชำระ ใบเสร็จทั้งหมด',
  (select count(*) from invoices) = 2 and (select count(*) from payments) = 1 and (select count(*) from receipts) = 1);
select pg_temp.fails('manager เพิ่มแผงไม่ได้', format('insert into stalls (zone_id) values (%s)', :zone_a));
select pg_temp.ok('manager แก้สัญญาไม่ได้ (0 แถว)', pg_temp.affected('update contracts set deposit_amount = 0') = 0);
select pg_temp.fails('manager กดปิดสัญญาหมดอายุไม่ได้', 'select expire_contracts()');
select pg_temp.fails('manager ดูเลขบัตรประชาชนไม่ได้', 'select get_tenant_id_card(1)');

\echo ''
\echo '=== H. ผู้ดูแลระบบ (admin) ==='
:as_admin
select pg_temp.ok('admin เห็นผู้ใช้ระบบทั้งหมด 4 คน', (select count(*) from users) = 4);
insert into markets (market_name, market_type) values ('ตลาดทดสอบ', 'market');
select pg_temp.ok('admin เพิ่มตลาดได้', (select count(*) from markets) = 4);
select pg_temp.ok('admin ลบตลาดที่ยังไม่มีโซนได้', pg_temp.affected('delete from markets where market_name = ''ตลาดทดสอบ''') = 1);

\echo ''
\echo '=== I. เจ้าหน้าที่ที่ถูกระงับ ==='
:as_inactive
select pg_temp.ok('บัญชีที่ถูกระงับไม่เห็นข้อมูลใดเลย',
  (select count(*) from stalls) = 0 and (select count(*) from contracts) = 0);

\echo ''
\echo '=== J. ผู้เช่ายกเลิกคำขอเช่าของตัวเอง ==='
:as_tenant2
-- insert ... returning = แบบที่ supabase-js ใช้ตอน .insert().select()
insert into contracts (stall_id, start_date, end_date) values (:s_c001, '2026-11-01', '2027-10-31')
returning contract_no as new_contract_no \gset
select pg_temp.ok('insert แล้วได้ข้อมูลแถวใหม่กลับมาทันที (.insert().select())', :'new_contract_no' like 'CT-2569-%');
select pg_temp.ok('คำขอใหม่ → แผง C001 "จอง"', (select status from stalls where stall_id = :s_c001) = 'reserved');
select pg_temp.ok('ยกเลิกคำขอได้', pg_temp.affected('update contracts set status = ''cancelled'' where status = ''pending''') = 1);
select pg_temp.ok('แผง C001 กลับเป็น "ว่าง"', (select status from stalls where stall_id = :s_c001) = 'vacant');
select pg_temp.ok('แก้คำขอที่ยกเลิกแล้วไม่ได้ (0 แถว)', pg_temp.affected('update contracts set status = ''cancelled''') = 0);

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
