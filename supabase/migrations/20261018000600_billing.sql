-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 006 : จดมิเตอร์น้ำ-ไฟ และออกใบแจ้งหนี้ (ขั้นที่ 6)
--
--  ไม่เพิ่ม/ลบตารางหรือคอลัมน์ — มีแต่ฟังก์ชันและ trigger
--   1) ตัวช่วยรอบบิล + อัตราค่าน้ำ-ไฟ ณ วันสุดท้ายของรอบบิล
--   2) มิเตอร์: เติมอัตราให้อัตโนมัติ, ล็อกมิเตอร์ที่อยู่ในใบแจ้งหนี้แล้ว
--   3) ใบแจ้งหนี้: ลำดับสถานะ, ยกเลิกแล้วปลดล็อกมิเตอร์
--   4) meter_sheet()      ข้อมูลหน้าจดมิเตอร์
--      preview_invoices() ตรวจยอดก่อนออก
--      generate_invoices() ออกใบแจ้งหนี้ทั้งรอบในคำสั่งเดียว
--
--  กติกาคิดเงิน (ผู้ใช้เลือกแล้ว)
--   - สัญญาที่ต้องออกบิล = สถานะใช้งาน/สิ้นสุด และมีวันใดวันหนึ่งอยู่ในเดือนของรอบบิล
--   - ค่าเช่ารายเดือน: คิดเต็มเดือน (แม้เริ่ม/สิ้นสุดกลางเดือน)
--   - ค่าเช่ารายปี: เก็บทั้งก้อนในเดือนแรกของแต่ละปีสัญญา (เดือนที่เริ่มสัญญา และทุก 12 เดือนถัดไป)
--   - ค่าน้ำ/ไฟ = หน่วยที่ใช้ × อัตรา ณ วันสุดท้ายของรอบบิล · แผงที่ไม่ได้จด = 0 (หน้าตรวจจะเตือน)
--     ถ้าเดือนเดียวมีสองสัญญาบนแผงเดียวกัน ค่าน้ำ-ไฟไปอยู่กับสัญญาที่เริ่มทีหลัง
--   - ค่าธรรมเนียมของตลาด: รายเดือน = ทุกใบ · รายปี = พร้อมเดือนแรกของปีสัญญา · ครั้งเดียว = ใบแรกของสัญญา
--   - ใบที่ยอดรวมเป็น 0 ไม่ออก
--
--  รันซ้ำได้ · รันต่อจาก migration 001–005
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) ตัวช่วยรอบบิลและอัตรา
-- ---------------------------------------------------------------------
create or replace function private.period_start(p_period text)
returns date language plpgsql immutable set search_path = '' as $$
begin
  if p_period is null or p_period !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'รอบบิลต้องอยู่ในรูปแบบ ปปปป-ดด (ค.ศ.) เช่น 2026-10 (ได้รับ: %)', p_period;
  end if;
  if left(p_period, 4)::int > 2400 then
    raise exception 'รอบบิลต้องใช้ปี ค.ศ. ไม่ใช่ พ.ศ. (ได้รับ: %)', p_period;
  end if;
  return to_date(p_period || '-01', 'YYYY-MM-DD');
end $$;

create or replace function private.period_end(p_period text)
returns date language sql immutable set search_path = '' as $$
  select (private.period_start(p_period) + interval '1 month' - interval '1 day')::date
$$;

-- จำนวนเดือนจากเดือนที่เริ่มสัญญาถึงรอบบิล (0 = เดือนแรกของสัญญา, 12 = เดือนแรกของปีที่สอง)
create or replace function private.months_since(p_start date, p_period text)
returns int language sql immutable set search_path = '' as $$
  select (extract(year from private.period_start(p_period))::int * 12 + extract(month from private.period_start(p_period))::int)
       - (extract(year from p_start)::int * 12 + extract(month from p_start)::int)
$$;

-- อัตราค่าน้ำ/ไฟของตลาดที่มีผล ณ วันที่กำหนด
create or replace function private.rate_at(p_market_id int, p_utility_type text, p_date date)
returns numeric language sql stable set search_path = '' as $$
  select r.rate_per_unit from public.utility_rates r
  where r.market_id = p_market_id and r.utility_type = p_utility_type and r.status = 'active'
    and r.effective_from <= p_date and (r.effective_to is null or r.effective_to >= p_date)
  order by r.effective_from desc
  limit 1
$$;


-- ---------------------------------------------------------------------
-- 2) มิเตอร์
-- ---------------------------------------------------------------------

-- ไม่ส่งอัตรามา → ใช้อัตราของตลาด ณ วันสุดท้ายของรอบบิล (หน้าเว็บไม่ต้องคำนวณเอง)
create or replace function private.readings_fill_rate()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_market int;
begin
  if new.rate_per_unit is null then
    select z.market_id into v_market
    from public.stalls s join public.zones z on z.zone_id = s.zone_id
    where s.stall_id = new.stall_id;
    new.rate_per_unit := private.rate_at(v_market, new.utility_type, private.period_end(new.billing_period));
    if new.rate_per_unit is null then
      raise exception 'ยังไม่ได้ตั้งอัตราค่า% ของตลาดนี้สำหรับรอบ % — ตั้งได้ที่หน้า "ตลาดและอัตราค่าบริการ"',
        case new.utility_type when 'water' then 'น้ำ' else 'ไฟ' end, new.billing_period;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists utility_readings_10_fill_rate on public.utility_readings;
create trigger utility_readings_10_fill_rate
  before insert on public.utility_readings
  for each row execute function private.readings_fill_rate();

-- มิเตอร์ที่อยู่ในใบแจ้งหนี้แล้ว แก้/ลบผ่านเว็บไม่ได้ (ยกเลิกใบแจ้งหนี้ก่อน มิเตอร์จะปลดล็อก)
create or replace function private.readings_guard_invoiced()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_no text;
begin
  if current_user = 'authenticated' and old.invoice_id is not null then
    select i.invoice_no into v_no from public.invoices i where i.invoice_id = old.invoice_id;
    raise exception 'มิเตอร์นี้อยู่ในใบแจ้งหนี้ % แล้ว แก้ไขไม่ได้ (ยกเลิกใบแจ้งหนี้ก่อน)', v_no
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists utility_readings_20_guard_invoiced on public.utility_readings;
create trigger utility_readings_20_guard_invoiced
  before update or delete on public.utility_readings
  for each row execute function private.readings_guard_invoiced();


-- ---------------------------------------------------------------------
-- 3) ใบแจ้งหนี้: ลำดับสถานะ + ยกเลิกแล้วปลดล็อกมิเตอร์
--    รอชำระ → ชำระแล้ว / ยกเลิก · ชำระแล้ว → รอชำระ (กรณีตรวจเงินผิด) · ยกเลิก = จบ
-- ---------------------------------------------------------------------
create or replace function private.invoices_guard_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    if old.status = 'cancelled' then
      raise exception 'ใบแจ้งหนี้ที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้ (ให้ออกใบใหม่แทน)';
    elsif old.status = 'paid' and new.status = 'cancelled' then
      raise exception 'ใบแจ้งหนี้ที่ชำระแล้วยกเลิกไม่ได้';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists invoices_10_guard_status on public.invoices;
create trigger invoices_10_guard_status
  before update on public.invoices
  for each row execute function private.invoices_guard_status();

-- security definer: ปลดล็อกมิเตอร์ได้แม้ผู้ยกเลิกเป็นเจ้าหน้าที่ (ข้าม trigger ล็อกข้างบน)
create or replace function private.invoices_release_readings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.utility_readings set invoice_id = null where invoice_id = new.invoice_id;
  end if;
  return null;
end $$;

drop trigger if exists invoices_90_release_readings on public.invoices;
create trigger invoices_90_release_readings
  after update of status on public.invoices
  for each row execute function private.invoices_release_readings();


-- ---------------------------------------------------------------------
-- 4) ฟังก์ชันที่หน้าเว็บเรียก (สิทธิ์ตาม RLS ของผู้เรียก)
-- ---------------------------------------------------------------------

-- ข้อมูลหน้าจดมิเตอร์: แผงที่มีสัญญาในรอบบิล + เลขที่จดแล้ว + เลขครั้งก่อนที่แนะนำ + อัตรา
-- supabase.rpc('meter_sheet', { p_period: '2026-10', p_market_id: 2 })
create or replace function public.meter_sheet(p_period text, p_market_id int default null)
returns table (
  stall_id int, stall_code text, unit_type text, zone_name text, market_id int, market_name text,
  contract_id int, contract_no text, tenant_name text, business_name text,
  electricity_reading_id int, electricity_previous numeric, electricity_current numeric,
  electricity_suggested numeric, electricity_rate numeric, electricity_invoice_no text,
  water_reading_id int, water_previous numeric, water_current numeric,
  water_suggested numeric, water_rate numeric, water_invoice_no text
)
language sql stable set search_path = '' as $$
  with b as (select private.period_start(p_period) as ps, private.period_end(p_period) as pe),
  c as (
    select distinct on (ct.stall_id) ct.stall_id, ct.contract_id, ct.contract_no, ct.tenant_id
    from public.contracts ct, b
    where ct.status in ('active', 'expired') and ct.start_date <= b.pe and ct.end_date >= b.ps
    order by ct.stall_id, ct.start_date desc
  )
  select
    s.stall_id, s.stall_code::text, s.unit_type::text, z.zone_name::text, m.market_id, m.market_name::text,
    c.contract_id, c.contract_no::text, t.full_name::text, t.business_name::text,
    re.reading_id, re.previous_reading, re.current_reading,
    (select r.current_reading from public.utility_readings r
      where r.stall_id = s.stall_id and r.utility_type = 'electricity' and r.billing_period < p_period
      order by r.billing_period desc limit 1),
    coalesce(re.rate_per_unit, private.rate_at(m.market_id, 'electricity', b.pe)),
    ie.invoice_no::text,
    rw.reading_id, rw.previous_reading, rw.current_reading,
    (select r.current_reading from public.utility_readings r
      where r.stall_id = s.stall_id and r.utility_type = 'water' and r.billing_period < p_period
      order by r.billing_period desc limit 1),
    coalesce(rw.rate_per_unit, private.rate_at(m.market_id, 'water', b.pe)),
    iw.invoice_no::text
  from c
  cross join b
  join public.stalls s on s.stall_id = c.stall_id
  join public.zones z on z.zone_id = s.zone_id
  join public.markets m on m.market_id = z.market_id
  join public.tenants t on t.tenant_id = c.tenant_id
  left join public.utility_readings re on re.stall_id = s.stall_id and re.utility_type = 'electricity' and re.billing_period = p_period
  left join public.invoices ie on ie.invoice_id = re.invoice_id
  left join public.utility_readings rw on rw.stall_id = s.stall_id and rw.utility_type = 'water' and rw.billing_period = p_period
  left join public.invoices iw on iw.invoice_id = rw.invoice_id
  where p_market_id is null or m.market_id = p_market_id
  order by m.market_id, z.zone_name, s.stall_code
$$;

comment on function public.meter_sheet(text, int) is
  'ข้อมูลหน้าจดมิเตอร์ของรอบบิล: แผงที่มีสัญญา, เลขที่จดแล้ว, เลขครั้งก่อนที่แนะนำ, อัตรา ณ วันสุดท้ายของรอบ';

-- ตรวจยอดก่อนออกใบแจ้งหนี้ (ไม่บันทึกอะไร)
-- supabase.rpc('preview_invoices', { p_period: '2026-10' })
create or replace function public.preview_invoices(p_period text)
returns table (
  contract_id int, contract_no text, tenant_name text, business_name text,
  stall_id int, stall_code text, unit_type text, market_id int, market_name text, zone_name text,
  rent_period text, rent_amount numeric, water_amount numeric, electricity_amount numeric,
  fee_amount numeric, total_amount numeric,
  has_water boolean, has_electricity boolean, gets_utility boolean, invoice_id int, invoice_no text
)
language sql stable set search_path = '' as $$
  with b as (select private.period_start(p_period) as ps, private.period_end(p_period) as pe),
  c as (
    select ct.*,
      row_number() over (partition by ct.stall_id order by ct.start_date desc, ct.contract_id desc) = 1 as gets_utility,
      private.months_since(ct.start_date, p_period) as k
    from public.contracts ct, b
    where ct.status in ('active', 'expired') and ct.start_date <= b.pe and ct.end_date >= b.ps
  ),
  x as (
    select
      c.contract_id, c.contract_no::text, t.full_name::text as tenant_name, t.business_name::text,
      s.stall_id, s.stall_code::text, s.unit_type::text, m.market_id, m.market_name::text, z.zone_name::text,
      c.rent_period::text,
      case when c.rent_period = 'monthly' or c.k % 12 = 0 then c.rent_amount else 0 end as rent_amount,
      case when c.gets_utility then coalesce(round(rw.unit_used * rw.rate_per_unit, 2), 0) else 0 end as water_amount,
      case when c.gets_utility then coalesce(round(re.unit_used * re.rate_per_unit, 2), 0) else 0 end as electricity_amount,
      coalesce((
        select sum(f.fee_amount) from public.fees f
        where f.market_id = m.market_id and f.status = 'active'
          and (coalesce(f.fee_period, 'monthly') = 'monthly'
               or (f.fee_period = 'yearly' and c.k % 12 = 0)
               or (f.fee_period = 'once' and c.k = 0))
      ), 0) as fee_amount,
      c.gets_utility and rw.reading_id is not null as has_water,
      c.gets_utility and re.reading_id is not null as has_electricity,
      c.gets_utility,
      inv.invoice_id, inv.invoice_no::text
    from c
    join public.tenants t on t.tenant_id = c.tenant_id
    join public.stalls s on s.stall_id = c.stall_id
    join public.zones z on z.zone_id = s.zone_id
    join public.markets m on m.market_id = z.market_id
    left join public.utility_readings rw on rw.stall_id = c.stall_id and rw.utility_type = 'water' and rw.billing_period = p_period
    left join public.utility_readings re on re.stall_id = c.stall_id and re.utility_type = 'electricity' and re.billing_period = p_period
    left join public.invoices inv on inv.contract_id = c.contract_id and inv.billing_period = p_period and inv.status <> 'cancelled'
  )
  select x.contract_id, x.contract_no, x.tenant_name, x.business_name,
         x.stall_id, x.stall_code, x.unit_type, x.market_id, x.market_name, x.zone_name,
         x.rent_period, x.rent_amount, x.water_amount, x.electricity_amount, x.fee_amount,
         x.rent_amount + x.water_amount + x.electricity_amount + x.fee_amount,
         x.has_water, x.has_electricity, x.gets_utility, x.invoice_id, x.invoice_no
  from x
  order by x.market_id, x.zone_name, x.stall_code, x.contract_id
$$;

comment on function public.preview_invoices(text) is
  'คำนวณยอดใบแจ้งหนี้ของรอบบิลทุกสัญญา (ไม่บันทึก) — invoice_id ไม่ว่าง = ออกไปแล้ว';

-- ออกใบแจ้งหนี้ทั้งรอบ (เฉพาะที่ยังไม่ออกและยอด > 0) แล้วผูกมิเตอร์กับใบแจ้งหนี้
-- supabase.rpc('generate_invoices', { p_period: '2026-10', p_due_date: '2026-11-05' })  คืนจำนวนใบที่ออก
create or replace function public.generate_invoices(p_period text, p_due_date date, p_contract_ids int[] default null)
returns int
language plpgsql set search_path = '' as $$
declare
  r     record;
  v_id  int;
  v_n   int := 0;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    raise exception 'เฉพาะเจ้าหน้าที่เท่านั้นที่ออกใบแจ้งหนี้ได้' using errcode = '42501';
  end if;
  if p_due_date is null then
    raise exception 'กรุณาระบุวันครบกำหนดชำระ';
  end if;
  if p_due_date < private.period_start(p_period) then
    raise exception 'วันครบกำหนดต้องไม่ก่อนวันแรกของรอบบิล (%)', private.period_start(p_period);
  end if;

  for r in
    select * from public.preview_invoices(p_period) p
    where p.invoice_id is null and p.total_amount > 0
      and (p_contract_ids is null or p.contract_id = any (p_contract_ids))
  loop
    insert into public.invoices (contract_id, billing_period, rent_amount, water_amount, electricity_amount, fee_amount, due_date)
    values (r.contract_id, p_period, r.rent_amount, r.water_amount, r.electricity_amount, r.fee_amount, p_due_date)
    returning invoice_id into v_id;

    update public.utility_readings u
    set invoice_id = v_id
    where u.stall_id = r.stall_id and u.billing_period = p_period and u.invoice_id is null
      and ((u.utility_type = 'water' and r.has_water) or (u.utility_type = 'electricity' and r.has_electricity));

    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

comment on function public.generate_invoices(text, date, int[]) is
  'ออกใบแจ้งหนี้ของรอบบิล (เฉพาะสัญญาที่ยังไม่มีใบและยอด > 0) แล้วผูกมิเตอร์ — คืนจำนวนใบที่ออก (เฉพาะ admin/staff)';


-- ---------------------------------------------------------------------
-- 5) สิทธิ์เรียกฟังก์ชัน
-- ---------------------------------------------------------------------
revoke execute on function private.period_start(text), private.period_end(text),
  private.months_since(date, text), private.rate_at(int, text, date),
  private.readings_fill_rate(), private.readings_guard_invoiced(),
  private.invoices_guard_status(), private.invoices_release_readings() from public;
grant execute on function private.period_start(text), private.period_end(text),
  private.months_since(date, text), private.rate_at(int, text, date)
  to authenticated, service_role;

revoke execute on function public.meter_sheet(text, int), public.preview_invoices(text),
  public.generate_invoices(text, date, int[]) from public, anon;
grant execute on function public.meter_sheet(text, int), public.preview_invoices(text),
  public.generate_invoices(text, date, int[]) to authenticated, service_role;
