-- =====================================================================
--  ทดสอบขั้นที่ 8: สิ่งที่ผู้เช่าทำเองผ่าน LINE (migration 008 + RLS เดิม)
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
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant1  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_tenant2  'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'
\set as_unlinked 'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"b0000000-0000-0000-0000-000000000009","role":"authenticated"}'', false) \\g /dev/null'

:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('b0000000-0000-0000-0000-000000000001', 'line_u1@line.local'),
  ('b0000000-0000-0000-0000-000000000002', 'line_u2@line.local'),
  ('b0000000-0000-0000-0000-000000000009', 'line_u9@line.local');
insert into users (user_id, username, full_name, role) values ('a0000000-0000-0000-0000-000000000002', 'staff', 'เจ้าหน้าที่', 'staff');
insert into tenants (full_name, id_card, phone, address, business_name, line_user_id, auth_id) values
  ('ผู้เช่าหนึ่ง', '1101700230708', '0810000001', 'อุดร', 'ร้านหนึ่ง', 'U1', 'b0000000-0000-0000-0000-000000000001'),
  ('ผู้เช่าสอง', '3509900123450', '0810000002', 'อุดร', 'ร้านสอง', 'U2', 'b0000000-0000-0000-0000-000000000002');
select tenant_id as t1 from tenants where line_user_id = 'U1' \gset
select tenant_id as t2 from tenants where line_user_id = 'U2' \gset
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status)
values (:t2, pg_temp.stall('ตลาดเย็น', 'B', 'B001'), '2026-01-01', '2026-12-31', 150, 'monthly', 'active');

\echo '=== 1) ผู้เช่าแก้ข้อมูลตัวเอง ==='
:as_tenant1
select pg_temp.ok('แก้เบอร์โทร ที่อยู่ ชื่อร้านของตัวเองได้',
  pg_temp.affected('update tenants set phone = ''0899999999'', address = ''บ้านใหม่'', business_name = ''ร้านใหม่''') = 1);
select pg_temp.fails('แก้ชื่อ-นามสกุลเองไม่ได้', 'update tenants set full_name = ''ชื่อปลอม''', 'เฉพาะเบอร์โทร');
select pg_temp.fails('แก้เลขบัตรเองไม่ได้', 'update tenants set id_card = ''1234567890121''', 'เฉพาะเบอร์โทร');
select pg_temp.fails('แก้สถานะเองไม่ได้', 'update tenants set status = ''inactive''', 'สถานะหรือบัญชี LINE');
select pg_temp.fails('ยกเลิกการผูก LINE เองไม่ได้', 'update tenants set line_user_id = null', 'สถานะหรือบัญชี LINE');
select pg_temp.fails('ลบเบอร์โทรจนว่างไม่ได้', 'update tenants set phone = '' ''', 'เบอร์โทร');
select pg_temp.ok('แก้ข้อมูลผู้เช่าคนอื่นไม่ได้ (0 แถว)', pg_temp.affected(format('update tenants set phone = ''0811111111'' where tenant_id = %s', :t2)) = 0);
:as_staff
select pg_temp.ok('เจ้าหน้าที่ยังแก้ชื่อและเลขบัตรให้ได้ตามปกติ', pg_temp.affected(format('update tenants set full_name = ''ผู้เช่าหนึ่ง (แก้)'' where tenant_id = %s', :t1)) = 1);
select pg_temp.ok('เจ้าหน้าที่ยกเลิกการผูก LINE ได้', pg_temp.affected(format('update tenants set line_user_id = null, auth_id = null where tenant_id = %s', :t2)) = 1);
:as_tenant2
select pg_temp.ok('ผู้เช่าที่ถูกยกเลิกการผูก มองไม่เห็นข้อมูลตัวเอง/สัญญาอีก', (select count(*) from tenants) = 0 and (select count(*) from contracts) = 0);
:as_postgres
update tenants set line_user_id = 'U2', auth_id = 'b0000000-0000-0000-0000-000000000002' where tenant_id = :t2;

\echo '=== 2) ผู้เช่าขอเช่าแผงเอง ==='
:as_tenant1
select pg_temp.ok('ผู้เช่าเห็นผังทั้งหมด (ตลาด โซน แผงพร้อมสถานะ) แต่ไม่เห็นสัญญาของคนอื่น',
  (select count(*) from stalls) = 96 and (select count(*) from zones) = 8 and (select count(*) from contracts) = 0
  and (select status from stalls where stall_id = pg_temp.stall('ตลาดเย็น', 'B', 'B001')) = 'rented');
select pg_temp.fails('ขอเช่าโดยวันเริ่มย้อนหลังไม่ได้',
  format('insert into contracts (stall_id, start_date, end_date) values (%s, private.today_th() - 1, private.today_th() + 364)', pg_temp.stall('ตลาดเย็น', 'B', 'B002')), 'ย้อนหลัง');
select pg_temp.fails('ขอเช่าล่วงหน้าเกิน 1 ปีไม่ได้',
  format('insert into contracts (stall_id, start_date, end_date) values (%s, private.today_th() + 400, private.today_th() + 800)', pg_temp.stall('ตลาดเย็น', 'B', 'B002')), 'ไม่เกิน 1 ปี');
insert into contracts (stall_id, start_date, end_date, note)
select s, private.today_th() + 14, private.today_th() + 378, 'ขายผลไม้'
from unnest(array[pg_temp.stall('ตลาดเย็น', 'B', 'B002'), pg_temp.stall('ตลาดเย็น', 'B', 'B003'), pg_temp.stall('ตลาดเย็น', 'B', 'B004')]) s;
select pg_temp.ok('ขอเช่าได้ 3 แผง: เป็นรออนุมัติ ค่าเช่าตามแผง แผงกลายเป็น "จอง"',
  (select count(*) = 3 and bool_and(status = 'pending' and rent_amount = 150 and tenant_id = :t1) from contracts)
  and (select status from stalls where stall_id = pg_temp.stall('ตลาดเย็น', 'B', 'B002')) = 'reserved');
select pg_temp.fails('คำขอที่ 4 ขณะยังมีรออนุมัติ 3 แผง → ให้รอหรือยกเลิกคำขอเดิม',
  format('insert into contracts (stall_id, start_date, end_date) values (%s, private.today_th() + 14, private.today_th() + 378)', pg_temp.stall('ตลาดเย็น', 'B', 'B005')), 'รออนุมัติอยู่ 3 แผง');
select pg_temp.ok('ยกเลิกคำขอของตัวเองได้ → แผงกลับเป็นว่าง',
  pg_temp.affected(format('update contracts set status = ''cancelled'' where stall_id = %s', pg_temp.stall('ตลาดเย็น', 'B', 'B004'))) = 1);
insert into contracts (stall_id, start_date, end_date) values (pg_temp.stall('ตลาดเย็น', 'B', 'B005'), private.today_th() + 14, private.today_th() + 378);
select pg_temp.ok('ยกเลิกแล้วขอแผงใหม่ได้ (รออนุมัติยังไม่เกิน 3)', (select count(*) from contracts where status = 'pending') = 3);
select pg_temp.fails('ผู้เช่าอนุมัติคำขอเองไม่ได้',
  format('update contracts set status = ''active'' where stall_id = %s', pg_temp.stall('ตลาดเย็น', 'B', 'B005')), 'ยกเลิกคำขอเช่าที่รออนุมัติได้อย่างเดียว');
:as_tenant2
select pg_temp.fails('ผู้เช่าอีกคนขอแผงที่ถูกจองแล้วไม่ได้',
  format('insert into contracts (stall_id, start_date, end_date) values (%s, private.today_th() + 14, private.today_th() + 378)', pg_temp.stall('ตลาดเย็น', 'B', 'B002')), 'ไม่ว่าง');
:as_staff
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status)
select :t1, pg_temp.stall('ตลาดเย็น', 'B', 'B010'), private.today_th() - 30, private.today_th() + 335, 150, 'monthly', 'pending';
select pg_temp.ok('เจ้าหน้าที่สร้างคำขอแทนผู้เช่าได้แม้มีครบ 3 และวันเริ่มย้อนหลัง (กติกานี้ใช้กับผู้เช่าเท่านั้น)',
  (select count(*) from contracts where tenant_id = :t1 and status = 'pending') = 4);

\echo '=== 3) บัญชี LINE ที่ยังไม่ผูก ==='
:as_postgres
select pg_temp.stall('ตลาดเย็น', 'B', 'B020') as s20 \gset
:as_unlinked
select pg_temp.ok('มองไม่เห็นข้อมูลผู้เช่า สัญญา ใบแจ้งหนี้ ใดๆ', (select count(*) from tenants) = 0 and (select count(*) from contracts) = 0 and (select count(*) from invoices) = 0);
select pg_temp.fails('ขอเช่าแผงไม่ได้', format('insert into contracts (stall_id, start_date, end_date) values (%s, private.today_th() + 1, private.today_th() + 365)', :s20), 'ไม่พบแผง|ยังไม่ได้ผูก');
select pg_temp.ok('มองไม่เห็นผังแผง (ต้องผูกก่อน)', (select count(*) from stalls) = 0);

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
