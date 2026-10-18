-- =====================================================================
--  ทดสอบขั้นที่ 7: การชำระเงิน (migration 007)
--  พร้อมเพย์ของตลาด · ที่เก็บสลิป · ตรวจผ่าน/ไม่ผ่าน · รับชำระ · แบ่งจ่าย · ยกเลิกใบเสร็จ · ความถูกต้องของใบแจ้งหนี้
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS  %', label;
end $$;
create or replace function pg_temp.fails(label text, stmt text, expect text default null) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then
    if expect is not null and sqlerrm !~ expect and sqlstate !~ expect then
      raise exception 'FAIL (error ไม่ตรงที่คาด): % → % %', label, sqlstate, sqlerrm;
    end if;
    raise notice 'PASS  % → %', label, sqlerrm; return;
  end;
  raise exception 'FAIL (ควร error แต่ผ่าน): %', label;
end $$;
create or replace function pg_temp.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin execute stmt; get diagnostics n = row_count; return n; end $$;
create or replace function pg_temp.stall(m text, z text, code text) returns int language sql as $$
  select s.stall_id from public.stalls s join public.zones zz using (zone_id) join public.markets mm using (market_id)
  where mm.market_name = m and zz.zone_name = z and s.stall_code = code
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set as_postgres 'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_anon     'set role anon; select set_config(''request.jwt.claims'', ''{"role":"anon"}'', false) \\g /dev/null'
\set as_admin    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_manager  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant1  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant2  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'

:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test'), ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test'),
  ('b0000000-0000-0000-0000-000000000001', 'line-1'), ('b0000000-0000-0000-0000-000000000002', 'line-2');
insert into users (user_id, username, full_name, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin', 'สุดา ผู้ดูแล', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff', 'วิไล เจ้าหน้าที่', 'staff'),
  ('a0000000-0000-0000-0000-000000000003', 'manager', 'ผู้บริหาร', 'manager');
insert into tenants (full_name, phone, auth_id) values
  ('ผู้เช่าหนึ่ง', '0810000001', 'b0000000-0000-0000-0000-000000000001'),
  ('ผู้เช่าสอง', '0810000002', 'b0000000-0000-0000-0000-000000000002');
select tenant_id as t1 from tenants where full_name = 'ผู้เช่าหนึ่ง' \gset
select tenant_id as t2 from tenants where full_name = 'ผู้เช่าสอง' \gset
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status) values
  (:t1, pg_temp.stall('ตลาดเย็น', 'A', 'A001'), '2026-01-01', '2026-12-31', 150, 'monthly', 'active'),
  (:t2, pg_temp.stall('ตลาดเย็น', 'A', 'A002'), '2026-01-01', '2026-12-31', 150, 'monthly', 'active');
select contract_id as c1 from contracts where tenant_id = :t1 \gset
select contract_id as c2 from contracts where tenant_id = :t2 \gset
-- ใบของผู้เช่าหนึ่ง: 585 (ก.ย.), 300 (ส.ค.), 155 (ก.ค.) · ผู้เช่าสอง: 155 (ก.ย.)
insert into invoices (contract_id, billing_period, rent_amount, water_amount, electricity_amount, fee_amount, due_date) values
  (:c1, '2026-09', 150, 30, 400, 5, '2026-10-05'),
  (:c1, '2026-08', 150, 20, 125, 5, '2026-09-05'),
  (:c1, '2026-07', 150, 0, 0, 5, '2026-08-05'),
  (:c2, '2026-09', 150, 0, 0, 5, '2026-10-05');
select invoice_id as i1 from invoices where contract_id = :c1 and billing_period = '2026-09' \gset
select invoice_id as i1b from invoices where contract_id = :c1 and billing_period = '2026-08' \gset
select invoice_id as i1c from invoices where contract_id = :c1 and billing_period = '2026-07' \gset
select invoice_id as i2 from invoices where contract_id = :c2 \gset

\echo '=== 1) พร้อมเพย์ของตลาด ==='
:as_admin
update markets set promptpay_id = '0812345678', promptpay_name = 'เทศบาลตำบลตัวอย่าง' where market_name = 'ตลาดเย็น';
select pg_temp.ok('ผู้ดูแลระบบตั้งพร้อมเพย์ของตลาดได้', (select promptpay_id from markets where market_name = 'ตลาดเย็น') = '0812345678');
select pg_temp.fails('เลขพร้อมเพย์ผิดรูปแบบ (ไม่ใช่ 10 หลักขึ้นต้น 0 หรือ 13 หลัก) → 23514',
  'update markets set promptpay_id = ''081-234-5678'' where market_name = ''ตลาดเย็น''', '23514');
update markets set promptpay_id = '0994000123456' where market_name = 'อาคาร OTOP';
select pg_temp.ok('เลขผู้เสียภาษี 13 หลักใช้ได้', (select promptpay_id from markets where market_name = 'อาคาร OTOP') = '0994000123456');
:as_staff
select pg_temp.ok('เจ้าหน้าที่แก้พร้อมเพย์ไม่ได้ (0 แถว)', pg_temp.affected('update markets set promptpay_id = ''0899999999''') = 0);
:as_tenant1
select pg_temp.ok('ผู้เช่าเห็นพร้อมเพย์และชื่อบัญชีของตลาด (ใช้สร้าง QR)',
  (select promptpay_id || ' ' || promptpay_name from markets where market_name = 'ตลาดเย็น') = '0812345678 เทศบาลตำบลตัวอย่าง');

\echo '=== 2) ที่เก็บสลิป ==='
:as_postgres
select pg_temp.ok('bucket slips: ไม่เปิดสาธารณะ, ไม่เกิน 5 MB, รับเฉพาะรูป',
  (select not public and file_size_limit = 5242880 and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'] from storage.buckets where id = 'slips'));
:as_tenant1
insert into storage.objects (bucket_id, name) values ('slips', format('%s/%s/slip1.jpg', :t1, :i1));
select pg_temp.ok('ผู้เช่าอัปโหลดสลิปลงโฟลเดอร์ของตัวเอง/ใบแจ้งหนี้ของตัวเองได้', (select count(*) from storage.objects) = 1);
select pg_temp.fails('อัปโหลดลงโฟลเดอร์ของผู้เช่าอื่นไม่ได้',
  format('insert into storage.objects (bucket_id, name) values (''slips'', ''%s/%s/x.jpg'')', :t2, :i2), 'row-level security');
select pg_temp.fails('อัปโหลดโดยอ้างใบแจ้งหนี้ของคนอื่นไม่ได้',
  format('insert into storage.objects (bucket_id, name) values (''slips'', ''%s/%s/x.jpg'')', :t1, :i2), 'row-level security');
select pg_temp.fails('อัปโหลดไว้นอกโฟลเดอร์ไม่ได้', 'insert into storage.objects (bucket_id, name) values (''slips'', ''x.jpg'')', 'row-level security');
:as_tenant2
select pg_temp.ok('ผู้เช่าอีกคนมองไม่เห็นสลิปของคนแรก', (select count(*) from storage.objects) = 0);
insert into storage.objects (bucket_id, name) values ('slips', format('%s/%s/slip2.jpg', :t2, :i2));
:as_staff
select pg_temp.ok('เจ้าหน้าที่เห็นสลิปทุกคน', (select count(*) from storage.objects where bucket_id = 'slips') = 2);
insert into storage.objects (bucket_id, name) values ('slips', format('%s/%s/counter.jpg', :t1, :i1));
select pg_temp.ok('เจ้าหน้าที่อัปโหลดสลิปแทนผู้เช่าได้ (รับชำระที่สำนักงาน)', (select count(*) from storage.objects) = 3);
select pg_temp.ok('เจ้าหน้าที่ลบสลิปไม่ได้ (0 แถว)', pg_temp.affected('delete from storage.objects') = 0);
:as_manager
select pg_temp.ok('ผู้บริหารเห็นสลิปได้', (select count(*) from storage.objects) = 3);
select pg_temp.fails('ผู้บริหารอัปโหลดไม่ได้',
  format('insert into storage.objects (bucket_id, name) values (''slips'', ''%s/%s/m.jpg'')', :t1, :i1), 'row-level security');
:as_anon
select pg_temp.ok('ผู้ที่ไม่ได้ login มองไม่เห็นสลิป', (select count(*) from storage.objects) = 0);
:as_admin
select pg_temp.ok('ผู้ดูแลระบบลบสลิปได้', pg_temp.affected(format('delete from storage.objects where name = ''%s/%s/counter.jpg''', :t1, :i1)) = 1);

\echo '=== 3) ผู้เช่าแจ้งชำระ (แบ่งจ่ายได้ ห้ามเกินยอดค้าง) ==='
:as_tenant1
insert into payments (invoice_id, amount, payment_method, slip_image, transaction_ref)
values (:i1, 300, 'promptpay', format('%s/%s/slip1.jpg', :t1, :i1), 'REF001')
returning payment_id as p1 \gset
select pg_temp.ok('แจ้งชำระ 300 จาก 585 ได้ (สถานะรอตรวจสอบ)', (select status from payments where payment_id = :p1) = 'pending');
select pg_temp.fails('แจ้งชำระเกินยอดค้าง → ข้อความไทยบอกยอดค้าง',
  format('insert into payments (invoice_id, amount, payment_method) values (%s, 600, ''transfer'')', :i1), 'เกินยอดค้างชำระ \(ค้าง 585.00 บาท\)');
select pg_temp.fails('วันที่ชำระล่วงหน้าไม่ได้',
  format('insert into payments (invoice_id, amount, payment_method, payment_date) values (%s, 10, ''transfer'', private.today_th() + 1)', :i1), 'ไม่เกินวันนี้');
select pg_temp.fails('ผู้เช่าตรวจผ่านเองไม่ได้ (42501)', format('select verify_payment(%s)', :p1), '42501');
select pg_temp.ok('ผู้เช่าแก้การชำระไม่ได้ (0 แถว)', pg_temp.affected('update payments set amount = 1') = 0);

\echo '=== 4) ตรวจผ่าน → ใบเสร็จอัตโนมัติ · แบ่งจ่าย ==='
:as_manager
select pg_temp.fails('ผู้บริหารตรวจไม่ได้ (42501)', format('select verify_payment(%s)', :p1), '42501');
:as_staff
select verify_payment(:p1, 250) as rc1 \gset
select pg_temp.ok('ตรวจผ่านโดยแก้ยอดเป็นยอดที่ได้รับจริง 250 → คืนเลขใบเสร็จ RC-… ยอด 250 ผู้ออก = เจ้าหน้าที่',
  :'rc1' ~ '^RC-\d{6}-\d{4}$'
  and (select amount = 250 and issued_by = 'a0000000-0000-0000-0000-000000000002' from receipts where receipt_no = :'rc1')
  and (select amount = 250 and verified_by = 'a0000000-0000-0000-0000-000000000002' from payments where payment_id = :p1));
select pg_temp.ok('ยังไม่ครบยอด → ใบแจ้งหนี้ยังรอชำระ', (select status from invoices where invoice_id = :i1) = 'unpaid');
select pg_temp.fails('ตรวจซ้ำไม่ได้', format('select verify_payment(%s)', :p1), 'ตรวจไปแล้ว');
select pg_temp.fails('รับชำระเกินยอดค้าง → บอกยอดค้างที่เหลือ',
  format('select * from record_payment(%s, 400, ''cash'')', :i1), 'ค้าง 335.00 บาท');
select pg_temp.fails('แก้ยอดของการชำระที่ตรวจแล้วไม่ได้', format('update payments set amount = 1 where payment_id = %s', :p1), 'แก้ยอดเงิน');
select payment_id as p2, receipt_no as rc2 from record_payment(:i1, 335, 'cash') \gset
select pg_temp.ok('รับเงินสดส่วนที่เหลือ 335 → ใบเสร็จใบที่สอง และใบแจ้งหนี้เป็นชำระแล้วอัตโนมัติ',
  :'rc2' <> :'rc1' and (select status from invoices where invoice_id = :i1) = 'paid'
  and (select count(*) from receipts r join payments p using (payment_id) where p.invoice_id = :i1) = 2);
select pg_temp.fails('รับชำระใบที่ชำระครบแล้วไม่ได้', format('select * from record_payment(%s, 1, ''cash'')', :i1), 'ชำระครบแล้ว');
select pg_temp.fails('ยอด 0 ไม่ได้', format('select * from record_payment(%s, 0, ''cash'')', :i1b), 'มากกว่า 0');
select pg_temp.fails('แก้ใบเสร็จไม่ได้', format('update receipts set amount = 1 where receipt_no = %L', :'rc2'), 'แก้ไขหรือลบไม่ได้');
:as_admin
select pg_temp.fails('ลบใบเสร็จไม่ได้ (แม้เป็นผู้ดูแลระบบ)', format('delete from receipts where receipt_no = %L', :'rc2'), 'แก้ไขหรือลบไม่ได้');
:as_tenant1
select pg_temp.ok('ผู้เช่าเห็นใบเสร็จของตัวเอง 2 ใบ', (select count(*) from receipts) = 2);
select pg_temp.fails('แจ้งชำระใบที่ชำระครบแล้วไม่ได้', format('insert into payments (invoice_id, amount, payment_method) values (%s, 1, ''transfer'')', :i1));

\echo '=== 5) ไม่ผ่าน (ต้องมีเหตุผล) ==='
:as_tenant1
insert into payments (invoice_id, amount, payment_method, transaction_ref) values (:i1b, 300, 'transfer', 'REF002') returning payment_id as p3 \gset
:as_staff
select pg_temp.fails('ออกใบเสร็จเองให้การชำระที่ยังไม่ตรวจไม่ได้',
  format('insert into receipts (payment_id, amount) values (%s, 300)', :p3), 'เฉพาะการชำระที่ตรวจสอบแล้ว');
select pg_temp.fails('ไม่ผ่านโดยไม่ใส่เหตุผลไม่ได้', format('select reject_payment(%s, ''  '')', :p3), 'ระบุเหตุผล');
select reject_payment(:p3, 'ยอดในสลิปไม่ตรงกับที่แจ้ง') \g /dev/null
select pg_temp.ok('ไม่ผ่าน → สถานะไม่ผ่าน เก็บเหตุผลไว้ ไม่มีใบเสร็จ ใบแจ้งหนี้ยังรอชำระ',
  (select status = 'rejected' and note = 'ยอดในสลิปไม่ตรงกับที่แจ้ง' and verified_at is not null from payments where payment_id = :p3)
  and not exists (select 1 from receipts where payment_id = :p3) and (select status from invoices where invoice_id = :i1b) = 'unpaid');
select pg_temp.fails('รายการที่ไม่ผ่านแล้วตรวจผ่านอีกไม่ได้ (ให้แจ้งใหม่)', format('select verify_payment(%s)', :p3), 'ตรวจไปแล้ว');
select pg_temp.fails('รายการที่ไม่ผ่านเปลี่ยนสถานะตรง ๆ ไม่ได้', format('update payments set status = ''verified'' where payment_id = %s', :p3), 'เปลี่ยนสถานะไม่ได้');
:as_tenant1
select pg_temp.ok('ผู้เช่าเห็นเหตุผลที่ไม่ผ่าน', (select note from payments where payment_id = :p3) = 'ยอดในสลิปไม่ตรงกับที่แจ้ง');

\echo '=== 6) ยกเลิกใบเสร็จ (ผู้ดูแลระบบ) ==='
:as_staff
select pg_temp.fails('เจ้าหน้าที่ยกเลิกใบเสร็จไม่ได้ (42501)', format('select void_payment(%s, ''ผิด'')', :p2), '42501');
select pg_temp.fails('เจ้าหน้าที่เปลี่ยนสถานะการชำระที่ตรวจแล้วตรง ๆ ไม่ได้', format('update payments set status = ''rejected'' where payment_id = %s', :p2), '42501');
:as_admin
select pg_temp.fails('ยกเลิกโดยไม่ใส่เหตุผลไม่ได้', format('select void_payment(%s, '''')', :p2), 'ระบุเหตุผล');
select void_payment(:p2, 'นับเงินสดผิด') \g /dev/null
select pg_temp.ok('ยกเลิกแล้ว: การชำระเป็นไม่ผ่าน ใบเสร็จยังอยู่ หมายเหตุบอกเลขใบเสร็จ เหตุผล และผู้ยกเลิก',
  (select status = 'rejected' and note like 'ยกเลิกใบเสร็จ ' || :'rc2' || ': นับเงินสดผิด (โดย สุดา ผู้ดูแล %' from payments where payment_id = :p2)
  and exists (select 1 from receipts where receipt_no = :'rc2'));
select pg_temp.ok('ใบแจ้งหนี้กลับเป็นรอชำระ (ยอดที่ตรวจแล้วเหลือ 250)',
  (select status from invoices where invoice_id = :i1) = 'unpaid' and private.invoice_paid_amount(:i1) = 250);
select pg_temp.fails('ยกเลิกซ้ำไม่ได้', format('select void_payment(%s, ''x'')', :p2), 'เฉพาะการชำระที่ตรวจแล้ว');
:as_staff
select payment_id as p4 from record_payment(:i1, 335, 'transfer', private.today_th(), 'REF003') \gset
select pg_temp.ok('รับชำระใหม่หลังยกเลิกใบเสร็จได้ → ชำระแล้วอีกครั้ง', (select status from invoices where invoice_id = :i1) = 'paid');

\echo '=== 7) ความถูกต้องของใบแจ้งหนี้ ==='
:as_staff
select pg_temp.fails('ตั้งใบแจ้งหนี้เป็นชำระแล้วเองทั้งที่ยังไม่ได้รับเงินไม่ได้',
  format('update invoices set status = ''paid'' where invoice_id = %s', :i1c), 'ยังไม่ครบยอด');
select pg_temp.fails('ตั้งใบที่ชำระครบแล้วกลับเป็นรอชำระเองไม่ได้',
  format('update invoices set status = ''unpaid'' where invoice_id = %s', :i1), 'ชำระครบแล้ว');
select pg_temp.fails('แก้ยอดในใบแจ้งหนี้ไม่ได้ (ให้ยกเลิกแล้วออกใหม่)',
  format('update invoices set rent_amount = 100 where invoice_id = %s', :i1c), 'แก้ยอด');
select pg_temp.ok('เลื่อนวันครบกำหนดได้', pg_temp.affected(format('update invoices set due_date = ''2026-08-20'' where invoice_id = %s', :i1c)) = 1);
select pg_temp.fails('ยกเลิกใบที่ชำระแล้วไม่ได้', format('update invoices set status = ''cancelled'' where invoice_id = %s', :i1), 'ชำระแล้วยกเลิกไม่ได้');
select * from record_payment(:i1b, 100, 'cash') \g /dev/null
select pg_temp.fails('ยกเลิกใบที่จ่ายมาบางส่วนแล้วไม่ได้', format('update invoices set status = ''cancelled'' where invoice_id = %s', :i1b), 'มีการชำระที่ตรวจแล้ว 100.00 บาท');
:as_tenant1
insert into payments (invoice_id, amount, payment_method) values (:i1c, 155, 'promptpay');
:as_staff
select pg_temp.fails('ยกเลิกใบที่มีการแจ้งชำระรอตรวจไม่ได้', format('update invoices set status = ''cancelled'' where invoice_id = %s', :i1c), 'รอตรวจสอบ 1 รายการ');
:as_tenant2
select pg_temp.fails('ผู้เช่าเรียกรับชำระเองไม่ได้ (42501)', format('select * from record_payment(%s, 155, ''cash'')', :i2), '42501');
:as_staff
select pg_temp.ok('ใบที่ไม่มีการชำระยกเลิกได้ตามปกติ', pg_temp.affected(format('update invoices set status = ''cancelled'' where invoice_id = %s', :i2)) = 1);
select pg_temp.fails('รับชำระใบที่ยกเลิกแล้วไม่ได้', format('select * from record_payment(%s, 10, ''cash'')', :i2), 'ยกเลิกแล้ว');

\echo '=== 8) สรุปยอด ==='
:as_manager
select pg_temp.ok('ผู้บริหารเห็นการชำระ 6 รายการ ใบเสร็จ 4 ใบ (รวมใบที่ยกเลิก)',
  (select count(*) from payments) = 6 and (select count(*) from receipts) = 4);
select pg_temp.ok('ยอดใบเสร็จที่ยังมีผล = ยอดการชำระที่ตรวจแล้ว (685)',
  (select sum(r.amount) from receipts r join payments p using (payment_id) where p.status = 'verified') = 685
  and (select sum(amount) from payments where status = 'verified') = 685);

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
