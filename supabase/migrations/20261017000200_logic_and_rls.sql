-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 002 : Logic ในฐานข้อมูล + สิทธิ์การเข้าถึง (RLS)
--
--  รันต่อจาก migration 001 และ seed.sql (ไม่เพิ่ม/ลบตารางหรือคอลัมน์)
--
--  ส่วนประกอบ
--    0) schema private สำหรับฟังก์ชันภายใน (ไม่เปิดผ่าน API)
--    1) ฟังก์ชันช่วย: วันที่ไทย, ปี พ.ศ., บทบาทผู้ใช้, ผู้เช่าที่ login อยู่
--    2) ออกเลขอัตโนมัติ: เลขแผง, เลขสัญญา, เลขใบแจ้งหนี้, เลขใบเสร็จ
--    3) ค่าเริ่มต้นของคอลัมน์ (ผู้สร้าง, วันที่ตามเวลาไทย)
--    4) สัญญา: ค่าเริ่มต้นคำขอเช่า, ตรวจแผงว่าง, ลำดับสถานะ, สถานะแผงตามสัญญา
--    5) แผง: สถานะ เช่า/จอง เปลี่ยนได้จากสัญญาเท่านั้น
--    6) ผู้เช่า: ป้องกันเลขบัตรประชาชน (หมายเหตุข้อ 3)
--    7) การชำระเงิน: ผู้เช่าแจ้งชำระได้เฉพาะบิลที่รอชำระ, เติมผู้ตรวจอัตโนมัติ
--    8) RLS policy ตามตารางสิทธิ์
--
--  หลักการตรวจว่าใครเป็นคนสั่ง
--    current_user = 'authenticated'  → ผู้ใช้ที่ login ผ่านเว็บ/LIFF (ถูกจำกัดสิทธิ์)
--    current_user = 'postgres' / 'service_role' → SQL Editor หรือ Edge Function (เชื่อถือได้)
-- =====================================================================


-- =====================================================================
-- 0) schema private
-- =====================================================================
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;


-- =====================================================================
-- 1) ฟังก์ชันช่วย
-- =====================================================================

-- วันที่ปัจจุบันตามเวลาประเทศไทย (ฐานข้อมูล Supabase ใช้เวลา UTC)
create or replace function private.today_th()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

-- ปี พ.ศ. ของวันที่
create or replace function private.be_year(p_date date)
returns int language sql immutable set search_path = '' as $$
  select extract(year from p_date)::int + 543
$$;

-- บทบาทของผู้ใช้ที่ login อยู่ (admin/staff/manager) — NULL ถ้าไม่ใช่เจ้าหน้าที่หรือถูกระงับ
create or replace function private.current_user_role()
returns text language sql stable security definer set search_path = '' as $$
  select u.role from public.users u
  where u.user_id = auth.uid() and u.status = 'active'
$$;

create or replace function private.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.current_user_role() = 'admin', false)
$$;

-- admin หรือ staff (ผู้ปฏิบัติงาน)
create or replace function private.is_staff()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(private.current_user_role() in ('admin', 'staff'), false)
$$;

-- เจ้าหน้าที่ทุกบทบาท รวม manager (ดูข้อมูลได้ทั้งหมด)
create or replace function private.is_officer()
returns boolean language sql stable set search_path = '' as $$
  select private.current_user_role() is not null
$$;

-- รหัสผู้เช่าของบัญชีที่ login อยู่ — NULL ถ้าไม่ใช่ผู้เช่าหรือถูกระงับ
create or replace function private.current_tenant_id()
returns int language sql stable security definer set search_path = '' as $$
  select t.tenant_id from public.tenants t
  where t.auth_id = auth.uid() and t.status = 'active'
$$;

-- ผู้ใช้งานระบบที่ยังใช้งานอยู่ (เจ้าหน้าที่ หรือ ผู้เช่า)
create or replace function private.is_app_user()
returns boolean language sql stable set search_path = '' as $$
  select private.is_officer() or private.current_tenant_id() is not null
$$;

-- รายการเอกสารของผู้เช่าที่ login อยู่ (ใช้ใน RLS; security definer เพื่อไม่ให้ policy วนซ้อนกัน)
create or replace function private.my_contract_ids()
returns setof int language sql stable security definer set search_path = '' as $$
  select c.contract_id
  from public.contracts c
  where c.tenant_id = private.current_tenant_id()
$$;

create or replace function private.my_invoice_ids()
returns setof int language sql stable security definer set search_path = '' as $$
  select i.invoice_id
  from public.invoices i
  join public.contracts c on c.contract_id = i.contract_id
  where c.tenant_id = private.current_tenant_id()
$$;

create or replace function private.my_payment_ids()
returns setof int language sql stable security definer set search_path = '' as $$
  select p.payment_id
  from public.payments p
  join public.invoices  i on i.invoice_id  = p.invoice_id
  join public.contracts c on c.contract_id = i.contract_id
  where c.tenant_id = private.current_tenant_id()
$$;

-- ป้ายภาษาไทยสำหรับข้อความแจ้งเตือน
create or replace function private.stall_status_th(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case p_status
    when 'vacant' then 'ว่าง' when 'reserved' then 'จอง'
    when 'rented' then 'เช่า' when 'maintenance' then 'ซ่อมบำรุง'
    else p_status end
$$;

create or replace function private.contract_status_th(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case p_status
    when 'pending' then 'รออนุมัติ' when 'active' then 'ใช้งาน'
    when 'expired' then 'สิ้นสุด' when 'cancelled' then 'ยกเลิก'
    when 'rejected' then 'ไม่อนุมัติ'
    else p_status end
$$;


-- =====================================================================
-- 2) ออกเลขอัตโนมัติ
--    ล็อกด้วย advisory lock ระหว่างออกเลข → กดพร้อมกันหลายคนก็ไม่ได้เลขซ้ำ
--    ถ้าส่งเลขมาเอง (เช่น นำเข้าข้อมูลเก่า) ระบบจะใช้เลขที่ส่งมา
-- =====================================================================

-- เลขถัดไปของ prefix ที่กำหนด เช่น 'CT-2569-' → 'CT-2569-0001'
create or replace function private.next_running_no(
  p_table text, p_column text, p_prefix text, p_digits int
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_max int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_table || '.' || p_column || ':' || p_prefix, 0));
  execute format(
    'select max(substring(%1$I from ''([0-9]+)$'')::int) from public.%2$I where %1$I like %3$L',
    p_column, p_table, p_prefix || '%'
  ) into v_max;
  return p_prefix || lpad((coalesce(v_max, 0) + 1)::text, p_digits, '0');
end $$;

-- สัญญา: CT-<ปี พ.ศ.>-0001 (นับใหม่ทุกปี)
create or replace function private.assign_contract_no()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.contract_no, '') = '' then
    new.contract_no := private.next_running_no(
      'contracts', 'contract_no',
      'CT-' || private.be_year(private.today_th()) || '-', 4);
  end if;
  return new;
end $$;

-- ใบแจ้งหนี้: INV-<ปี พ.ศ.><เดือนของรอบบิล>-0001 (นับใหม่ทุกรอบบิล)
create or replace function private.assign_invoice_no()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.invoice_no, '') = '' then
    new.invoice_no := private.next_running_no(
      'invoices', 'invoice_no',
      'INV-' || (left(new.billing_period, 4)::int + 543) || right(new.billing_period, 2) || '-', 4);
  end if;
  return new;
end $$;

-- ใบเสร็จ: RC-<ปี พ.ศ.><เดือนที่ออก>-0001 (นับใหม่ทุกเดือน)
create or replace function private.assign_receipt_no()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date date := coalesce(new.receipt_date, private.today_th());
begin
  if coalesce(new.receipt_no, '') = '' then
    new.receipt_no := private.next_running_no(
      'receipts', 'receipt_no',
      'RC-' || private.be_year(v_date) || to_char(v_date, 'MM') || '-', 4);
  end if;
  return new;
end $$;

-- แผง: <ชื่อโซน><เลข 3 หลักถัดไปในโซน> เช่น A011
create or replace function private.assign_stall_code()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_zone text;
  v_max  int;
begin
  if coalesce(new.stall_code, '') <> '' then
    return new;
  end if;
  select z.zone_name into v_zone from public.zones z where z.zone_id = new.zone_id;
  if v_zone is null then
    raise exception 'ไม่พบโซนรหัส %', new.zone_id;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('stalls.stall_code:' || new.zone_id, 0));
  select max(substring(s.stall_code from '([0-9]+)$')::int) into v_max
  from public.stalls s where s.zone_id = new.zone_id;
  new.stall_code := v_zone || lpad((coalesce(v_max, 0) + 1)::text, 3, '0');
  return new;
end $$;

-- ห้ามแก้เลขเอกสารหลังออกแล้ว (ผ่านเว็บ) — tg_argv[0] = ชื่อคอลัมน์เลขเอกสาร
create or replace function private.protect_document_no()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and to_jsonb(new) ->> tg_argv[0] is distinct from to_jsonb(old) ->> tg_argv[0] then
    raise exception 'แก้ไขเลขที่เอกสารที่ออกแล้วไม่ได้' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger stalls_10_assign_code
  before insert on public.stalls
  for each row execute function private.assign_stall_code();

create trigger contracts_30_assign_no
  before insert on public.contracts
  for each row execute function private.assign_contract_no();
create trigger contracts_05_protect_no
  before update on public.contracts
  for each row execute function private.protect_document_no('contract_no');

create trigger invoices_30_assign_no
  before insert on public.invoices
  for each row execute function private.assign_invoice_no();
create trigger invoices_05_protect_no
  before update on public.invoices
  for each row execute function private.protect_document_no('invoice_no');

create trigger receipts_30_assign_no
  before insert on public.receipts
  for each row execute function private.assign_receipt_no();
create trigger receipts_05_protect_no
  before update on public.receipts
  for each row execute function private.protect_document_no('receipt_no');


-- =====================================================================
-- 3) ค่าเริ่มต้นของคอลัมน์
-- =====================================================================
alter table public.invoices         alter column created_by   set default auth.uid();
alter table public.utility_readings alter column created_by   set default auth.uid();
alter table public.receipts         alter column issued_by    set default auth.uid();
alter table public.payments         alter column payment_date set default private.today_th();
alter table public.receipts         alter column receipt_date set default private.today_th();
alter table public.utility_readings alter column reading_date set default private.today_th();


-- =====================================================================
-- 4) สัญญาเช่า
-- =====================================================================

-- แผงหนึ่งมีคำขอเช่าที่รออนุมัติได้ครั้งละ 1 รายการ
create unique index contracts_one_pending_per_stall
  on public.contracts (stall_id) where status = 'pending';

-- ก่อนบันทึกสัญญาใหม่: ตั้งค่าเริ่มต้น + ตรวจว่าแผงว่าง
create or replace function private.contracts_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_stall record;
  v_prev  record;
begin
  select s.status, s.base_rent, s.rent_period into v_stall
  from public.stalls s where s.stall_id = new.stall_id;
  if not found then
    raise exception 'ไม่พบแผงรหัส %', new.stall_id;
  end if;

  if current_user = 'authenticated' and not private.is_staff() then
    -- ผู้เช่าส่งคำขอเช่าผ่าน LIFF: ระบบกำหนดค่าให้ทั้งหมด ผู้เช่าเลือกได้แค่แผงและวันที่
    new.tenant_id       := private.current_tenant_id();
    new.status          := 'pending';
    new.rent_amount     := coalesce(v_stall.base_rent, 0);
    new.rent_period     := v_stall.rent_period;
    new.deposit_amount  := null;
    new.renewed_from_id := null;
    new.created_by      := null;
    if new.tenant_id is null then
      raise exception 'บัญชีนี้ยังไม่ได้ผูกกับข้อมูลผู้เช่า' using errcode = '42501';
    end if;
  else
    -- เจ้าหน้าที่: ไม่ระบุค่าเช่า/รอบ = ใช้ค่าเริ่มต้นของแผง
    new.created_by  := coalesce(new.created_by, auth.uid());
    new.rent_amount := coalesce(new.rent_amount, v_stall.base_rent);
    new.rent_period := coalesce(new.rent_period, v_stall.rent_period);
  end if;

  if new.status in ('pending', 'active') then
    if new.renewed_from_id is not null then
      -- ต่ออายุสัญญา: ต้องเป็นแผงและผู้เช่าเดิม และเริ่มหลังสัญญาเดิมสิ้นสุด
      select c.stall_id, c.tenant_id, c.end_date into v_prev
      from public.contracts c where c.contract_id = new.renewed_from_id;
      if not found or v_prev.stall_id <> new.stall_id or v_prev.tenant_id <> new.tenant_id then
        raise exception 'สัญญาต่ออายุต้องเป็นแผงและผู้เช่าเดียวกับสัญญาเดิม';
      end if;
      if new.start_date <= v_prev.end_date then
        raise exception 'วันเริ่มสัญญาใหม่ต้องอยู่หลังวันสิ้นสุดสัญญาเดิม (%)', v_prev.end_date;
      end if;
    elsif v_stall.status <> 'vacant' then
      raise exception 'แผงนี้ไม่ว่าง (สถานะ: %)', private.stall_status_th(v_stall.status);
    end if;
  end if;

  return new;
end $$;

create trigger contracts_10_before_insert
  before insert on public.contracts
  for each row execute function private.contracts_before_insert();

-- ก่อนแก้ไขสัญญา: ตรวจลำดับสถานะ + จำกัดสิ่งที่ผู้เช่าแก้ได้
--   รออนุมัติ → ใช้งาน / ไม่อนุมัติ / ยกเลิก
--   ใช้งาน    → สิ้นสุด / ยกเลิก
--   สิ้นสุด / ยกเลิก / ไม่อนุมัติ → เปลี่ยนไม่ได้อีก
create or replace function private.contracts_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('active', 'rejected', 'cancelled'))
    or (old.status = 'active'  and new.status in ('expired', 'cancelled'))
  ) then
    raise exception 'เปลี่ยนสถานะสัญญาจาก "%" เป็น "%" ไม่ได้',
      private.contract_status_th(old.status), private.contract_status_th(new.status);
  end if;

  if current_user = 'authenticated' and not private.is_staff() then
    if new.status <> 'cancelled'
       or (to_jsonb(new) - 'status') <> (to_jsonb(old) - 'status') then
      raise exception 'ผู้เช่ายกเลิกคำขอเช่าที่รออนุมัติได้อย่างเดียว' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;

create trigger contracts_10_before_update
  before update on public.contracts
  for each row execute function private.contracts_before_update();

-- คำนวณสถานะแผงจากสัญญา: มีสัญญาใช้งาน → เช่า, มีคำขอรออนุมัติ → จอง, ไม่มี → ว่าง
-- (แผงที่ตั้งเป็นซ่อมบำรุงไว้ และไม่มีสัญญา จะคงสถานะซ่อมบำรุง)
create or replace function private.refresh_stall_status(p_stall_id int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_status text;
begin
  select case
    when exists (select 1 from public.contracts c
                 where c.stall_id = p_stall_id and c.status = 'active')  then 'rented'
    when exists (select 1 from public.contracts c
                 where c.stall_id = p_stall_id and c.status = 'pending') then 'reserved'
  end into v_status;

  if v_status is not null then
    update public.stalls set status = v_status
    where stall_id = p_stall_id and status is distinct from v_status;
  else
    update public.stalls set status = 'vacant'
    where stall_id = p_stall_id and status in ('rented', 'reserved');
  end if;
end $$;

create or replace function private.contracts_after_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.refresh_stall_status(old.stall_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.refresh_stall_status(new.stall_id);
  end if;
  return null;
end $$;

create trigger contracts_90_sync_stall
  after insert or update of status, stall_id or delete on public.contracts
  for each row execute function private.contracts_after_change();

-- ปุ่ม "ปิดสัญญาที่หมดอายุ" ให้เจ้าหน้าที่กด: สัญญาใช้งานที่เลยวันสิ้นสุด → สิ้นสุด
-- เรียกจากหน้าเว็บ: supabase.rpc('expire_contracts') คืนค่าจำนวนสัญญาที่ปิด
create or replace function public.expire_contracts()
returns int language plpgsql set search_path = '' as $$
declare
  v_count int;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    raise exception 'เฉพาะเจ้าหน้าที่เท่านั้น' using errcode = '42501';
  end if;
  update public.contracts
  set status = 'expired'
  where status = 'active' and end_date < private.today_th();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.expire_contracts() is
  'ปิดสัญญาที่เลยวันสิ้นสุดแล้ว (เฉพาะ admin/staff) — คืนค่าจำนวนสัญญาที่ปิด';


-- =====================================================================
-- 5) แผง: เจ้าหน้าที่ตั้งได้แค่ ว่าง ↔ ซ่อมบำรุง ส่วน จอง/เช่า มาจากสัญญาเท่านั้น
-- =====================================================================
create or replace function private.stalls_guard_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;  -- ระบบ (trigger สัญญา / SQL Editor) เปลี่ยนได้
  end if;
  if tg_op = 'INSERT' then
    if new.status not in ('vacant', 'maintenance') then
      raise exception 'แผงใหม่ต้องมีสถานะ ว่าง หรือ ซ่อมบำรุง';
    end if;
  elsif new.status is distinct from old.status
        and not (old.status in ('vacant', 'maintenance') and new.status in ('vacant', 'maintenance')) then
    raise exception 'สถานะ "%" เปลี่ยนตามสัญญาเช่าอัตโนมัติ แก้เองไม่ได้',
      private.stall_status_th(case when old.status in ('rented', 'reserved') then old.status else new.status end);
  end if;
  return new;
end $$;

create trigger stalls_20_guard_status
  before insert or update on public.stalls
  for each row execute function private.stalls_guard_status();


-- =====================================================================
-- 6) ผู้เช่า
-- =====================================================================

-- ผู้เช่าแก้ข้อมูลตัวเองได้ ยกเว้นสถานะและการผูกบัญชี LINE
create or replace function private.tenants_guard_self_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_staff()
     and (new.status       is distinct from old.status
       or new.line_user_id is distinct from old.line_user_id
       or new.auth_id      is distinct from old.auth_id) then
    raise exception 'ผู้เช่าแก้ไขสถานะหรือบัญชี LINE เองไม่ได้' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger tenants_10_guard_self_update
  before update on public.tenants
  for each row execute function private.tenants_guard_self_update();

-- ป้องกันเลขบัตรประชาชน (หมายเหตุข้อ 3):
-- ผู้ใช้ผ่าน API อ่านคอลัมน์ id_card ตรง ๆ ไม่ได้เลย (เขียนได้ตามสิทธิ์ RLS)
-- หน้าเว็บต้องระบุคอลัมน์เอง ห้ามใช้ select('*') กับตาราง tenants
-- ** ถ้าเพิ่มคอลัมน์ใหม่ใน tenants ภายหลัง ต้อง grant select คอลัมน์นั้นเพิ่ม **
revoke select on public.tenants from anon, authenticated;
grant select (tenant_id, full_name, phone, address, business_name,
              line_user_id, auth_id, status, created_at)
  on public.tenants to authenticated;

-- ดูเลขบัตรประชาชน: เฉพาะ admin/staff และผู้เช่าคนนั้นเอง
-- เรียกจากหน้าเว็บ: supabase.rpc('get_tenant_id_card', { p_tenant_id: 1 })
create or replace function public.get_tenant_id_card(p_tenant_id int)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  -- coalesce: ผู้ที่ไม่ใช่ผู้เช่า current_tenant_id() = NULL ต้องนับเป็น "ไม่มีสิทธิ์"
  if not (private.is_staff() or coalesce(p_tenant_id = private.current_tenant_id(), false)) then
    raise exception 'ไม่มีสิทธิ์ดูเลขบัตรประชาชน' using errcode = '42501';
  end if;
  return (select t.id_card from public.tenants t where t.tenant_id = p_tenant_id);
end $$;

comment on function public.get_tenant_id_card(int) is
  'คืนเลขบัตรประชาชนของผู้เช่า (เฉพาะ admin/staff หรือผู้เช่าคนนั้นเอง)';


-- =====================================================================
-- 7) การชำระเงิน
-- =====================================================================
create or replace function private.payments_before_write()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_invoice_status text;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    -- ผู้เช่าแจ้งชำระ: สถานะเริ่มต้นเป็นรอตรวจสอบเสมอ และต้องเป็นบิลที่รอชำระ
    new.status      := 'pending';
    new.verified_by := null;
    new.verified_at := null;
    select i.status into v_invoice_status
    from public.invoices i where i.invoice_id = new.invoice_id;
    if not found then
      raise exception 'ไม่พบใบแจ้งหนี้นี้ในบัญชีของคุณ' using errcode = '42501';
    elsif v_invoice_status <> 'unpaid' then
      raise exception 'ใบแจ้งหนี้นี้ไม่อยู่ในสถานะรอชำระ';
    end if;
  else
    -- เจ้าหน้าที่ตรวจ/บันทึกรับเงินสด: เติมผู้ตรวจและเวลาตรวจให้อัตโนมัติ
    if new.status in ('verified', 'rejected') then
      if tg_op = 'INSERT' or old.status = 'pending' then
        new.verified_at := coalesce(new.verified_at, now());
        new.verified_by := coalesce(new.verified_by, auth.uid());
      end if;
    else
      new.verified_at := null;
      new.verified_by := null;
    end if;
  end if;
  return new;
end $$;

create trigger payments_10_before_write
  before insert or update on public.payments
  for each row execute function private.payments_before_write();


-- =====================================================================
-- 8) สิทธิ์ของฟังก์ชัน และ RLS policy
-- =====================================================================

-- ฟังก์ชันภายใน: ให้เฉพาะผู้ที่ login แล้วเรียกได้ (ใช้ใน policy)
revoke execute on all functions in schema private from public;
grant execute on function
  private.today_th(), private.be_year(date),
  private.current_user_role(), private.is_admin(), private.is_staff(),
  private.is_officer(), private.current_tenant_id(), private.is_app_user(),
  private.my_contract_ids(), private.my_invoice_ids(), private.my_payment_ids(),
  private.stall_status_th(text), private.contract_status_th(text)
  to authenticated, service_role;

-- ฟังก์ชันที่หน้าเว็บเรียกได้: เฉพาะผู้ที่ login แล้ว
revoke execute on function public.expire_contracts()        from public, anon;
revoke execute on function public.get_tenant_id_card(int)   from public, anon;
grant  execute on function public.expire_contracts()        to authenticated, service_role;
grant  execute on function public.get_tenant_id_card(int)   to authenticated, service_role;

-- ผู้ที่ยังไม่ login (anon) เข้าถึงตารางไม่ได้เลย
revoke all on all tables in schema public from anon;


-- ---------- users : admin จัดการ, คนอื่นดูของตัวเอง ----------
create policy users_select on public.users for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy users_insert on public.users for insert to authenticated
  with check ((select private.is_admin()));
create policy users_update on public.users for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy users_delete on public.users for delete to authenticated
  using ((select private.is_admin()));

-- ---------- markets / zones / utility_rates / fees : admin จัดการ, ทุกคนที่ login ดูได้ ----------
create policy markets_select on public.markets for select to authenticated
  using ((select private.is_app_user()));
create policy markets_insert on public.markets for insert to authenticated
  with check ((select private.is_admin()));
create policy markets_update on public.markets for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy markets_delete on public.markets for delete to authenticated
  using ((select private.is_admin()));

create policy zones_select on public.zones for select to authenticated
  using ((select private.is_app_user()));
create policy zones_insert on public.zones for insert to authenticated
  with check ((select private.is_admin()));
create policy zones_update on public.zones for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy zones_delete on public.zones for delete to authenticated
  using ((select private.is_admin()));

create policy utility_rates_select on public.utility_rates for select to authenticated
  using ((select private.is_app_user()));
create policy utility_rates_insert on public.utility_rates for insert to authenticated
  with check ((select private.is_admin()));
create policy utility_rates_update on public.utility_rates for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy utility_rates_delete on public.utility_rates for delete to authenticated
  using ((select private.is_admin()));

create policy fees_select on public.fees for select to authenticated
  using ((select private.is_app_user()));
create policy fees_insert on public.fees for insert to authenticated
  with check ((select private.is_admin()));
create policy fees_update on public.fees for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));
create policy fees_delete on public.fees for delete to authenticated
  using ((select private.is_admin()));

-- ---------- stalls : admin/staff จัดการ, ทุกคนที่ login ดูได้ ----------
create policy stalls_select on public.stalls for select to authenticated
  using ((select private.is_app_user()));
create policy stalls_insert on public.stalls for insert to authenticated
  with check ((select private.is_staff()));
create policy stalls_update on public.stalls for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy stalls_delete on public.stalls for delete to authenticated
  using ((select private.is_admin()));

-- ---------- tenants : admin/staff จัดการ, manager ดู, ผู้เช่าดู/แก้ของตัวเอง ----------
create policy tenants_select on public.tenants for select to authenticated
  using ((select private.is_officer()) or tenant_id = (select private.current_tenant_id()));
create policy tenants_insert on public.tenants for insert to authenticated
  with check ((select private.is_staff()));
create policy tenants_update on public.tenants for update to authenticated
  using ((select private.is_staff()) or tenant_id = (select private.current_tenant_id()))
  with check ((select private.is_staff()) or tenant_id = (select private.current_tenant_id()));
create policy tenants_delete on public.tenants for delete to authenticated
  using ((select private.is_admin()));

-- ---------- contracts : admin/staff จัดการ, manager ดู, ผู้เช่าดูของตัวเอง + ขอเช่า + ยกเลิกคำขอ ----------
create policy contracts_select on public.contracts for select to authenticated
  -- เช็คจาก tenant_id ของแถวโดยตรง เพื่อให้ insert ... returning (supabase .insert().select()) เห็นแถวใหม่ได้
  using ((select private.is_officer()) or tenant_id = (select private.current_tenant_id()));
create policy contracts_insert on public.contracts for insert to authenticated
  with check (
    (select private.is_staff())
    or (tenant_id = (select private.current_tenant_id()) and status = 'pending')
  );
create policy contracts_update on public.contracts for update to authenticated
  using (
    (select private.is_staff())
    or (tenant_id = (select private.current_tenant_id()) and status = 'pending')
  )
  with check (
    (select private.is_staff())
    or (tenant_id = (select private.current_tenant_id()) and status = 'cancelled')
  );
create policy contracts_delete on public.contracts for delete to authenticated
  using ((select private.is_admin()));

-- ---------- utility_readings : admin/staff จัดการ, manager ดู, ผู้เช่าดูมิเตอร์ที่อยู่ในบิลของตัวเอง ----------
create policy utility_readings_select on public.utility_readings for select to authenticated
  using ((select private.is_officer()) or invoice_id in (select private.my_invoice_ids()));
create policy utility_readings_insert on public.utility_readings for insert to authenticated
  with check ((select private.is_staff()));
create policy utility_readings_update on public.utility_readings for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy utility_readings_delete on public.utility_readings for delete to authenticated
  using ((select private.is_admin()));

-- ---------- invoices : admin/staff จัดการ, manager ดู, ผู้เช่าดูของตัวเอง ----------
create policy invoices_select on public.invoices for select to authenticated
  using ((select private.is_officer()) or contract_id in (select private.my_contract_ids()));
create policy invoices_insert on public.invoices for insert to authenticated
  with check ((select private.is_staff()));
create policy invoices_update on public.invoices for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy invoices_delete on public.invoices for delete to authenticated
  using ((select private.is_admin()));

-- ---------- payments : admin/staff ตรวจ, manager ดู, ผู้เช่าแจ้งชำระ + ดูของตัวเอง ----------
create policy payments_select on public.payments for select to authenticated
  using ((select private.is_officer()) or invoice_id in (select private.my_invoice_ids()));
create policy payments_insert on public.payments for insert to authenticated
  with check (
    (select private.is_staff())
    or (invoice_id in (select private.my_invoice_ids()) and status = 'pending')
  );
create policy payments_update on public.payments for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy payments_delete on public.payments for delete to authenticated
  using ((select private.is_admin()));

-- ---------- receipts : admin/staff ออก, manager ดู, ผู้เช่าดูของตัวเอง ----------
create policy receipts_select on public.receipts for select to authenticated
  using ((select private.is_officer()) or payment_id in (select private.my_payment_ids()));
create policy receipts_insert on public.receipts for insert to authenticated
  with check ((select private.is_staff()));
create policy receipts_update on public.receipts for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy receipts_delete on public.receipts for delete to authenticated
  using ((select private.is_admin()));
