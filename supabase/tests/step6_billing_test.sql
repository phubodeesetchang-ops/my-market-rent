-- =====================================================================
--  ทดสอบขั้นที่ 6: จดมิเตอร์ + ออกใบแจ้งหนี้ (migration 006)
--  รันบน PostgreSQL ทดสอบในเครื่องที่จำลอง Supabase
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
create or replace function pg_temp.stall(m text, z text, code text) returns int language sql as $$
  select s.stall_id from public.stalls s join public.zones zz using (zone_id) join public.markets mm using (market_id)
  where mm.market_name = m and zz.zone_name = z and s.stall_code = code
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set as_postgres 'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_manager  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}'', false) \\g /dev/null'

:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test');
insert into users (user_id, username, full_name, role) values
  ('a0000000-0000-0000-0000-000000000002', 'staff', 'เจ้าหน้าที่', 'staff'),
  ('a0000000-0000-0000-0000-000000000003', 'manager', 'ผู้บริหาร', 'manager');
insert into tenants (full_name, business_name, phone, address) values
  ('สมชาย ใจดี', 'ร้านผ้า', '0812345678', 'อุดร'),
  ('มาลี ศรีสุข', 'ส้มตำ', '0897654321', 'อุดร'),
  ('บุญมี มีสุข', 'ผัก', '0811112222', 'อุดร');
select tenant_id as t1 from tenants where full_name = 'สมชาย ใจดี' \gset
select tenant_id as t2 from tenants where full_name = 'มาลี ศรีสุข' \gset
select tenant_id as t3 from tenants where full_name = 'บุญมี มีสุข' \gset
select pg_temp.stall('ตลาดเย็น', 'A', 'A001') as eve1, pg_temp.stall('ตลาดเย็น', 'A', 'A002') as eve2,
       pg_temp.stall('ตลาดเย็น', 'A', 'A003') as eve3, pg_temp.stall('ตลาดเย็น', 'A', 'A004') as eve4,
       pg_temp.stall('อาคาร OTOP', 'A', 'A001') as otop1 \gset
select market_id as m_otop from markets where market_name = 'อาคาร OTOP' \gset
-- ค่าธรรมเนียมเพิ่มของ OTOP: รายปี 100 และครั้งเดียว 200 (มีรายเดือน 5 จาก seed อยู่แล้ว)
insert into fees (market_id, fee_name, fee_amount, fee_period) values
  (:m_otop, 'ค่าบำรุงรายปี', 100, 'yearly'), (:m_otop, 'ค่าแรกเข้า', 200, 'once');
-- สัญญา: รายเดือนเต็มรอบ / รายปี OTOP เริ่ม 15 ม.ค. / เริ่มกลางเดือน ก.ย. / สิ้นสุดแล้วแต่คลุม ก.ย. / ยกเลิก / รออนุมัติ
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status) values
  (:t1, :eve1,  '2026-01-01', '2026-12-31', 150,   'monthly', 'active'),
  (:t2, :otop1, '2026-01-15', '2029-01-14', 18000, 'yearly',  'active'),
  (:t3, :eve2,  '2026-09-16', '2027-09-15', 150,   'monthly', 'active');
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status) values
  (:t2, :eve3, '2025-09-20', '2026-09-19', 150, 'monthly', 'active');
update contracts set status = 'expired' where stall_id = :eve3;
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status) values
  (:t3, :eve4, '2026-01-01', '2026-12-31', 150, 'monthly', 'active');
update contracts set status = 'cancelled' where stall_id = :eve4;
select contract_id as c_eve1 from contracts where stall_id = :eve1 \gset
select contract_id as c_otop from contracts where stall_id = :otop1 \gset

\echo ''
\echo '=== 1) ตัวช่วยรอบบิล ==='
select pg_temp.ok('period_end(2026-02) = 2026-02-28 และ months_since(15 ม.ค. 2026, 2027-01) = 12',
  private.period_end('2026-02') = '2026-02-28' and private.months_since('2026-01-15', '2027-01') = 12);
select pg_temp.fails('รอบบิลผิดรูปแบบ → ข้อความไทย', 'select private.period_start(''2026-13'')', 'รอบบิลต้องอยู่ในรูปแบบ');
select pg_temp.fails('รอบบิลใส่ปี พ.ศ. → บอกให้ใช้ ค.ศ.', 'select private.period_start(''2569-10'')', 'ไม่ใช่ พ.ศ.');

\echo ''
\echo '=== 2) จดมิเตอร์ ==='
:as_staff
select pg_temp.ok('meter_sheet(2026-09): แผงที่มีสัญญาใน ก.ย. = 4 (ไม่รวมสัญญายกเลิก)', (select count(*) from meter_sheet('2026-09')) = 4);
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading)
values (:eve1, 'electricity', '2026-08', 1000, 1080), (:eve1, 'water', '2026-08', 50, 58);
select pg_temp.ok('ไม่ส่งอัตรา → ระบบเติมอัตราของตลาด ณ สิ้นรอบ (5 บาท) และ reading_date = วันนี้ (ไทย)',
  (select bool_and(rate_per_unit = 5 and reading_date = private.today_th()) from utility_readings where stall_id = :eve1 and billing_period = '2026-08'));
select pg_temp.ok('meter_sheet(2026-09) แนะนำเลขครั้งก่อนจากเดือน ส.ค. (ไฟ 1080, น้ำ 58)',
  (select electricity_suggested = 1080 and water_suggested = 58 and electricity_rate = 5 from meter_sheet('2026-09') where stall_id = :eve1));
select pg_temp.fails('เลขมิเตอร์ถอยหลังไม่ได้',
  format('insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading) values (%s, ''electricity'', ''2026-09'', 1080, 1000)', :eve1),
  'utility_readings_not_backwards');
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading) values
  (:eve1, 'electricity', '2026-09', 1080, 1200), (:eve1, 'water', '2026-09', 58, 70),
  (:otop1, 'electricity', '2026-09', 500, 650),
  (:eve2, 'electricity', '2026-09', 0, 40), (:eve3, 'electricity', '2026-09', 300, 330);
-- จดซ้ำแบบ upsert (หน้าเว็บใช้แบบนี้) → แก้ค่าได้ก่อนออกบิล
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading)
values (:eve1, 'electricity', '2026-09', 1080, 1210)
on conflict (stall_id, utility_type, billing_period) do update set previous_reading = excluded.previous_reading, current_reading = excluded.current_reading;
select pg_temp.ok('upsert แก้เลขมิเตอร์ที่ยังไม่ออกบิลได้ (หน่วย 130) และอัตราเดิมคงอยู่',
  (select unit_used = 130 and rate_per_unit = 5 from utility_readings where stall_id = :eve1 and utility_type = 'electricity' and billing_period = '2026-09'));

\echo ''
\echo '=== 3) ตรวจยอดก่อนออก ==='
-- ก.ย. 2026: eve1 = 150 + ไฟ 130×5 + น้ำ 12×5 + 5 = 865 · OTOP (เดือนที่ 9 ของปีสัญญา) = 0 + ไฟ 150×5 + 5 = 755
-- eve2 เริ่ม 16 ก.ย. คิดเต็มเดือน = 150 + 40×5 + 5 = 355 · eve3 สิ้นสุด 19 ก.ย. (สถานะสิ้นสุด) = 150 + 30×5 + 5 = 305
select pg_temp.ok('ยอด eve1 = 865 (ค่าเช่า 150 + ไฟ 650 + น้ำ 60 + ค่าธรรมเนียม 5)',
  (select total_amount = 865 and electricity_amount = 650 and water_amount = 60 and fee_amount = 5 and has_water and has_electricity from preview_invoices('2026-09') where stall_id = :eve1));
select pg_temp.ok('OTOP รายปี เดือนที่ไม่ใช่เดือนแรกของปีสัญญา: ค่าเช่า 0 ค่าธรรมเนียมรายเดือน 5 และเตือนว่ายังไม่จดน้ำ',
  (select rent_amount = 0 and fee_amount = 5 and total_amount = 755 and not has_water and has_electricity from preview_invoices('2026-09') where stall_id = :otop1));
select pg_temp.ok('สัญญาเริ่มกลางเดือนคิดค่าเช่าเต็มเดือน (355) · สัญญาที่สิ้นสุดใน ก.ย. ยังออกบิล ก.ย. (305)',
  (select total_amount from preview_invoices('2026-09') where stall_id = :eve2) = 355
  and (select total_amount from preview_invoices('2026-09') where stall_id = :eve3) = 305);
select pg_temp.ok('สัญญายกเลิกไม่อยู่ในรายการ', not exists (select 1 from preview_invoices('2026-09') where stall_id = :eve4));
select pg_temp.ok('OTOP ม.ค. 2026 (เดือนแรกของสัญญา): ค่าเช่า 18000 + ค่าธรรมเนียม 5 + 100 + 200',
  (select rent_amount = 18000 and fee_amount = 305 from preview_invoices('2026-01') where stall_id = :otop1));
select pg_temp.ok('OTOP ม.ค. 2027 (เดือนแรกของปีที่ 2): ค่าเช่า 18000 + ค่าธรรมเนียม 5 + 100 (ไม่มีค่าแรกเข้า)',
  (select rent_amount = 18000 and fee_amount = 105 from preview_invoices('2027-01') where stall_id = :otop1));

\echo ''
\echo '=== 4) ออกใบแจ้งหนี้ ==='
:as_manager
select pg_temp.ok('manager ตรวจยอดได้', (select count(*) from preview_invoices('2026-09')) = 4);
select pg_temp.fails('manager ออกใบแจ้งหนี้ไม่ได้', 'select generate_invoices(''2026-09'', ''2026-10-05'')', '42501');
:as_staff
select pg_temp.fails('วันครบกำหนดก่อนต้นรอบไม่ได้', 'select generate_invoices(''2026-09'', ''2026-08-31'')', 'วันครบกำหนด');
select generate_invoices('2026-09', '2026-10-05') as n_inv \gset
select pg_temp.ok('ออกใบแจ้งหนี้ ก.ย. ได้ 4 ใบ เลข INV-256909-0001… ครบกำหนด 5 ต.ค.',
  :n_inv = 4 and (select count(*) from invoices where billing_period = '2026-09' and invoice_no ~ '^INV-256909-\d{4}$' and due_date = '2026-10-05') = 4);
select pg_temp.ok('ยอดในใบแจ้งหนี้ตรงกับที่ตรวจ (eve1 865)',
  (select total_amount from invoices where contract_id = :c_eve1 and billing_period = '2026-09') = 865);
select pg_temp.ok('มิเตอร์ ก.ย. ทั้ง 5 รายการถูกผูกกับใบแจ้งหนี้', (select count(*) from utility_readings where billing_period = '2026-09' and invoice_id is not null) = 5);
select pg_temp.ok('กดออกซ้ำ ไม่ออกซ้ำ (0 ใบ)', generate_invoices('2026-09', '2026-10-05') = 0);
select pg_temp.fails('แก้มิเตอร์ที่อยู่ในใบแจ้งหนี้ไม่ได้',
  format('update utility_readings set current_reading = 1300 where stall_id = %s and utility_type = ''electricity'' and billing_period = ''2026-09''', :eve1),
  'อยู่ในใบแจ้งหนี้');
select pg_temp.ok('ออกใบรอบ ส.ค. ได้ (ทุกสัญญาที่มีวันใน ส.ค. และยอด > 0)', generate_invoices('2026-08', '2026-09-05') >= 1);

\echo ''
\echo '=== 5) ยกเลิกใบแจ้งหนี้ → ปลดล็อกมิเตอร์ → แก้ → ออกใหม่ ==='
select invoice_id as inv_eve1, invoice_no as inv_eve1_no from invoices where contract_id = :c_eve1 and billing_period = '2026-09' \gset
update invoices set status = 'cancelled' where invoice_id = :inv_eve1;
select pg_temp.ok('ยกเลิกแล้วมิเตอร์ของใบนั้นปลดล็อก (invoice_id ว่าง)',
  (select count(*) from utility_readings where stall_id = :eve1 and billing_period = '2026-09' and invoice_id is null) = 2);
update utility_readings set current_reading = 1220 where stall_id = :eve1 and utility_type = 'electricity' and billing_period = '2026-09';
select generate_invoices('2026-09', '2026-10-05', array[:c_eve1]) as n_re \gset
select pg_temp.ok('ออกใหม่เฉพาะสัญญาที่เลือก ได้เลขใหม่ ยอดใหม่ 915',
  :n_re = 1 and (select total_amount from invoices where contract_id = :c_eve1 and billing_period = '2026-09' and status = 'unpaid') = 915
  and (select invoice_no from invoices where contract_id = :c_eve1 and billing_period = '2026-09' and status = 'unpaid') <> :'inv_eve1_no');
select pg_temp.fails('ใบที่ยกเลิกแล้วกลับมารอชำระไม่ได้',
  format('update invoices set status = ''unpaid'' where invoice_id = %s', :inv_eve1), 'ยกเลิกแล้ว');
-- (ตั้งแต่ migration 007 ใบแจ้งหนี้เป็น "ชำระแล้ว" ได้จากการชำระที่ตรวจแล้วเท่านั้น)
insert into payments (invoice_id, amount, payment_method, status)
select invoice_id, total_amount, 'cash', 'verified' from invoices where contract_id = :c_otop and billing_period = '2026-09' and status = 'unpaid';
select pg_temp.fails('ใบที่ชำระแล้วยกเลิกไม่ได้',
  format('update invoices set status = ''cancelled'' where contract_id = %s and billing_period = ''2026-09''', :c_otop), 'ชำระแล้วยกเลิกไม่ได้');

\echo ''
\echo '=== 6) อัตราเปลี่ยนกลางทาง: ใช้อัตรา ณ วันสุดท้ายของรอบบิล ==='
:as_postgres
select change_utility_rate(z.market_id, 'electricity', 6, '2026-10-01') from zones z join stalls s using (zone_id) where s.stall_id = :eve1 \g /dev/null
:as_staff
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading)
values (:eve1, 'electricity', '2026-10', 1220, 1300);
select pg_temp.ok('มิเตอร์ ต.ค. ใช้อัตราใหม่ 6 บาท (ก.ย. ยังเป็น 5)',
  (select rate_per_unit from utility_readings where stall_id = :eve1 and utility_type = 'electricity' and billing_period = '2026-10') = 6
  and (select rate_per_unit from utility_readings where stall_id = :eve1 and utility_type = 'electricity' and billing_period = '2026-09') = 5);
:as_postgres
delete from utility_rates where market_id = (select market_id from zones z join stalls s using (zone_id) where s.stall_id = :eve2) and utility_type = 'water';
:as_staff
select pg_temp.fails('ตลาดที่ยังไม่ตั้งอัตราค่าน้ำ → จดน้ำไม่ได้ พร้อมบอกให้ไปตั้งอัตรา',
  format('insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading) values (%s, ''water'', ''2026-10'', 0, 5)', :eve2),
  'ยังไม่ได้ตั้งอัตราค่าน้ำ');

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
