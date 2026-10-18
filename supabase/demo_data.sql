-- =====================================================================
--  ข้อมูลจำลองสำหรับทดลองใช้ระบบ (ผู้เช่า 20 ราย)
--
--  วิธีใช้: รัน migration 001–007 และ seed.sql ก่อน แล้วคัดลอกไฟล์นี้ทั้งไฟล์
--  ไปวางใน Supabase → SQL Editor → Run
--
--  สร้างอะไรบ้าง (วันที่คำนวณจากวันที่รัน ไม่ใช่วันตายตัว)
--    • ผู้เช่าสมมติ 20 ราย — เลขบัตรขึ้นต้นด้วย 00990000 (คนจริงไม่มีเลขแบบนี้)
--      ใช้เป็นเครื่องหมายแยกข้อมูลจำลองออกจากข้อมูลจริง
--    • สัญญาหลายสถานะ: ใช้งาน, ใกล้หมดอายุ, เลยวันสิ้นสุดแต่ยังไม่ปิด, ต่ออายุ,
--      คำขอรออนุมัติ (จาก LINE และจากเจ้าหน้าที่), ยกเลิก, ไม่อนุมัติ, สิ้นสุดแล้ว
--      ลงในแผง/ห้องที่ว่างอยู่และยังไม่เคยมีสัญญา (ไม่ทับข้อมูลจริง)
--    • มิเตอร์น้ำ-ไฟ 2 เดือนที่แล้ว (บางแผงในตลาดไม่มีมิเตอร์น้ำ)
--    • ใบแจ้งหนี้ 2 รอบ: รอบเก่าชำระแล้วเกือบหมด (มีใบเสร็จ) เหลือค้าง 2 ใบเกินกำหนด (ใบหนึ่งจ่ายมาครึ่งหนึ่ง),
--      รอบล่าสุดมีทั้งชำระแล้ว รอตรวจสลิป รอชำระ ใบเสร็จที่ถูกยกเลิก และใบแจ้งหนี้ที่ยกเลิกแล้วออกใหม่
--    • เดือนปัจจุบันยังไม่จดมิเตอร์ — ให้ลองจดและออกใบแจ้งหนี้เองในหน้าเว็บ
--
--  รันซ้ำได้: ถ้ามีข้อมูลจำลองอยู่แล้วจะข้าม (ไม่สร้างซ้ำ)
--  ลบทิ้ง: รัน demo_data_remove.sql (ลบเฉพาะข้อมูลจำลอง รวมถึงที่ทดลองเพิ่มเองในหน้าเว็บ
--          เช่น มิเตอร์/ใบแจ้งหนี้/สัญญาของผู้เช่าจำลอง)
--
--  ไฟล์นี้ไม่สร้างตารางชั่วคราว ทั้งหมดอยู่ในบล็อก DO เดียว ถ้าผิดพลาดตรงไหน
--  จะยกเลิกทั้งหมด ไม่มีข้อมูลค้างครึ่ง ๆ กลาง ๆ
-- =====================================================================

do $demo$
declare
  v_today   date := private.today_th();
  v_month0  date := date_trunc('month', private.today_th())::date;         -- วันแรกของเดือนนี้
  v_p1      text := to_char(date_trunc('month', private.today_th()) - interval '2 months', 'YYYY-MM');
  v_p2      text := to_char(date_trunc('month', private.today_th()) - interval '1 month', 'YYYY-MM');
  v_p1s     date;  v_p1e date;  v_p2s date;  v_p2e date;
  v_admin   uuid := (select u.user_id from public.users u where u.role = 'admin' and u.status = 'active' order by u.created_at limit 1);
  v_stalls  int[];   -- แผงตลาดที่ว่างและไม่เคยมีสัญญา (สุ่มกระจายแบบคงที่)
  v_rooms   int[];   -- ห้อง OTOP ที่ว่างและไม่เคยมีสัญญา
  v_t       int[];   -- tenant_id ตามลำดับผู้เช่า 1–20
  v_c       int[] := array_fill(null::int, array[20]);  -- สัญญาหลักของผู้เช่าแต่ละราย
  v_old12   int;     -- สัญญาเดิมของผู้เช่าที่ 12 (ต่ออายุแล้ว)
  v_stall   int;
  v_room    boolean;
  v_id      int;
  v_pay     int;
  v_inv     record;
  v_k       int;
  v_n1      int;
  v_n2      int;
  r         record;
begin
  if exists (select 1 from public.tenants where id_card like '00990000%') then
    raise notice 'มีข้อมูลจำลองอยู่แล้ว ไม่ได้สร้างซ้ำ — ถ้าต้องการเริ่มใหม่ ให้รัน demo_data_remove.sql ก่อน';
    return;
  end if;

  v_p1s := private.period_start(v_p1);  v_p1e := private.period_end(v_p1);
  v_p2s := private.period_start(v_p2);  v_p2e := private.period_end(v_p2);

  -- ---------- แผง/ห้องที่จะใช้ ----------
  select array_agg(s.stall_id order by md5(s.stall_id::text || 'demo')) into v_stalls
  from public.stalls s
  join public.zones z on z.zone_id = s.zone_id
  join public.markets m on m.market_id = z.market_id
  where m.market_type = 'market' and m.status = 'active' and s.status = 'vacant' and s.rent_period = 'monthly'
    and not exists (select 1 from public.contracts c where c.stall_id = s.stall_id);

  select array_agg(s.stall_id order by z.zone_name, s.stall_code) into v_rooms
  from public.stalls s
  join public.zones z on z.zone_id = s.zone_id
  join public.markets m on m.market_id = z.market_id
  where m.market_type = 'building' and m.status = 'active' and s.status = 'vacant'
    and not exists (select 1 from public.contracts c where c.stall_id = s.stall_id);

  if coalesce(array_length(v_stalls, 1), 0) < 16 or coalesce(array_length(v_rooms, 1), 0) < 4 then
    raise exception 'แผงว่างไม่พอสำหรับข้อมูลจำลอง (ต้องมีแผงตลาดว่าง 16 แผง และห้อง OTOP ว่าง 4 ห้อง — มี % และ %)',
      coalesce(array_length(v_stalls, 1), 0), coalesce(array_length(v_rooms, 1), 0);
  end if;

  -- ---------- ผู้เช่า 20 ราย (เรียงตามเลขบัตร = ลำดับ 1–20) ----------
  with ins as (
    insert into public.tenants (full_name, id_card, phone, address, business_name, status)
    values
      ('นางสาวพิมพ์ชนก แสงทอง', '0099000001013', '0812341101', '12/3 หมู่ 2 ต.ในเมือง',    'ผลไม้สดพิมพ์ชนก',      'active'),
      ('นายสมพงษ์ ศรีสุข',       '0099000002028', '0812341102', '45 หมู่ 5 ต.บ้านใหม่',    'ข้าวแกงศรีสุข',         'active'),
      ('นางมาลี บุญมา',          '0099000003032', '0812341103', '8 หมู่ 1 ต.หนองบัว',      'ผักปลอดสารป้ามาลี',    'active'),
      ('นายวีระ ทองดี',          '0099000004047', '0812341104', '101 ถ.ตลาดเก่า',          'หมูปิ้งลุงวีระ',         'active'),
      ('นางสาวกาญจนา พรหมมา',   '0099000005051', '0812341105', '7/1 ซ.วัดกลาง',            'น้ำปั่นกาญจนา',         'active'),
      ('นายประยูร คำแก้ว',       '0099000006066', '0812341106', '66 หมู่ 3 ต.ท่าน้ำ',      'ปลาสดประยูร',           'active'),
      ('นางบุญเรือน ชัยมงคล',    '0099000007071', '0812341107', '19 หมู่ 7 ต.บ้านใหม่',    'ขนมไทยบุญเรือน',       'active'),
      ('นายอนุชา มีสุข',         '0099000008085', '0812341108', '230 ถ.สายกลาง',            'ก๋วยเตี๋ยวเรืออนุชา',  'active'),
      ('นางสาวศิริพร วงศ์ใหญ่',  '0099000009090', '0812341109', '5 ซ.สุขใจ',                'เสื้อผ้ามือสองศิริพร',  'active'),
      ('นายสุรชัย อินทร์แก้ว',   '0099000010101', '0812341110', '88 หมู่ 4 ต.หนองบัว',     'ไก่ทอดสุรชัย',          'active'),
      ('นางทองใบ สุขเจริญ',      '0099000011116', '0812341111', '14 หมู่ 6 ต.ท่าน้ำ',      'แกงถุงทองใบ',           'active'),
      ('นายชาญวิทย์ ปัญญาดี',    '0099000012121', '0812341112', '3/9 ถ.ตลาดเก่า',          'กาแฟโบราณชาญวิทย์',    'active'),
      ('นางสาวรัตนา ศรีวงศ์',    '0099000013135', '0812341113', '52 หมู่ 8 ต.บ้านใหม่',    'ผ้าทอมือรัตนา',         'active'),
      ('นายเกษม จันทร์หอม',      '0099000014140', '0812341114', '9 หมู่ 2 ต.หนองบัว',      'จักสานไม้ไผ่เกษม',     'active'),
      ('นางจันทร์เพ็ญ ดวงดี',    '0099000015154', '0812341115', '77 ซ.วัดกลาง',             'น้ำพริกแม่จันทร์เพ็ญ', 'active'),
      ('นายธนพล รุ่งเรือง',      '0099000016169', '0812341116', '120 หมู่ 1 ต.ในเมือง',    'ลูกชิ้นปิ้งธนพล',       'active'),
      ('นางสาวอรอุมา แก้วใส',    '0099000017173', '0812341117', '31 ถ.สายกลาง',             'สบู่สมุนไพรอรอุมา',    'active'),
      ('นายบุญชู พึ่งบุญ',       '0099000018188', '0812341118', '6 หมู่ 9 ต.ท่าน้ำ',       'ซ่อมรองเท้าบุญชู',     'active'),
      ('นางสาวนภา สายสุด',       '0099000019192', '0812341119', '40/2 ซ.สุขใจ',             'เครื่องประดับนภา',     'active'),
      ('นายสมศักดิ์ ใจเย็น',     '0099000020204', '0812341120', '18 หมู่ 3 ต.บ้านใหม่',    'ผลไม้ดองสมศักดิ์',     'inactive')
    returning tenant_id, id_card
  )
  select array_agg(tenant_id order by id_card) into v_t from ins;

  -- ---------- สัญญา ----------
  --  n = ผู้เช่าลำดับที่, kind = s แผงตลาด / r ห้อง OTOP, unit = ลำดับแผง/ห้องในรายการว่าง
  --  สัญญาตลาด 1 ปี (สิ้นสุด = เริ่ม + 1 ปี − 1 วัน), ห้อง OTOP 3 ปี
  for r in
    select * from (values
      ( 1, 's',  1, v_month0 - interval '9 months',              150, 300, 'active',    false, null),
      ( 2, 's',  2, v_month0 - interval '8 months',              150, 300, 'active',    false, null),
      ( 3, 's',  3, v_month0 - interval '7 months',              150, 300, 'active',    false, null),
      ( 4, 's',  4, v_month0 - interval '6 months',              150, 300, 'active',    false, null),
      ( 5, 's',  5, v_month0 - interval '6 months' + interval '14 days', 150, 300, 'active', false, null),
      ( 6, 's',  6, v_month0 - interval '5 months',              150, null, 'active',   false, null),
      ( 7, 's',  7, v_month0 - interval '4 months',              150, 300, 'active',    false, null),
      ( 8, 's',  8, v_month0 - interval '3 months',              200, 400, 'active',    false, 'แผงหัวมุม ค่าเช่าสูงกว่าปกติ'),
      ( 9, 's',  9, v_p2s + interval '9 days',                   150, 300, 'active',    false, 'ผู้เช่าใหม่ เริ่มกลางเดือน'),
      (10, 's', 10, v_today + interval '21 days' - interval '1 year', 150, 300, 'active', false, null),
      (11, 's', 11, v_today - interval '4 days' - interval '1 year',  150, 300, 'active', false, null),
      (13, 'r',  1, v_p2s - interval '1 year',                 18000, 3000, 'active',   false, 'ห้องใหญ่ติดทางเข้า'),
      (14, 'r',  2, v_month0 - interval '5 months',            12000, 2000, 'active',   false, null),
      (15, 'r',  3, v_p1s,                                     15000, 2500, 'active',   false, null),
      (16, 's', 13, v_month0 + interval '1 month',               150, null, 'pending',  true,  null),
      (17, 'r',  4, v_month0 + interval '1 month',             12000, null, 'pending',  false, 'รอผู้เช่านำเอกสารมาให้ครบ'),
      (18, 's', 14, v_month0 - interval '2 months',              150, 300, 'cancelled', false, 'ยกเลิก: ผู้เช่าขอเลิกขาย ย้ายไปขายออนไลน์ (คืนเงินประกันแล้ว)'),
      (19, 's', 15, v_month0 + interval '1 month',               150, null, 'rejected', true,  'ไม่อนุมัติ: เอกสารไม่ครบ ให้ส่งสำเนาบัตรประชาชนใหม่'),
      (20, 's', 16, v_month0 - interval '20 months',             150, 300, 'expired',  false, null)
    ) as x (n, kind, unit, start_date, rent, deposit, status, from_line, note)
  loop
    v_room  := r.kind = 'r';
    v_stall := case when v_room then v_rooms[r.unit] else v_stalls[r.unit] end;
    insert into public.contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, deposit_amount, status, note, created_by, created_at)
    values (
      v_t[r.n], v_stall, r.start_date::date,
      (r.start_date + case when v_room then interval '3 years' else interval '1 year' end - interval '1 day')::date,
      r.rent, case when v_room then 'yearly' else 'monthly' end, r.deposit, r.status, r.note,
      case when r.from_line then null else v_admin end,
      case when r.status in ('pending', 'rejected') then (v_today - (r.n - 14))::timestamp + time '10:15'
           else (r.start_date::date - 3)::timestamp + time '10:15' end at time zone 'Asia/Bangkok'
    )
    returning contract_id into v_id;
    v_c[r.n] := v_id;
  end loop;

  -- ผู้เช่าที่ 12: สัญญาแรกสิ้นสุดก่อนรอบเก่า แล้วต่ออายุ (ค่าเช่าใหม่ 180)
  insert into public.contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, deposit_amount, status, created_by, created_at)
  values (v_t[12], v_stalls[12], (v_p1s - interval '1 year')::date, v_p1s - 1, 150, 'monthly', 300, 'expired', v_admin,
          (((v_p1s - interval '1 year')::date - 3)::timestamp + time '10:15') at time zone 'Asia/Bangkok')
  returning contract_id into v_old12;
  insert into public.contracts (tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, deposit_amount, status, renewed_from_id, note, created_by, created_at)
  values (v_t[12], v_stalls[12], v_p1s, (v_p1s + interval '1 year' - interval '1 day')::date, 180, 'monthly', 300, 'active', v_old12,
          'ต่ออายุ ปรับค่าเช่าเป็น 180 บาท', v_admin, ((v_p1s - 10)::timestamp + time '10:15') at time zone 'Asia/Bangkok')
  returning contract_id into v_id;
  v_c[12] := v_id;

  -- วันที่ลงทะเบียนผู้เช่า = ก่อนสัญญาแรกของตัวเอง
  update public.tenants t
  set created_at = (select min(c.created_at) from public.contracts c where c.tenant_id = t.tenant_id) - interval '1 day'
  where t.tenant_id = any (v_t);

  -- ---------- มิเตอร์น้ำ-ไฟ 2 รอบ ----------
  -- เลขมิเตอร์คำนวณจากรหัสแผง (รันกี่ครั้งก็ได้เลขชุดเดิม) รอบหลังต่อจากรอบก่อน
  -- ผู้เช่าที่ 2 และ 6 (แผงตลาด) ไม่มีมิเตอร์น้ำ
  for r in
    select c.stall_id, p.idx, p.period, p.pe, (s.unit_type = 'room') as room,
           c.tenant_id in (v_t[2], v_t[6]) as no_water
    from public.contracts c
    join public.stalls s on s.stall_id = c.stall_id
    cross join (values (1, v_p1, v_p1s, v_p1e), (2, v_p2, v_p2s, v_p2e)) as p (idx, period, ps, pe)
    where c.contract_id = any (v_c) and c.status in ('active', 'expired')
      and c.start_date <= p.pe and c.end_date >= p.ps
    order by p.idx, c.stall_id
  loop
    -- ไฟฟ้า
    insert into public.utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading, reading_date, created_by)
    select r.stall_id, 'electricity', r.period, b + u1 * (r.idx - 1), b + u1 * (r.idx - 1) + case when r.idx = 1 then u1 else u2 end, r.pe, v_admin
    from (select 1200 + (r.stall_id * 389) % 6000 as b,
                 case when r.room then 80 + (r.stall_id * 37 + 53) % 120 else 15 + (r.stall_id * 37 + 53) % 60 end as u1,
                 case when r.room then 80 + (r.stall_id * 37 + 106) % 120 else 15 + (r.stall_id * 37 + 106) % 60 end as u2) x;
    -- น้ำ
    if not r.no_water then
      insert into public.utility_readings (stall_id, utility_type, billing_period, previous_reading, current_reading, reading_date, created_by)
      select r.stall_id, 'water', r.period, b + u1 * (r.idx - 1), b + u1 * (r.idx - 1) + case when r.idx = 1 then u1 else u2 end, r.pe, v_admin
      from (select 80 + (r.stall_id * 61) % 500 as b,
                   2 + (r.stall_id * 13 + 7) % 9 as u1,
                   2 + (r.stall_id * 13 + 14) % 9 as u2) x;
    end if;
  end loop;

  -- ---------- ใบแจ้งหนี้ (ออกเฉพาะสัญญาจำลอง) ----------
  -- รอบเก่า: ครบกำหนดวันที่ 5 ของเดือนถัดไป · รอบล่าสุด: ออกเมื่อไม่กี่วันก่อน ครบกำหนดอีก 7 วัน
  v_n1 := public.generate_invoices(v_p1, v_p1e + 5, v_c);
  v_n2 := public.generate_invoices(v_p2, v_today + 7, v_c);
  update public.invoices i
  set created_by = v_admin,
      created_at = case when i.billing_period = v_p1 then (v_p1e + 1)::timestamp + time '09:00'
                        else greatest(v_p2e + 1, v_today - 3)::timestamp + time '09:00' end at time zone 'Asia/Bangkok'
  where i.contract_id = any (v_c);

  -- ผู้เช่าที่ 8: ใบรอบล่าสุดจดไฟผิด → ยกเลิก แก้เลขมิเตอร์ แล้วออกใบใหม่
  update public.invoices set status = 'cancelled'
  where contract_id = v_c[8] and billing_period = v_p2 and status = 'unpaid';
  update public.utility_readings set current_reading = current_reading + 15
  where stall_id = (select stall_id from public.contracts where contract_id = v_c[8])
    and billing_period = v_p2 and utility_type = 'electricity';
  perform public.generate_invoices(v_p2, v_today + 7, array[v_c[8]]);
  update public.invoices set created_by = v_admin,
         created_at = (greatest(v_p2e + 1, v_today - 1)::timestamp + time '14:30') at time zone 'Asia/Bangkok'
  where contract_id = v_c[8] and billing_period = v_p2 and status = 'unpaid';

  -- ---------- การชำระเงิน ----------
  --  (ตั้งแต่ migration 007 ระบบออกใบเสร็จและปรับใบแจ้งหนี้เป็น "ชำระแล้ว" ให้เองเมื่อการชำระตรวจผ่าน)
  --  รอบเก่า: ชำระแล้วทุกใบ ยกเว้นผู้เช่าที่ 3 (ค้างทั้งใบ) และ 11 (จ่ายเงินสดมาครึ่งหนึ่ง) → เกินกำหนด
  --  รอบล่าสุด: ชำระแล้ว 1, 4, 10, 13 · แจ้งโอนรอตรวจสลิป 5, 7 · ผู้เช่าที่ 6 ใบเสร็จถูกยกเลิก (ตรวจผิด) · ที่เหลือรอชำระ
  v_k := 0;
  for v_inv in
    select i.invoice_id, i.billing_period, i.total_amount, array_position(v_c, i.contract_id) as n
    from public.invoices i
    where i.contract_id = any (v_c) and i.status = 'unpaid'
      and ((i.billing_period = v_p1 and array_position(v_c, i.contract_id) <> 3)
        or (i.billing_period = v_p2 and array_position(v_c, i.contract_id) in (1, 4, 5, 6, 7, 10, 13)))
    order by i.billing_period, i.invoice_no
  loop
    v_k := v_k + 1;
    if v_inv.billing_period = v_p2 and v_inv.n in (5, 7) then
      -- แจ้งโอนผ่าน LINE รอเจ้าหน้าที่ตรวจ (ไม่มีรูปสลิปจริง)
      insert into public.payments (invoice_id, payment_date, amount, payment_method, transaction_ref, status, note)
      values (v_inv.invoice_id, v_today, v_inv.total_amount, case when v_inv.n = 5 then 'promptpay' else 'transfer' end,
              'DEMO' || lpad(v_inv.invoice_id::text, 6, '0'), 'pending', 'แจ้งชำระผ่าน LINE (ข้อมูลจำลอง ไม่มีรูปสลิป)');
      continue;
    end if;
    insert into public.payments (invoice_id, payment_date, amount, payment_method, transaction_ref, status, verified_by, verified_at)
    select v_inv.invoice_id, d,
           case when v_inv.n = 11 then floor(v_inv.total_amount / 20) * 10 else v_inv.total_amount end,  -- ผู้เช่าที่ 11 จ่ายครึ่งหนึ่ง
           m, case when m = 'cash' then null else 'DEMO' || lpad(v_inv.invoice_id::text, 6, '0') end,
           'verified', v_admin, (d::timestamp + time '10:30') at time zone 'Asia/Bangkok'
    from (select least(v_today, case when v_inv.billing_period = v_p1 then v_p1e + 1 + v_k % 5
                                     else greatest(v_p2e + 1, v_today - 1 - v_k % 3) end) as d,
                 case when v_inv.n = 11 then 'cash' else (array['cash', 'transfer', 'promptpay'])[1 + v_k % 3] end as m) x
    returning payment_id into v_pay;
    if v_inv.billing_period = v_p2 and v_inv.n = 6 then
      -- ตัวอย่างการยกเลิกใบเสร็จ: ตรวจผ่านไปแล้วพบว่าโอนเข้าบัญชีอื่น
      perform public.void_payment(v_pay, 'ตรวจพบภายหลังว่าโอนเข้าบัญชีอื่น ให้ผู้เช่าโอนใหม่');
    end if;
  end loop;

  raise notice 'สร้างข้อมูลจำลองแล้ว: ผู้เช่า 20 ราย · ใบแจ้งหนี้รอบ % = % ใบ, รอบ % = % ใบ (+ ออกใหม่แทนใบที่ยกเลิก 1 ใบ)', v_p1, v_n1, v_p2, v_n2;
end
$demo$;

-- ตรวจผล: จำนวนข้อมูลจำลองแต่ละตาราง
select 'ผู้เช่า' as รายการ, count(*) as จำนวน from public.tenants where id_card like '00990000%'
union all
select 'สัญญา', count(*) from public.contracts c join public.tenants t using (tenant_id) where t.id_card like '00990000%'
union all
select 'มิเตอร์', count(distinct u.reading_id) from public.utility_readings u
  join public.contracts c on c.stall_id = u.stall_id join public.tenants t using (tenant_id) where t.id_card like '00990000%'
union all
select 'ใบแจ้งหนี้', count(*) from public.invoices i join public.contracts c using (contract_id) join public.tenants t using (tenant_id) where t.id_card like '00990000%'
union all
select 'การชำระเงิน', count(*) from public.payments p join public.invoices i using (invoice_id) join public.contracts c using (contract_id) join public.tenants t using (tenant_id) where t.id_card like '00990000%';
