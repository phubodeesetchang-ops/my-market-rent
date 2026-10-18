-- =====================================================================
--  ทดสอบขั้นที่ 4 (migration 004): เปลี่ยนอัตราค่าน้ำ-ไฟ และกันแอดมินคนสุดท้าย
--  รันบน PostgreSQL ทดสอบในเครื่องที่จำลอง Supabase (เหมือน step2_logic_rls_test.sql)
-- =====================================================================
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.ok(label text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS  %', label;
end $$;
create or replace function pg_temp.fails(label text, stmt text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then raise notice 'PASS  % → %', label, sqlerrm; return; end;
  raise exception 'FAIL (ควร error แต่ผ่าน): %', label;
end $$;
create or replace function pg_temp.affected(stmt text) returns int language plpgsql as $$
declare n int;
begin execute stmt; get diagnostics n = row_count; return n; end $$;
grant execute on all functions in schema pg_temp to anon, authenticated;

\set as_postgres 'reset role; select set_config(''request.jwt.claims'', '''', false) \\g /dev/null'
\set as_admin    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000001","role":"authenticated"}'', false) \\g /dev/null'
\set as_admin2   'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000005","role":"authenticated"}'', false) \\g /dev/null'
\set as_staff    'set role authenticated; select set_config(''request.jwt.claims'', ''{"sub":"a0000000-0000-0000-0000-000000000002","role":"authenticated"}'', false) \\g /dev/null'

:as_postgres
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000001', 'admin@test'),
  ('a0000000-0000-0000-0000-000000000002', 'staff@test'),
  ('a0000000-0000-0000-0000-000000000005', 'admin2@test');
insert into users (user_id, username, full_name, role) values
  ('a0000000-0000-0000-0000-000000000001', 'admin', 'ผู้ดูแล', 'admin'),
  ('a0000000-0000-0000-0000-000000000002', 'staff', 'เจ้าหน้าที่', 'staff');
select market_id as m_evening from markets where market_name = 'ตลาดเย็น' \gset

\echo ''
\echo '=== 1) เปลี่ยนอัตราค่าน้ำ-ไฟ ==='
:as_staff
select pg_temp.fails('staff เปลี่ยนอัตราไม่ได้',
  format('select change_utility_rate(%s, ''electricity'', 6, ''2026-11-01'')', :m_evening));
:as_admin
select change_utility_rate(:m_evening, 'electricity', 6, '2026-11-01') as new_rate_id \gset
select pg_temp.ok('อัตราเดิมสิ้นสุด 31 ต.ค. 2026 และอัตราใหม่ 6 บาทเริ่ม 1 พ.ย. 2026',
  (select effective_to from utility_rates where market_id = :m_evening and utility_type = 'electricity' and rate_per_unit = 5) = '2026-10-31'
  and (select rate_per_unit from utility_rates where rate_id = :new_rate_id) = 6
  and (select effective_to from utility_rates where rate_id = :new_rate_id) is null);
select pg_temp.ok('ค่าน้ำของตลาดเดียวกันไม่ถูกแตะ',
  (select count(*) from utility_rates where market_id = :m_evening and utility_type = 'water' and effective_to is null) = 1);
select pg_temp.fails('วันเริ่มใหม่ก่อนวันเริ่มของอัตราปัจจุบันไม่ได้',
  format('select change_utility_rate(%s, ''electricity'', 7, ''2026-10-15'')', :m_evening));
select pg_temp.fails('อัตรา 0 บาทไม่ได้',
  format('select change_utility_rate(%s, ''electricity'', 0, ''2027-01-01'')', :m_evening));
select change_utility_rate(:m_evening, 'electricity', 7, '2027-01-01') \g /dev/null
select pg_temp.ok('เปลี่ยนซ้ำได้ ประวัติเรียงต่อกันไม่ทับกัน (5 → 6 → 7)',
  (select string_agg(rate_per_unit::int || ':' || effective_from || '..' || coalesce(effective_to::text, 'ปัจจุบัน'), ' ' order by effective_from)
   from utility_rates where market_id = :m_evening and utility_type = 'electricity')
  = '5:2026-01-01..2026-10-31 6:2026-11-01..2026-12-31 7:2027-01-01..ปัจจุบัน');

\echo ''
\echo '=== 2) ต้องเหลือผู้ดูแลระบบอย่างน้อย 1 คน ==='
:as_admin
select pg_temp.fails('แอดมินคนเดียวลดบทบาทตัวเองไม่ได้',
  'update users set role = ''staff'' where username = ''admin''');
select pg_temp.fails('แอดมินคนเดียวระงับตัวเองไม่ได้',
  'update users set status = ''inactive'' where username = ''admin''');
select pg_temp.fails('ลบแอดมินคนสุดท้ายไม่ได้',
  'delete from users where username = ''admin''');
select pg_temp.ok('แก้ชื่อตัวเองได้ตามปกติ',
  pg_temp.affected('update users set full_name = ''ผู้ดูแลระบบหลัก'' where username = ''admin''') = 1);
:as_postgres
insert into users (user_id, username, full_name, role) values ('a0000000-0000-0000-0000-000000000005', 'admin2', 'แอดมินสำรอง', 'admin');
:as_admin
select pg_temp.ok('มีแอดมินคนที่ 2 แล้ว ลดบทบาทตัวเองได้',
  pg_temp.affected('update users set role = ''staff'' where username = ''admin''') = 1);
:as_admin2
select pg_temp.fails('ตอนนี้ admin2 เป็นแอดมินคนสุดท้าย ระงับไม่ได้',
  'update users set status = ''inactive'' where username = ''admin2''');
:as_postgres
select pg_temp.fails('ลบบัญชีใน auth.users ของแอดมินคนสุดท้ายก็ไม่ได้ (ลบต่อเนื่องมาที่ users)',
  'delete from auth.users where id = ''a0000000-0000-0000-0000-000000000005''');

:as_postgres
\echo ''
\echo '=== ทดสอบครบทุกข้อ ==='
