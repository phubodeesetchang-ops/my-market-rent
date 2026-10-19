-- =====================================================================
--  ทดสอบ migration 009: การแจ้งเตือน + ลบผู้เช่าโดยเก็บประวัติการเงิน
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
-- จำนวนแจ้งเตือน (มองจากสิทธิ์ postgres)
create or replace function pg_temp.n(p_kind text, p_user uuid default null, p_tenant int default null) returns int language sql as $$
  select count(*)::int from public.notifications
  where kind = p_kind
    and (p_user is null or user_id = p_user)
    and (p_tenant is null or (tenant_id = p_tenant and (p_user is not null or user_id is null)))
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set admin   '''a0000000-0000-0000-0000-000000000001'''
\set staff   '''a0000000-0000-0000-0000-000000000002'''
\set manager '''a0000000-0000-0000-0000-000000000003'''
\set as_postgres 'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_admin    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_manager  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant1  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant2  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_service  'set role service_role; select set_config(''request.jwt.claims'', ''{"role":"service_role"}'', false) \\g /dev/null'

:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test'),
  ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test'),
  ('b0000000-0000-0000-0000-000000000001', 'line_u1@line.local'),
  ('b0000000-0000-0000-0000-000000000002', 'line_u2@line.local'),
  ('b0000000-0000-0000-0000-000000000003', 'line_u3@line.local');
insert into users (user_id, username, full_name, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin', 'ผู้ดูแล', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff', 'เจ้าหน้าที่', 'staff'),
  ('a0000000-0000-0000-0000-000000000003', 'boss', 'ผู้บริหาร', 'manager');
insert into tenants (full_name, id_card, phone, address, business_name, line_user_id, auth_id) values
  ('ผู้เช่าหนึ่ง', '1101700230708', '0810000001', 'อุดร', 'ร้านหนึ่ง', 'U1', 'b0000000-0000-0000-0000-000000000001'),
  ('ผู้เช่าสอง', '3509900123450', '0810000002', 'อุดร', null, 'U2', 'b0000000-0000-0000-0000-000000000002'),
  ('ผู้เช่าสาม', '1234567890121', '0810000003', null, null, null, null);
select tenant_id as t1 from tenants where line_user_id = 'U1' \gset
select tenant_id as t2 from tenants where line_user_id = 'U2' \gset
select tenant_id as t3 from tenants where full_name = 'ผู้เช่าสาม' \gset
select pg_temp.stall('ตลาดเย็น', 'B', 'B001') as s1, pg_temp.stall('ตลาดเย็น', 'B', 'B002') as s2,
       pg_temp.stall('ตลาดเย็น', 'B', 'B003') as s3, pg_temp.stall('ตลาดเย็น', 'B', 'B004') as s4 \gset

\echo '=== 1) ตารางและการส่งแบบทันที ==='
select pg_temp.ok('ตาราง notifications อยู่ใน publication supabase_realtime',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'));
select pg_temp.ok('tenants.deleted_at อ่านได้ผ่าน API (grant แล้ว) แต่ id_card ยังปิดอยู่',
  has_column_privilege('authenticated', 'public.tenants', 'deleted_at', 'select')
  and not has_column_privilege('authenticated', 'public.tenants', 'id_card', 'select'));

\echo '=== 2) ผู้เช่าขอเช่า → เจ้าหน้าที่ทุกคนได้แจ้งเตือน ==='
:as_tenant1
insert into contracts (stall_id, start_date, end_date, note) values (:s1, private.today_th() + 1, private.today_th() + 365, 'ขายผลไม้');
:as_postgres
select contract_id as c1 from contracts where stall_id = :s1 \gset
select pg_temp.ok('admin, staff, manager ได้แจ้งเตือน "คำขอเช่าใหม่" คนละ 1 รายการ ลิงก์เปิดคำขอนั้น',
  pg_temp.n('contract_requested') = 3
  and (select bool_and(link = '/admin/contracts?open=' || :c1 and tenant_id = :t1 and body like 'ผู้เช่าหนึ่ง (ร้านหนึ่ง) ขอเช่า ตลาดเย็น แผง B001 เริ่ม %')
       from notifications where kind = 'contract_requested'));
select pg_temp.ok('ผู้เช่าไม่ได้แจ้งเตือนเรื่องที่ทำเอง', (select count(*) from notifications where user_id is null) = 0);

\echo '=== 3) เจ้าหน้าที่อนุมัติ / ออกบิล → ผู้เช่าได้แจ้งเตือน ==='
:as_staff
update contracts set status = 'active' where contract_id = :c1;
insert into invoices (contract_id, billing_period, rent_amount, fee_amount, due_date)
values (:c1, to_char(private.today_th(), 'YYYY-MM'), 150, 20, private.today_th() + 10);
:as_postgres
select invoice_id as i1, invoice_no as i1no from invoices where contract_id = :c1 \gset
select pg_temp.ok('ผู้เช่าได้ "อนุมัติคำขอเช่าแล้ว" พร้อมเลขสัญญา', pg_temp.n('contract_approved', null, :t1) = 1
  and (select body like 'ตลาดเย็น แผง B001 · สัญญา CT-%' from notifications where kind = 'contract_approved'));
select pg_temp.ok('เจ้าหน้าที่ไม่ได้แจ้งเตือนเรื่องที่เจ้าหน้าที่ทำเอง', pg_temp.n('contract_approved', :staff::uuid) = 0
  and (select count(*) from notifications where user_id is not null) = 3);
select pg_temp.ok('ผู้เช่าได้ "บิลใหม่" ยอด 170.00 บาท ลิงก์ไปหน้าบิลนั้น',
  (select count(*) = 1 and bool_and(title like 'บิลใหม่ รอบ %' and body like :'i1no' || ' · 170.00 บาท · ครบกำหนด %' and link = '/liff/bills/' || :i1)
   from notifications where kind = 'invoice_issued' and tenant_id = :t1));

\echo '=== 4) แจ้งชำระ → ตรวจ → ไม่ผ่าน / ผ่าน / ยกเลิกใบเสร็จ ==='
:as_tenant1
insert into payments (invoice_id, amount, payment_method, slip_image) values (:i1, 170, 'promptpay', 'x/y/slip1.jpg');
:as_postgres
select payment_id as p1 from payments where invoice_id = :i1 \gset
select pg_temp.ok('เจ้าหน้าที่ 3 คนได้ "แจ้งชำระเงินใหม่" ลิงก์เปิดรายการนั้นในหน้าตรวจการชำระเงิน',
  pg_temp.n('payment_submitted') = 3
  and (select bool_and(link = '/admin/payments?open=' || :p1 and body like '%170.00 บาท') from notifications where kind = 'payment_submitted'));
:as_staff
select reject_payment(:p1, 'ยอดในสลิปไม่ตรง') \g /dev/null
:as_postgres
select pg_temp.ok('ผู้เช่าได้ "สลิปไม่ผ่าน" พร้อมเหตุผล', pg_temp.n('payment_rejected', null, :t1) = 1
  and (select body like '%เหตุผล: ยอดในสลิปไม่ตรง%' from notifications where kind = 'payment_rejected'));
:as_tenant1
insert into payments (invoice_id, amount, payment_method) values (:i1, 100, 'promptpay');
:as_postgres
select max(payment_id) as p2 from payments \gset
:as_staff
select verify_payment(:p2) \g /dev/null
:as_postgres
select receipt_id as r2 from receipts where payment_id = :p2 \gset
select pg_temp.ok('ตรวจผ่านบางส่วน → "ได้รับชำระเงินแล้ว" บอกยอดค้าง ลิงก์ไปใบเสร็จ',
  (select count(*) = 1 and bool_and(body like '100.00 บาท · ใบเสร็จ RC-% ค้างอีก 70.00 บาท' and link = '/liff/receipts/' || :r2)
   from notifications where kind = 'payment_verified'));
:as_staff
select record_payment(:i1, 70, 'cash') \g /dev/null
:as_postgres
select pg_temp.ok('รับเงินสดที่สำนักงานจนครบ → แจ้ง "ชำระครบแล้ว"',
  (select count(*) from notifications where kind = 'payment_verified' and body like '%ชำระครบแล้ว') = 1);
:as_admin
select void_payment(:p2, 'บันทึกซ้ำ') \g /dev/null
:as_postgres
select pg_temp.ok('ยกเลิกใบเสร็จ → ผู้เช่าได้แจ้งเตือนพร้อมเหตุผล บิลกลับเป็นรอชำระ',
  (select count(*) = 1 and bool_and(title like 'ยกเลิกใบเสร็จ RC-%' and body like '%บิลกลับเป็นรอชำระ%บันทึกซ้ำ%')
   from notifications where kind = 'receipt_voided')
  and (select status from invoices where invoice_id = :i1) = 'unpaid');
:as_staff
update invoices set due_date = due_date + 5 where invoice_id = :i1;
:as_postgres
select pg_temp.ok('เลื่อนวันครบกำหนด → ผู้เช่าได้แจ้งเตือน', pg_temp.n('invoice_due_changed', null, :t1) = 1);

\echo '=== 5) ผู้เช่าแก้ข้อมูลติดต่อ / ผูก LINE ==='
:as_tenant1
update tenants set phone = '0899999999', address = 'บ้านใหม่';
:as_postgres
select pg_temp.ok('เจ้าหน้าที่ได้ "ผู้เช่าแก้ไขข้อมูลติดต่อ" บอกว่าแก้อะไร',
  pg_temp.n('tenant_updated') = 3 and (select bool_and(body = 'ผู้เช่าหนึ่ง · เบอร์โทร 0899999999, ที่อยู่') from notifications where kind = 'tenant_updated'));
:as_service
update tenants set line_user_id = 'U3', auth_id = 'b0000000-0000-0000-0000-000000000003' where tenant_id = :t3;
:as_postgres
select pg_temp.ok('ผูก LINE (Edge Function) → เจ้าหน้าที่ได้แจ้ง และผู้เช่าได้ข้อความต้อนรับ',
  pg_temp.n('line_linked') = 3 and pg_temp.n('welcome', null, :t3) = 1);
:as_staff
update tenants set phone = '0811111111' where tenant_id = :t2;
:as_postgres
select pg_temp.ok('เจ้าหน้าที่แก้ข้อมูลให้ผู้เช่า ไม่สร้างแจ้งเตือน', pg_temp.n('tenant_updated') = 3);

\echo '=== 6) สิทธิ์การเห็นและแก้แจ้งเตือน ==='
select count(*) as t1_count from notifications where user_id is null and tenant_id = :t1 \gset
select count(*) as staff_count from notifications where user_id = :staff \gset
:as_tenant1
select pg_temp.ok('ผู้เช่าเห็นเฉพาะแจ้งเตือนของตัวเอง (ไม่เห็นของเจ้าหน้าที่ที่พูดถึงตัวเอง)',
  (select count(*) from notifications) = :t1_count and (select count(*) from notifications where user_id is not null) = 0);
select pg_temp.ok('ผู้เช่ากด "อ่านแล้วทั้งหมด" ได้', pg_temp.affected('update notifications set read_at = now() where read_at is null') = :t1_count);
select pg_temp.fails('ผู้เช่าแก้ข้อความแจ้งเตือนไม่ได้', 'update notifications set title = ''ปลอม''', 'permission denied');
select pg_temp.fails('ผู้เช่าสร้างแจ้งเตือนเองไม่ได้',
  format('insert into notifications (tenant_id, kind, title) values (%s, ''x'', ''ปลอม'')', :t1), 'permission denied');
select pg_temp.fails('ผู้เช่าลบแจ้งเตือนไม่ได้', 'delete from notifications', 'permission denied');
:as_tenant2
select pg_temp.ok('ผู้เช่าอีกคนไม่เห็นแจ้งเตือนของผู้เช่าหนึ่ง', (select count(*) from notifications) = 0);
:as_staff
select pg_temp.ok('เจ้าหน้าที่เห็นเฉพาะของตัวเอง', (select count(*) from notifications) = :staff_count
  and (select bool_and(user_id = :staff::uuid) from notifications));
select pg_temp.ok('อ่านแล้วกระทบเฉพาะของตัวเอง', pg_temp.affected('update notifications set read_at = now()') = :staff_count);
:as_postgres
select pg_temp.ok('ของ admin ยังไม่ถูกอ่าน', (select bool_and(read_at is null) from notifications where user_id = :admin));
update users set status = 'inactive' where user_id = :manager;
select count(*) as manager_before from notifications where user_id = :manager \gset
:as_tenant1
insert into contracts (stall_id, start_date, end_date) values (:s2, private.today_th() + 1, private.today_th() + 365);
:as_manager
select pg_temp.ok('ผู้ใช้ที่ถูกระงับไม่เห็นแจ้งเตือน', (select count(*) from notifications) = 0);
:as_postgres
select pg_temp.ok('ผู้ใช้ที่ถูกระงับไม่ได้รับแจ้งเตือนใหม่',
  (select count(*) from notifications where user_id = :manager) = :manager_before
  and (select count(*) from notifications where kind = 'contract_requested') = 5);
update users set status = 'active' where user_id = :manager;
select contract_id as c2 from contracts where stall_id = :s2 \gset
:as_tenant1
update contracts set status = 'cancelled' where contract_id = :c2;
:as_postgres
select pg_temp.ok('ผู้เช่ายกเลิกคำขอเอง → เจ้าหน้าที่ได้แจ้ง ผู้เช่าไม่ได้', pg_temp.n('request_cancelled') = 3
  and (select count(*) from notifications where kind = 'request_cancelled' and user_id is null) = 0);

\echo '=== 7) ลบผู้เช่า ==='
-- ผู้เช่าสาม: มีแต่คำขอเช่า (ไม่มีประวัติการเงิน) · ผู้เช่าหนึ่ง: มีสัญญาใช้งาน + บิล + ใบเสร็จ
:as_staff
insert into contracts (tenant_id, stall_id, start_date, end_date, status) values (:t3, :s3, private.today_th() + 1, private.today_th() + 365, 'pending');
:as_staff
select pg_temp.fails('เจ้าหน้าที่ (ไม่ใช่ admin) ลบผู้เช่าไม่ได้', format('select delete_tenant(%s)', :t3), 'เฉพาะผู้ดูแลระบบ');
:as_manager
select pg_temp.fails('ผู้บริหารลบผู้เช่าไม่ได้', format('select delete_tenant(%s)', :t3), 'เฉพาะผู้ดูแลระบบ');
:as_tenant1
select pg_temp.fails('ผู้เช่าลบตัวเองไม่ได้', format('select delete_tenant(%s)', :t1), 'เฉพาะผู้ดูแลระบบ');
:as_admin
select pg_temp.fails('ยังมีสัญญาใช้งานอยู่ → ลบไม่ได้ บอกเลขสัญญาและแผง', format('select delete_tenant(%s)', :t1), 'สัญญาที่ใช้งานอยู่ \(CT-.* ตลาดเย็น แผง B001\)');
select pg_temp.ok('ไม่มีประวัติ → ลบจริง', (select delete_tenant(:t3) ->> 'mode') = 'deleted');
:as_postgres
select pg_temp.ok('ผู้เช่า คำขอเช่า และแจ้งเตือนที่เกี่ยวข้องหายไป แผงที่จองกลับเป็นว่าง',
  not exists (select 1 from tenants where tenant_id = :t3) and not exists (select 1 from contracts where tenant_id = :t3)
  and not exists (select 1 from notifications where tenant_id = :t3)
  and (select status from stalls where stall_id = :s3) = 'vacant');

select count(*) as inv_n from invoices where contract_id = :c1 \gset
select count(*) as pay_n from payments where invoice_id = :i1 \gset
select count(*) as rc_n from receipts r join payments p using (payment_id) where p.invoice_id = :i1 \gset
select coalesce(sum(r.amount), 0) as income from receipts r join payments p using (payment_id) where p.invoice_id = :i1 and p.status = 'verified' \gset
:as_staff
update contracts set status = 'cancelled', note = 'เลิกขาย' where contract_id = :c1;
:as_tenant1
insert into contracts (stall_id, start_date, end_date) values (:s4, private.today_th() + 1, private.today_th() + 365);
:as_admin
select delete_tenant(:t1) as res \gset
select pg_temp.ok('มีประวัติการเงิน → ล้างข้อมูลส่วนตัว และยกเลิกคำขอที่ค้าง 1 รายการ',
  (:'res'::jsonb ->> 'mode') = 'anonymized' and (:'res'::jsonb ->> 'cancelled_requests')::int = 1);
:as_postgres
select pg_temp.ok('ชื่อเป็น "ผู้เช่าที่ลบข้อมูลแล้ว #id" เลขบัตร เบอร์ ที่อยู่ ร้าน LINE ถูกล้าง สถานะระงับ',
  (select full_name = 'ผู้เช่าที่ลบข้อมูลแล้ว #' || :t1 and id_card is null and phone is null and address is null
          and business_name is null and line_user_id is null and auth_id is null and status = 'inactive' and deleted_at is not null
   from tenants where tenant_id = :t1));
select pg_temp.ok('ใบแจ้งหนี้ การชำระ ใบเสร็จ และยอดรายได้ยังอยู่ครบ',
  (select count(*) from invoices where contract_id = :c1) = :inv_n
  and (select count(*) from payments where invoice_id = :i1) = :pay_n
  and (select count(*) from receipts r join payments p using (payment_id) where p.invoice_id = :i1) = :rc_n
  and (select coalesce(sum(r.amount), 0) from receipts r join payments p using (payment_id) where p.invoice_id = :i1 and p.status = 'verified') = :income);
select pg_temp.ok('สัญญาเดิมยังอยู่ · คำขอค้างถูกยกเลิกพร้อมหมายเหตุ · แผงกลับเป็นว่าง',
  (select count(*) from contracts where tenant_id = :t1) = 3
  and (select status = 'cancelled' and note like '%ยกเลิกอัตโนมัติเพราะลบข้อมูลผู้เช่า' from contracts where tenant_id = :t1 and stall_id = :s4)
  and (select status from stalls where stall_id = :s4) = 'vacant');
select pg_temp.ok('แจ้งเตือนทั้งหมดที่มีชื่อผู้เช่ารายนี้ถูกลบ', not exists (select 1 from notifications where tenant_id = :t1));
:as_tenant1
select pg_temp.ok('บัญชี LINE เดิมมองไม่เห็นข้อมูลใดๆ อีก',
  (select count(*) from tenants) = 0 and (select count(*) from invoices) = 0 and (select count(*) from notifications) = 0);
:as_staff
select pg_temp.ok('รายงานยังเห็นบิลของผู้เช่าที่ลบแล้ว (ชื่อเป็นข้อความแทน)',
  (select t.full_name from invoices i join contracts c using (contract_id) join tenants t using (tenant_id) where i.invoice_id = :i1) like 'ผู้เช่าที่ลบข้อมูลแล้ว #%');
select pg_temp.fails('แก้ข้อมูลผู้เช่าที่ลบแล้วไม่ได้', format('update tenants set full_name = ''ชื่อใหม่'', status = ''active'' where tenant_id = %s', :t1), 'ถูกลบข้อมูลแล้ว');
select pg_temp.fails('ทำสัญญาใหม่กับผู้เช่าที่ลบแล้วไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, status) values (%s, %s, private.today_th(), private.today_th() + 30, ''active'')', :t1, :s4), 'ถูกลบข้อมูลแล้ว');
select pg_temp.fails('ตั้ง deleted_at เองผ่าน API ไม่ได้', format('update tenants set deleted_at = now() where tenant_id = %s', :t2), 'ปุ่ม "ลบผู้เช่า"');
:as_admin
select pg_temp.fails('ลบซ้ำไม่ได้', format('select delete_tenant(%s)', :t1), 'ถูกลบข้อมูลไปแล้ว');
select pg_temp.fails('รหัสที่ไม่มีอยู่', 'select delete_tenant(999999)', 'ไม่พบผู้เช่า');
select pg_temp.ok('เพิ่มคนเดิมกลับมาเป็นผู้เช่าใหม่ได้ (เลขบัตรเดิมไม่ติดซ้ำ) และ deleted_at ที่ส่งมาถูกล้าง',
  pg_temp.affected('insert into tenants (full_name, id_card, phone, deleted_at) values (''ผู้เช่าหนึ่ง'', ''1101700230708'', ''0810000001'', now())') = 1);
:as_postgres
select pg_temp.ok('แถวใหม่ไม่ถูกนับเป็นลบแล้ว', (select deleted_at is null from tenants where id_card = '1101700230708'));
select pg_temp.ok('SQL Editor (postgres) เรียก delete_tenant ได้',
  (select delete_tenant(tenant_id) ->> 'mode' from tenants where id_card = '1101700230708') = 'deleted');

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
