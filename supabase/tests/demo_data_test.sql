-- =====================================================================
--  ทดสอบข้อมูลจำลอง: demo_data.sql + demo_data_remove.sql
--  ตรวจว่าสร้างครบตามที่ออกแบบ ไม่แตะข้อมูลจริง รันซ้ำไม่ซ้ำ และลบได้หมดจด
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS  %', label;
end $$;
create or replace function pg_temp.stall(m text, z text, code text) returns int language sql as $$
  select s.stall_id from public.stalls s join public.zones zz using (zone_id) join public.markets mm using (market_id)
  where mm.market_name = m and zz.zone_name = z and s.stall_code = code
$$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set as_postgres 'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'

:as_postgres
select to_char(date_trunc('month', private.today_th()) - interval '2 months', 'YYYY-MM') as p1,
       to_char(date_trunc('month', private.today_th()) - interval '1 month', 'YYYY-MM') as p2,
       to_char(private.today_th(), 'YYYY-MM') as p0 \gset

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test'),
  ('a0000000-0000-0000-0000-000000000002', 'staff@test');
insert into users (user_id, username, full_name, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin', 'ผู้ดูแล', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff', 'เจ้าหน้าที่', 'staff');

-- ข้อมูลจริงที่มีอยู่ก่อน: ผู้เช่า 1 ราย สัญญา 1 ฉบับ มิเตอร์ + ใบแจ้งหนี้รอบล่าสุด
insert into tenants (full_name, id_card, phone) values ('ผู้เช่าจริง', '1101700230705', '0899999999');
select pg_temp.stall('ตลาดเย็น', 'A', 'A001') as real_stall \gset
insert into contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, status)
select tenant_id, :real_stall, date_trunc('month', private.today_th())::date - interval '6 months',
       date_trunc('month', private.today_th())::date + interval '6 months', 150, 'monthly', 'active'
from tenants where full_name = 'ผู้เช่าจริง';
select contract_id as real_contract from contracts where stall_id = :real_stall \gset
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading)
values (:real_stall, 'electricity', :'p2', 100, 150);
select public.generate_invoices(:'p2', private.today_th() + 7, array[:real_contract]) \g /dev/null

\echo '=== 1) สร้างข้อมูลจำลอง ==='
\ir ../demo_data.sql

create or replace view pg_temp.demo_contracts as
  select c.*, t.id_card from contracts c join tenants t using (tenant_id) where t.id_card like '00990000%';
create or replace view pg_temp.demo_invoices as
  select i.* from invoices i where i.contract_id in (select contract_id from pg_temp.demo_contracts);
grant select on pg_temp.demo_contracts, pg_temp.demo_invoices to authenticated;

select pg_temp.ok('ผู้เช่าจำลอง 20 ราย (1 รายระงับการใช้งาน)',
  (select count(*) = 20 and count(*) filter (where status = 'inactive') = 1 from tenants where id_card like '00990000%'));
select pg_temp.ok('สัญญาครบทุกสถานะ: ใช้งาน 15 · รออนุมัติ 2 · สิ้นสุด 2 · ยกเลิก 1 · ไม่อนุมัติ 1',
  (select count(*) filter (where status = 'active') = 15 and count(*) filter (where status = 'pending') = 2
      and count(*) filter (where status = 'expired') = 2 and count(*) filter (where status = 'cancelled') = 1
      and count(*) filter (where status = 'rejected') = 1 from pg_temp.demo_contracts));
select pg_temp.ok('ไม่ใช้แผงที่มีสัญญาจริงอยู่ (A001 ตลาดเย็น)',
  not exists (select 1 from pg_temp.demo_contracts where stall_id = :real_stall));
select pg_temp.ok('แผงของสัญญาใช้งาน = เช่า, ของคำขอรออนุมัติ = จอง',
  (select bool_and(s.status = case c.status when 'active' then 'rented' else 'reserved' end)
   from pg_temp.demo_contracts c join stalls s using (stall_id) where c.status in ('active', 'pending')));
select pg_temp.ok('มีสัญญาใกล้หมดอายุ (≤ 30 วัน) และสัญญาที่เลยวันสิ้นสุดแต่ยังไม่ปิด อย่างละ 1',
  (select count(*) filter (where end_date between private.today_th() and private.today_th() + 30) = 1
      and count(*) filter (where end_date < private.today_th()) = 1
   from pg_temp.demo_contracts where status = 'active'));
select pg_temp.ok('มีสัญญาต่ออายุ 1 ฉบับ (แผงและผู้เช่าเดิม เริ่มหลังสัญญาเดิมจบ)',
  (select count(*) = 1 from pg_temp.demo_contracts n join contracts o on o.contract_id = n.renewed_from_id
   where n.stall_id = o.stall_id and n.tenant_id = o.tenant_id and n.start_date > o.end_date));
select pg_temp.ok('คำขอจาก LINE (created_by ว่าง) 2 ฉบับ ที่เหลือผู้สร้างเป็นผู้ดูแลระบบ',
  (select count(*) filter (where created_by is null) = 2
      and count(*) filter (where created_by = 'a0000000-0000-0000-0000-000000000001') = 19 from pg_temp.demo_contracts));
select pg_temp.ok('สัญญาห้อง OTOP เป็นรายปี 3 ปี, แผงตลาดรายเดือน 1 ปี',
  (select bool_and(case when s.unit_type = 'room'
                        then c.rent_period = 'yearly' and c.end_date = (c.start_date + interval '3 years' - interval '1 day')::date
                        else c.rent_period = 'monthly' and c.end_date = (c.start_date + interval '1 year' - interval '1 day')::date end)
   from pg_temp.demo_contracts c join stalls s using (stall_id)));

select pg_temp.ok('มิเตอร์ 54 รายการ (รอบเก่า 26 · รอบล่าสุด 28) และทุกรายการผูกกับใบแจ้งหนี้แล้ว',
  (select count(*) = 54 and count(*) filter (where billing_period = :'p1') = 26 and bool_and(invoice_id is not null)
   from utility_readings where stall_id in (select stall_id from pg_temp.demo_contracts)));
select pg_temp.ok('2 แผงไม่มีมิเตอร์น้ำ → ใบแจ้งหนี้ค่าน้ำ 0 ทั้ง 2 รอบ',
  (select count(distinct c.stall_id) = 2 from pg_temp.demo_invoices i join contracts c using (contract_id)
   where i.water_amount = 0 and i.status <> 'cancelled'
     and not exists (select 1 from utility_readings u where u.stall_id = c.stall_id and u.utility_type = 'water')));
select pg_temp.ok('รอบล่าสุด: เลขต่อจากรอบก่อน (previous = current ของเดือนก่อน)',
  not exists (select 1 from utility_readings a join utility_readings b
                on b.stall_id = a.stall_id and b.utility_type = a.utility_type
              where a.billing_period = :'p1' and b.billing_period = :'p2' and b.previous_reading <> a.current_reading));

select pg_temp.ok('ใบแจ้งหนี้รอบเก่า 14 ใบ: ชำระแล้ว 12 · ค้างเลยกำหนด 2',
  (select count(*) = 14 and count(*) filter (where status = 'paid') = 12
      and count(*) filter (where status = 'unpaid' and due_date < private.today_th()) = 2
   from pg_temp.demo_invoices where billing_period = :'p1'));
select pg_temp.ok('ใบแจ้งหนี้รอบล่าสุด 16 ใบ: ยกเลิก 1 (ออกใหม่แล้ว) · ชำระแล้ว 4 · รอชำระ 11 ยังไม่เลยกำหนด',
  (select count(*) = 16 and count(*) filter (where status = 'cancelled') = 1 and count(*) filter (where status = 'paid') = 4
      and count(*) filter (where status = 'unpaid' and due_date >= private.today_th()) = 11
   from pg_temp.demo_invoices where billing_period = :'p2'));
select pg_temp.ok('ใบที่ออกใหม่แทนใบที่ยกเลิก: ค่าไฟเพิ่ม 15 หน่วย × 5 = 75 บาท',
  (select n.electricity_amount - o.electricity_amount = 75 and n.invoice_no > o.invoice_no
   from pg_temp.demo_invoices o join pg_temp.demo_invoices n on n.contract_id = o.contract_id and n.billing_period = o.billing_period
   where o.status = 'cancelled' and n.status = 'unpaid'));
select pg_temp.ok('ค่าเช่ารายปี: ห้องที่ครบรอบปีสัญญาเก็บเต็ม 18,000 · ห้องที่เริ่มรอบเก่าเก็บ 15,000 · เดือนอื่น 0',
  (select count(*) filter (where i.rent_amount = 18000 and i.billing_period = :'p2') = 1
      and count(*) filter (where i.rent_amount = 15000 and i.billing_period = :'p1') = 1
      and count(*) filter (where i.rent_amount = 0) = 4
   from pg_temp.demo_invoices i join contracts c using (contract_id) where c.rent_period = 'yearly'));
select pg_temp.ok('ทุกใบที่ชำระแล้วมีการชำระที่ตรวจแล้ว 1 รายการ ยอดตรงกัน + ใบเสร็จออกอัตโนมัติยอดตรงกัน (16 ใบ)',
  (select count(*) = 16 and bool_and(p.amount = i.total_amount and r.amount = i.total_amount and p.verified_at is not null)
   from pg_temp.demo_invoices i join payments p using (invoice_id) join receipts r using (payment_id)
   where i.status = 'paid' and p.status = 'verified'));
select pg_temp.ok('แจ้งโอนรอตรวจสลิป 2 รายการ (ใบยังรอชำระ)',
  (select count(*) = 2 and bool_and(i.status = 'unpaid' and p.verified_at is null)
   from pg_temp.demo_invoices i join payments p using (invoice_id) where p.status = 'pending'));
select pg_temp.ok('แบ่งจ่าย: ใบที่จ่ายมาครึ่งหนึ่งยังเป็นรอชำระ (เกินกำหนด) และมีใบเสร็จของยอดที่จ่าย',
  (select count(*) = 1 and bool_and(i.status = 'unpaid' and p.amount < i.total_amount and r.amount = p.amount)
   from pg_temp.demo_invoices i join payments p using (invoice_id) join receipts r using (payment_id)
   where i.billing_period = :'p1' and p.status = 'verified' and i.status = 'unpaid'));
select pg_temp.ok('ใบเสร็จที่ยกเลิก: การชำระเป็นไม่ผ่าน ใบเสร็จยังอยู่ ใบแจ้งหนี้กลับเป็นรอชำระ และมีเหตุผลในหมายเหตุ',
  (select count(*) = 1 and bool_and(i.status = 'unpaid' and p.note like '%ยกเลิกใบเสร็จ RC-%ให้ผู้เช่าโอนใหม่%')
   from pg_temp.demo_invoices i join payments p using (invoice_id) join receipts r using (payment_id)
   where p.status = 'rejected'));
select pg_temp.ok('วันที่ใบเสร็จ = วันที่ตรวจ (เลขใบเสร็จตามเดือนที่ตรวจ)',
  (select bool_and(r.receipt_date = (p.verified_at at time zone 'Asia/Bangkok')::date
                   and r.receipt_no like 'RC-' || to_char(r.receipt_date + interval '543 years', 'YYYYMM') || '-%')
   from receipts r join payments p using (payment_id) where p.invoice_id in (select invoice_id from pg_temp.demo_invoices)));
select pg_temp.ok('วันที่ชำระ/ใบเสร็จไม่เกินวันนี้',
  (select bool_and(p.payment_date <= private.today_th()) from payments p where invoice_id in (select invoice_id from pg_temp.demo_invoices)));

select pg_temp.ok('ไม่ได้ออกใบแจ้งหนี้ให้สัญญาจริง (รอบเก่าไม่มี, รอบล่าสุดยังมีใบเดิมใบเดียว)',
  (select count(*) filter (where billing_period = :'p1') = 0 and count(*) filter (where billing_period = :'p2') = 1
   from invoices where contract_id = :real_contract));

:as_staff
select pg_temp.ok('หน้าจดมิเตอร์เดือนนี้: แผงจำลองแนะนำเลขครั้งก่อน = เลขล่าสุดของเดือนที่แล้ว',
  (select count(*) = 15 and bool_and(m.electricity_suggested = u.current_reading)
   from meter_sheet(:'p0') m join utility_readings u
     on u.stall_id = m.stall_id and u.utility_type = 'electricity' and u.billing_period = :'p2'
   where m.stall_id in (select stall_id from pg_temp.demo_contracts)));
select pg_temp.ok('ตัวอย่างใบแจ้งหนี้เดือนนี้: ยังไม่จดมิเตอร์ → has_electricity = false ทุกแผงจำลอง',
  (select count(*) = 15 and bool_and(not has_electricity and gets_utility and invoice_id is null)
   from preview_invoices(:'p0') where contract_id in (select contract_id from pg_temp.demo_contracts)));
-- ระหว่างทดลองใช้: เจ้าหน้าที่จดมิเตอร์เดือนนี้ให้แผงจำลอง 1 แผง และแผงจริง 1 แผง
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading)
select stall_id, 'electricity', :'p0', electricity_suggested, electricity_suggested + 20
from meter_sheet(:'p0') where stall_id in (select stall_id from pg_temp.demo_contracts where status = 'active') order by stall_id limit 1;
insert into utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading)
values (:real_stall, 'electricity', :'p0', 150, 190);

:as_postgres
\echo '=== 2) รันซ้ำต้องไม่สร้างซ้ำ ==='
\ir ../demo_data.sql
select pg_temp.ok('รันซ้ำแล้วยังมีผู้เช่าจำลอง 20 ราย สัญญา 21 ฉบับ',
  (select count(*) = 21 from pg_temp.demo_contracts) and (select count(*) = 20 from tenants where id_card like '00990000%'));

select array_agg(stall_id) as demo_stalls from (select distinct stall_id from pg_temp.demo_contracts) x \gset

\echo '=== 3) ลบข้อมูลจำลอง ==='
\ir ../demo_data_remove.sql
select pg_temp.ok('ไม่เหลือผู้เช่า/สัญญา/ใบแจ้งหนี้/การชำระ/ใบเสร็จของข้อมูลจำลอง',
  not exists (select 1 from tenants where id_card like '00990000%')
  and (select count(*) = 1 from contracts) and (select count(*) = 1 from invoices)
  and not exists (select 1 from payments) and not exists (select 1 from receipts));
select pg_temp.ok('มิเตอร์ของแผงจำลองหายหมด (รวมที่จดเพิ่มระหว่างทดลอง) แผงจริงยังอยู่ครบ 2 รายการ',
  not exists (select 1 from utility_readings where stall_id = any (:'demo_stalls'::int[]))
  and (select count(*) = 2 from utility_readings where stall_id = :real_stall));
select pg_temp.ok('แผงที่ข้อมูลจำลองใช้กลับเป็นว่างทั้งหมด',
  (select bool_and(status = 'vacant') from stalls where stall_id = any (:'demo_stalls'::int[])));
select pg_temp.ok('ข้อมูลจริงไม่ถูกแตะ: ผู้เช่า สัญญาใช้งาน ใบแจ้งหนี้ และแผงยังเช่าอยู่',
  (select count(*) = 1 from tenants) and (select status = 'active' from contracts where contract_id = :real_contract)
  and (select status = 'rented' from stalls where stall_id = :real_stall)
  and (select status = 'unpaid' from invoices where contract_id = :real_contract));
\ir ../demo_data_remove.sql

\echo '=== 4) สร้างใหม่หลังลบ ==='
\ir ../demo_data.sql
select pg_temp.ok('สร้างใหม่ได้ครบ 20 ราย 30 ใบแจ้งหนี้',
  (select count(*) = 20 from tenants where id_card like '00990000%') and (select count(*) = 30 from pg_temp.demo_invoices));

\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
