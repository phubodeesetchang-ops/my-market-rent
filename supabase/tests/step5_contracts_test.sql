-- =====================================================================
--  ทดสอบขั้นที่ 5: สัญญาเช่า (ทำสัญญา, แก้ไข, ต่ออายุแบบรออนุมัติ, อนุมัติ, ไม่อนุมัติ,
--  ยกเลิก, ปิดสัญญาหมดอายุ) + คอลัมน์ note จาก migration 005
--  รันบน PostgreSQL ทดสอบในเครื่องที่จำลอง Supabase (เหมือนชุดทดสอบขั้นที่ 2 และ 4)
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
create or replace function pg_temp.stall_status(id int) returns text language sql as $$
  select status from public.stalls where stall_id = id
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set as_postgres 'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_manager  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant   'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'

:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('a0000000-0000-0000-0000-000000000003', 'manager@test'),
  ('b0000000-0000-0000-0000-000000000001', 'line-tenant@test');
insert into users (user_id, username, full_name, role) values
  ('a0000000-0000-0000-0000-000000000002', 'staff', 'เจ้าหน้าที่', 'staff'),
  ('a0000000-0000-0000-0000-000000000003', 'manager', 'ผู้บริหาร', 'manager');
insert into tenants (full_name, business_name, phone, address, auth_id) values
  ('สมชาย ใจดี', 'ร้านผ้า', '0812345678', 'อุดร', null),
  ('มาลี ศรีสุข', 'ส้มตำ', '0897654321', 'อุดร', 'b0000000-0000-0000-0000-000000000001');
select tenant_id as t1 from tenants where full_name = 'สมชาย ใจดี' \gset
select tenant_id as t2 from tenants where full_name = 'มาลี ศรีสุข' \gset
select pg_temp.stall('อาคาร OTOP', 'A', 'A001') as otop_a1,
       pg_temp.stall('ตลาดเย็น', 'A', 'A001') as eve_a1,
       pg_temp.stall('ตลาดเย็น', 'A', 'A002') as eve_a2,
       pg_temp.stall('ตลาดเช้า', 'A', 'A001') as morning_a1 \gset

\echo ''
\echo '=== 1) คอลัมน์ note (migration 005) ==='
select pg_temp.ok('มีคอลัมน์ contracts.note ชนิด text',
  (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'note') = 'text');

\echo ''
\echo '=== 2) ทำสัญญาใหม่ที่สำนักงาน (ใช้งานทันที) + แก้ไข ==='
:as_staff
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, deposit_amount, status, note)
values (:t1, :otop_a1, '2026-01-01', '2028-12-31', 18000, 'yearly', 3000, 'active', 'ทำสัญญาที่สำนักงาน')
returning contract_id as c_old, contract_no as c_old_no \gset
select pg_temp.ok('สัญญาใหม่ได้เลข CT-2569-xxxx และห้องเปลี่ยนเป็น "เช่า"', :'c_old_no' ~ '^CT-2569-\d{4}$' and pg_temp.stall_status(:otop_a1) = 'rented');
select pg_temp.affected(format('update contracts set rent_amount = 20000, deposit_amount = 5000, note = %L where contract_id = %s', 'ปรับค่าเช่าตามมติ', :c_old)) as n \gset
select pg_temp.ok('แก้สัญญาที่ใช้งานอยู่ได้ (ค่าเช่า เงินประกัน หมายเหตุ)',
  :n = 1 and (select rent_amount = 20000 and deposit_amount = 5000 and note = 'ปรับค่าเช่าตามมติ' from contracts where contract_id = :c_old));
select pg_temp.fails('ทำสัญญาซ้อนบนห้องที่เช่าอยู่ไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, status) values (%s, %s, ''2029-01-01'', ''2031-12-31'', ''active'')', :t2, :otop_a1),
  'ไม่ว่าง');
select pg_temp.fails('ไม่ใส่ค่าเช่าบนห้องที่ยังไม่กำหนดค่าเช่าไม่ได้ (23502 → หน้าเว็บบังคับกรอกค่าเช่า)',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, status) values (%s, %s, ''2026-11-01'', ''2029-10-31'', ''active'')', :t2, pg_temp.stall('อาคาร OTOP', 'A', 'A002')),
  '23502');
select pg_temp.fails('หมายเหตุยาวเกิน 500 ตัวอักษรไม่ได้',
  format('update contracts set note = repeat(''ก'', 501) where contract_id = %s', :c_old), 'contracts_note_length');

\echo ''
\echo '=== 3) ต่ออายุ = สร้างคำขอรออนุมัติ แล้วอนุมัติ ==='
select pg_temp.fails('วันเริ่มต่ออายุทับสัญญาเดิมไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, status, renewed_from_id) values (%s, %s, ''2028-12-31'', ''2031-12-30'', ''pending'', %s)', :t1, :otop_a1, :c_old),
  'วันเริ่มสัญญาใหม่ต้องอยู่หลัง');
select pg_temp.fails('ต่ออายุให้ผู้เช่าคนอื่นไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, status, renewed_from_id) values (%s, %s, ''2029-01-01'', ''2031-12-31'', ''pending'', %s)', :t2, :otop_a1, :c_old),
  'แผงและผู้เช่าเดียวกับ');
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status, renewed_from_id)
values (:t1, :otop_a1, '2029-01-01', '2031-12-31', 21000, 'yearly', 'pending', :c_old)
returning contract_id as c_r1 \gset
select pg_temp.ok('คำขอต่ออายุบนห้องที่เช่าอยู่สร้างได้ และห้องยังเป็น "เช่า"', pg_temp.stall_status(:otop_a1) = 'rented');
update contracts set status = 'rejected', note = 'วันที่ผิด ให้ส่งใหม่' where contract_id = :c_r1;
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status, renewed_from_id)
values (:t1, :otop_a1, '2029-01-01', '2031-12-31', 21000, 'yearly', 'pending', :c_old)
returning contract_id as c_new \gset
select pg_temp.ok('ไม่อนุมัติคำขอต่ออายุแล้ว ส่งคำขอต่ออายุใหม่ของสัญญาเดิมได้ (migration 005)', :c_new > :c_r1);
select pg_temp.fails('มีคำขอต่ออายุที่รออนุมัติอยู่แล้ว ส่งซ้ำไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, status, renewed_from_id) values (%s, %s, ''2032-01-01'', ''2034-12-31'', 21000, ''pending'', %s)', :t1, :otop_a1, :c_old),
  'contracts_one_pending_per_stall|contracts_one_renewal_per_contract');
select pg_temp.affected(format('update contracts set status = ''active'', rent_amount = 21500 where contract_id = %s', :c_new)) as n \gset
select pg_temp.ok('อนุมัติคำขอต่ออายุ (พร้อมแก้ค่าเช่าตอนอนุมัติ) → มีสัญญาใช้งาน 2 ฉบับต่อกัน',
  :n = 1 and (select count(*) from contracts where stall_id = :otop_a1 and status = 'active') = 2
  and (select rent_amount from contracts where contract_id = :c_new) = 21500);
select pg_temp.fails('สัญญาที่ต่ออายุสำเร็จแล้ว ส่งคำขอต่ออายุซ้ำไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, status, renewed_from_id) values (%s, %s, ''2032-01-01'', ''2034-12-31'', 21000, ''pending'', %s)', :t1, :otop_a1, :c_old),
  'contracts_one_renewal_per_contract');
select pg_temp.fails('แก้วันสิ้นสุดสัญญาเดิมให้ทับสัญญาต่ออายุไม่ได้',
  format('update contracts set end_date = ''2029-06-30'' where contract_id = %s', :c_old), '23P01');
select pg_temp.affected(format('update contracts set status = ''cancelled'', note = %L where contract_id = %s', 'ผู้เช่าขอย้ายไปใช้สัญญาใหม่', :c_old)) as n \gset
select pg_temp.ok('ยกเลิกสัญญาเดิมพร้อมเหตุผล → ห้องยังเป็น "เช่า" (สัญญาต่ออายุยังใช้งาน)',
  :n = 1 and pg_temp.stall_status(:otop_a1) = 'rented'
  and (select status = 'cancelled' and note = 'ผู้เช่าขอย้ายไปใช้สัญญาใหม่' from contracts where contract_id = :c_old));
select pg_temp.fails('สัญญาที่ยกเลิกแล้วกลับมาใช้งานไม่ได้',
  format('update contracts set status = ''active'' where contract_id = %s', :c_old), 'เปลี่ยนสถานะสัญญา');

\echo ''
\echo '=== 4) คำขอจากผู้เช่า (LINE) → ไม่อนุมัติพร้อมเหตุผล ==='
:as_tenant
insert into contracts (stall_id, start_date, end_date, note) values (:eve_a1, '2026-11-01', '2027-10-31', 'ขายผลไม้ตามฤดูกาล')
returning contract_id as c_req \gset
select pg_temp.ok('ผู้เช่าส่งคำขอพร้อมหมายเหตุได้ ระบบตั้งสถานะรออนุมัติและค่าเช่าตามแผง',
  (select status = 'pending' and rent_amount = 150 and note = 'ขายผลไม้ตามฤดูกาล' from contracts where contract_id = :c_req));
select pg_temp.fails('ผู้เช่าแก้หมายเหตุหลังส่งคำขอไม่ได้',
  format('update contracts set note = ''แก้แล้ว'' where contract_id = %s', :c_req), '42501|ยกเลิกคำขอ');
:as_staff
select pg_temp.ok('แผงที่มีคำขอเป็น "จอง"', pg_temp.stall_status(:eve_a1) = 'reserved');
select pg_temp.affected(format('update contracts set status = ''rejected'', note = %L where contract_id = %s', 'แผงนี้สงวนไว้สำหรับร้านอาหาร', :c_req)) as n \gset
select pg_temp.ok('เจ้าหน้าที่ไม่อนุมัติพร้อมเหตุผล → แผงกลับเป็น "ว่าง"', :n = 1 and pg_temp.stall_status(:eve_a1) = 'vacant');
:as_tenant
select pg_temp.ok('ผู้เช่าเห็นเหตุผลที่ไม่อนุมัติของคำขอตัวเอง',
  (select note from contracts where contract_id = :c_req) = 'แผงนี้สงวนไว้สำหรับร้านอาหาร');

\echo ''
\echo '=== 5) ปิดสัญญาที่หมดอายุ ==='
:as_staff
insert into contracts (tenant_id, stall_id, start_date, end_date, status)
values (:t2, :eve_a2, '2025-10-01', '2026-09-30', 'active') returning contract_id as c_exp \gset
select pg_temp.ok('สัญญาที่เลยวันสิ้นสุดยังเป็น "ใช้งาน" จนกว่าจะกดปิด', (select status from contracts where contract_id = :c_exp) = 'active');
select expire_contracts() as n_expired \gset
select pg_temp.ok('expire_contracts() ปิดได้ 1 ฉบับ แผงกลับเป็น "ว่าง" และสัญญาต่ออายุที่ยังไม่หมดไม่ถูกแตะ',
  :n_expired = 1 and (select status from contracts where contract_id = :c_exp) = 'expired'
  and pg_temp.stall_status(:eve_a2) = 'vacant' and (select status from contracts where contract_id = :c_new) = 'active');

\echo ''
\echo '=== 6) manager ดูได้อย่างเดียว ==='
:as_manager
select pg_temp.ok('manager เห็นสัญญาทั้งหมด', (select count(*) from contracts) >= 4);
select pg_temp.ok('manager แก้สัญญาไม่ได้ (0 แถว)',
  pg_temp.affected(format('update contracts set note = ''x'' where contract_id = %s', :c_new)) = 0);
select pg_temp.fails('manager ทำสัญญาใหม่ไม่ได้',
  format('insert into contracts (tenant_id, stall_id, start_date, end_date, status) values (%s, %s, ''2026-11-01'', ''2027-10-31'', ''active'')', :t2, :morning_a1),
  '42501|row-level security');

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
