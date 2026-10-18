-- =====================================================================
--  ข้อมูลตั้งต้น 4 ตลาด
--  รันหลังจาก migration 001 แล้ว — รันซ้ำได้ ไม่สร้างข้อมูลซ้ำ
--
--  ตลาด          โซน                  แผง/ห้อง  ค่าเช่าเริ่มต้น
--  ตลาดเช้า      A–D × 10             40 แผง    150 บาท/เดือน
--  ตลาดเย็น      A = 8, B = 30        38 แผง    150 บาท/เดือน
--  อาคาร OTOP    A = 10, B = 8        18 ห้อง   รายปี ตามขนาดห้อง (ยังไม่กำหนด)
--
--  ตลาดเย็นและอาคาร OTOP อยู่ในผังพื้นที่เดียวกัน (ดูตำแหน่งใน web/src/lib/siteLayouts.js)
--
--  ทุกตลาด: ค่าไฟ 5 บาท/หน่วย, ค่าน้ำ 5 บาท/หน่วย, ค่าธรรมเนียม 5 บาท/เดือน
--
--  หมายเหตุ: ไฟล์นี้ไม่สร้างตารางใด ๆ (ไม่มีตารางชั่วคราว) แต่ละคำสั่งทำงานจบในตัวเอง
--  จึงรันใน SQL Editor ของ Supabase ได้ตรง ๆ และไม่ขึ้นหน้าต่างเตือนเรื่อง RLS
-- =====================================================================


-- 1) ตลาด ---------------------------------------------------------------
insert into public.markets (market_name, market_type, description) values
  ('ตลาดเช้า',    'market',   'แผงเช่ารายเดือน 40 แผง (โซน A–D)'),
  ('ตลาดเย็น',    'market',   'แผงเช่ารายเดือน 38 แผง (โซน A = 8, โซน B = 30)'),
  ('อาคาร OTOP',  'building', 'แผงเช่ารายปี 18 ห้อง (โซน A = 10, โซน B = 8) สัญญา 3 ปี')
on conflict (market_name) do nothing;


-- 2) โซน ----------------------------------------------------------------
insert into public.zones (market_id, zone_name, description)
select m.market_id, z.zone_name, 'โซน ' || z.zone_name
from (values
  ('ตลาดเช้า',    array['A','B','C','D']),
  ('ตลาดเย็น',    array['A','B']),
  ('อาคาร OTOP',  array['A','B'])
) as spec (market_name, zone_names)
join public.markets m on m.market_name = spec.market_name
cross join lateral unnest(spec.zone_names) as z (zone_name)
on conflict (market_id, zone_name) do nothing;


-- 3) แผง/ห้อง (รหัส = ชื่อโซน + เลข 3 หลัก เช่น A001) ----------------------
insert into public.stalls (zone_id, stall_code, unit_type, base_rent, rent_period, status)
select zn.zone_id,
       zn.zone_name || lpad(n::text, 3, '0'),
       spec.unit_type,
       spec.base_rent,
       spec.rent_period,
       'vacant'
from (values
  ('ตลาดเช้า',   'A', 10, 'stall', 150.00::numeric, 'monthly'),
  ('ตลาดเช้า',   'B', 10, 'stall', 150.00::numeric, 'monthly'),
  ('ตลาดเช้า',   'C', 10, 'stall', 150.00::numeric, 'monthly'),
  ('ตลาดเช้า',   'D', 10, 'stall', 150.00::numeric, 'monthly'),
  ('ตลาดเย็น',   'A',  8, 'stall', 150.00::numeric, 'monthly'),
  ('ตลาดเย็น',   'B', 30, 'stall', 150.00::numeric, 'monthly'),
  ('อาคาร OTOP', 'A', 10, 'room',  null::numeric,   'yearly'),
  ('อาคาร OTOP', 'B',  8, 'room',  null::numeric,   'yearly')
) as spec (market_name, zone_name, units, unit_type, base_rent, rent_period)
join public.markets m  on m.market_name = spec.market_name
join public.zones   zn on zn.market_id  = m.market_id and zn.zone_name = spec.zone_name
cross join lateral generate_series(1, spec.units) as n
on conflict (zone_id, stall_code) do nothing;


-- 4) อัตราค่าน้ำ-ไฟ 5 บาท/หน่วย --------------------------------------------
insert into public.utility_rates (market_id, utility_type, rate_per_unit, effective_from)
select m.market_id, t.utility_type, 5.00, date '2026-01-01'
from public.markets m
cross join (values ('electricity'), ('water')) as t (utility_type)
where not exists (
  select 1 from public.utility_rates r
  where r.market_id = m.market_id and r.utility_type = t.utility_type
);


-- 5) ค่าธรรมเนียม 5 บาท/เดือน (รวมในบิลรายเดือน) -------------------------
insert into public.fees (market_id, fee_name, fee_amount, fee_period)
select m.market_id, 'ค่าธรรมเนียมรายเดือน', 5.00, 'monthly'
from public.markets m
where not exists (
  select 1 from public.fees f
  where f.market_id = m.market_id and f.fee_name = 'ค่าธรรมเนียมรายเดือน'
);


-- 6) ตรวจผล: ต้องได้ 3 แถว คือ ตลาดเช้า 40 / ตลาดเย็น 38 / อาคาร OTOP 18 ------
select m.market_name, count(s.stall_id) as units
from public.markets m
join public.zones  z using (market_id)
join public.stalls s using (zone_id)
group by m.market_id, m.market_name
order by m.market_id;
