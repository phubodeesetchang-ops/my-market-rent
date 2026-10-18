-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 003 : ปรับโครงสร้างตลาดตามผังพื้นที่จริง (ข้อมูลเท่านั้น ไม่แก้ตาราง)
--
--  ก่อน → หลัง
--    ตลาดเช้า                        A–D × 10 = 40 แผง      → คงเดิม
--    ตลาดเย็น                        A–E × 10 = 50 แผง      → A = 8, B = 30  (38 แผง รายเดือน)
--    ตลาดกลางสามพร้าว                A–F × 10 = 60 แผง      → ลบออก
--    อาคาร OTOP (ตลาดกลางสามพร้าว)   A = 7, B = 7 (14 ห้อง)  → เปลี่ยนชื่อเป็น "อาคาร OTOP"
--                                                           A = 10, B = 8 (18 ห้อง รายปี)
--
--  รันซ้ำได้ ผลเหมือนเดิม · รันกับฐานข้อมูลที่ใช้ seed.sql รุ่นใหม่ก็ไม่เปลี่ยนอะไร
--  ถ้ามีสัญญาเช่า/การจดมิเตอร์ผูกกับแผงที่จะลบ จะหยุดทั้งหมดโดยไม่แก้อะไรเลย
-- =====================================================================


-- 0) ตรวจก่อน: แผงที่จะลบต้องไม่มีสัญญาหรือการจดมิเตอร์ -----------------------
do $$
declare
  v_used text;
begin
  select string_agg(distinct m.market_name || ' ' || s.stall_code, ', ') into v_used
  from public.stalls s
  join public.zones   z using (zone_id)
  join public.markets m using (market_id)
  where (
         m.market_name = 'ตลาดกลางสามพร้าว'
      or (m.market_name = 'ตลาดเย็น' and z.zone_name in ('C', 'D', 'E'))
      or (m.market_name = 'ตลาดเย็น' and z.zone_name = 'A' and substring(s.stall_code from '([0-9]+)$')::int > 8)
    )
    and (
         exists (select 1 from public.contracts c where c.stall_id = s.stall_id)
      or exists (select 1 from public.utility_readings r where r.stall_id = s.stall_id)
    );
  if v_used is not null then
    raise exception 'ปรับโครงสร้างไม่ได้ เพราะแผงต่อไปนี้มีสัญญาเช่าหรือการจดมิเตอร์อยู่: %', v_used;
  end if;
end $$;


-- 1) ลบตลาดกลางสามพร้าว (แผง → โซน → อัตรา/ค่าธรรมเนียม → ตลาด) -------------------
delete from public.stalls
where zone_id in (
  select z.zone_id from public.zones z
  join public.markets m using (market_id)
  where m.market_name = 'ตลาดกลางสามพร้าว'
);
delete from public.zones
where market_id in (select market_id from public.markets where market_name = 'ตลาดกลางสามพร้าว');
delete from public.utility_rates
where market_id in (select market_id from public.markets where market_name = 'ตลาดกลางสามพร้าว');
delete from public.fees
where market_id in (select market_id from public.markets where market_name = 'ตลาดกลางสามพร้าว');
delete from public.markets where market_name = 'ตลาดกลางสามพร้าว';


-- 2) เปลี่ยนชื่ออาคาร OTOP -------------------------------------------------------
update public.markets
set market_name = 'อาคาร OTOP',
    description = 'แผงเช่ารายปี 18 ห้อง (โซน A = 10, โซน B = 8) สัญญา 3 ปี'
where market_name = 'อาคาร OTOP (ตลาดกลางสามพร้าว)'
  and not exists (select 1 from public.markets where market_name = 'อาคาร OTOP');


-- 3) ตลาดเย็น: เหลือโซน A = 8 แผง, B = 30 แผง --------------------------------------
--    ลบโซน C, D, E และแผง A009 ขึ้นไป
delete from public.stalls
where zone_id in (
  select z.zone_id from public.zones z
  join public.markets m using (market_id)
  where m.market_name = 'ตลาดเย็น' and z.zone_name in ('C', 'D', 'E')
);
delete from public.zones
where zone_name in ('C', 'D', 'E')
  and market_id = (select market_id from public.markets where market_name = 'ตลาดเย็น');

delete from public.stalls s
using public.zones z, public.markets m
where s.zone_id = z.zone_id and z.market_id = m.market_id
  and m.market_name = 'ตลาดเย็น' and z.zone_name = 'A'
  and substring(s.stall_code from '([0-9]+)$')::int > 8;

update public.markets
set description = 'แผงเช่ารายเดือน 38 แผง (โซน A = 8, โซน B = 30)'
where market_name = 'ตลาดเย็น';


-- 4) เติมแผงให้ครบตามผัง (มีอยู่แล้วจะข้าม) ----------------------------------------
--    ตลาดเย็น  A001–A008, B001–B030 (แผง รายเดือน 150 บาท)
--    อาคาร OTOP A001–A010, B001–B008 (ห้อง รายปี ค่าเช่ายังไม่กำหนด)
insert into public.zones (market_id, zone_name, description)
select m.market_id, spec.zone_name, 'โซน ' || spec.zone_name
from (values
  ('ตลาดเย็น', 'A'), ('ตลาดเย็น', 'B'),
  ('อาคาร OTOP', 'A'), ('อาคาร OTOP', 'B')
) as spec (market_name, zone_name)
join public.markets m on m.market_name = spec.market_name
on conflict (market_id, zone_name) do nothing;

insert into public.stalls (zone_id, stall_code, unit_type, base_rent, rent_period, status)
select z.zone_id,
       z.zone_name || lpad(n::text, 3, '0'),
       spec.unit_type,
       spec.base_rent,
       spec.rent_period,
       'vacant'
from (values
  ('ตลาดเย็น',   'A',  8, 'stall', 150.00::numeric, 'monthly'),
  ('ตลาดเย็น',   'B', 30, 'stall', 150.00::numeric, 'monthly'),
  ('อาคาร OTOP', 'A', 10, 'room',  null::numeric,   'yearly'),
  ('อาคาร OTOP', 'B',  8, 'room',  null::numeric,   'yearly')
) as spec (market_name, zone_name, units, unit_type, base_rent, rent_period)
join public.markets m on m.market_name = spec.market_name
join public.zones   z on z.market_id = m.market_id and z.zone_name = spec.zone_name
cross join lateral generate_series(1, spec.units) as n
on conflict (zone_id, stall_code) do nothing;


-- 5) ตรวจผล: ต้องได้ ตลาดเช้า 40 · ตลาดเย็น A 8, B 30 · อาคาร OTOP A 10, B 8 ----------
select m.market_name, z.zone_name, count(s.stall_id) as units
from public.markets m
join public.zones  z using (market_id)
left join public.stalls s using (zone_id)
group by m.market_id, m.market_name, z.zone_name
order by m.market_id, z.zone_name;
