-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 009 : ลบผู้เช่าโดยเก็บประวัติการเงิน + การแจ้งเตือน
--
--  เปลี่ยนโครงสร้าง (ผู้ใช้อนุมัติแล้ว)
--   - เพิ่มคอลัมน์ tenants.deleted_at      (วันเวลาที่ลบข้อมูลผู้เช่า)
--   - เพิ่มตาราง notifications             (แจ้งเตือนของเจ้าหน้าที่และผู้เช่า)
--
--  1) ลบผู้เช่า: delete_tenant()
--     - ไม่เคยมีสัญญาที่ใช้งาน/สิ้นสุด และไม่มีใบแจ้งหนี้ → ลบออกจากระบบจริง
--     - มีประวัติ → ล้างข้อมูลส่วนตัว (ชื่อ เลขบัตร เบอร์โทร ที่อยู่ ชื่อร้าน LINE)
--       แต่เก็บสัญญา ใบแจ้งหนี้ การชำระ ใบเสร็จ ไว้ครบ รายงานรายได้ไม่เปลี่ยน
--     - ยังมีสัญญาที่ใช้งานอยู่ → ลบไม่ได้ (ยกเลิก/ปิดสัญญาก่อน)
--     - คำขอเช่าที่รออนุมัติ → ยกเลิกให้อัตโนมัติ
--  2) การแจ้งเตือน: ระบบสร้างให้เองด้วย trigger
--     - เจ้าหน้าที่ : ผู้เช่าแจ้งชำระ · ขอเช่า/ยกเลิกคำขอ · แก้ข้อมูลติดต่อ · ผูก LINE
--     - ผู้เช่า     : ใบแจ้งหนี้ใหม่/ยกเลิก/เลื่อนวันครบกำหนด · ได้รับชำระ (ใบเสร็จ) ·
--                    สลิปไม่ผ่าน · ยกเลิกใบเสร็จ · อนุมัติ/ไม่อนุมัติคำขอ · สัญญาใหม่/ยกเลิก/สิ้นสุด
--     - หน้าเว็บรับแบบทันทีผ่าน Supabase Realtime (เพิ่มตารางเข้า publication ให้แล้ว)
--     - เก็บไว้ 180 วัน
--
--  รันซ้ำได้ · รันต่อจาก migration 001–008
-- =====================================================================


-- =====================================================================
-- 1) ผู้เช่าที่ถูกลบ
-- =====================================================================
alter table public.tenants add column if not exists deleted_at timestamptz;
comment on column public.tenants.deleted_at is
  'วันเวลาที่ลบข้อมูลผู้เช่า (ล้างข้อมูลส่วนตัวแล้ว เก็บไว้เพื่อประวัติการเงิน) — NULL = ยังใช้งาน';

-- คอลัมน์ใหม่ของ tenants ต้อง grant select เอง (migration 002 ปิด select ทั้งตาราง)
grant select (deleted_at) on public.tenants to authenticated;

-- ข้อมูลที่ลบแล้วแก้ผ่านเว็บไม่ได้ · deleted_at ตั้งได้จาก delete_tenant() เท่านั้น
create or replace function private.tenants_guard_deleted()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.deleted_at := null;
    return new;
  end if;
  if old.deleted_at is not null then
    raise exception 'ผู้เช่ารายนี้ถูกลบข้อมูลแล้ว แก้ไขไม่ได้' using errcode = '42501';
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    raise exception 'ลบผู้เช่าได้จากปุ่ม "ลบผู้เช่า" เท่านั้น' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists tenants_05_guard_deleted on public.tenants;
create trigger tenants_05_guard_deleted
  before insert or update on public.tenants
  for each row execute function private.tenants_guard_deleted();

-- ทำสัญญากับผู้เช่าที่ลบแล้วไม่ได้
create or replace function private.contracts_tenant_not_deleted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tenants t where t.tenant_id = new.tenant_id and t.deleted_at is not null) then
    raise exception 'ผู้เช่ารายนี้ถูกลบข้อมูลแล้ว ทำสัญญาใหม่ไม่ได้ (เพิ่มเป็นผู้เช่าใหม่แทน)';
  end if;
  return new;
end $$;

drop trigger if exists contracts_12_tenant_not_deleted on public.contracts;
create trigger contracts_12_tenant_not_deleted
  before insert on public.contracts
  for each row execute function private.contracts_tenant_not_deleted();


-- =====================================================================
-- 2) ตารางแจ้งเตือน
--    ผู้รับ: user_id ไม่ว่าง = เจ้าหน้าที่คนนั้น (tenant_id = ผู้เช่าที่เกี่ยวข้อง)
--            user_id ว่าง    = ผู้เช่า tenant_id
-- =====================================================================
create table if not exists public.notifications (
  notification_id  bigint generated always as identity primary key,
  user_id          uuid references public.users (user_id) on delete cascade,
  tenant_id        int  references public.tenants (tenant_id) on delete cascade,
  kind             varchar(40)  not null,
  title            varchar(200) not null,
  body             text,
  link             varchar(200),
  read_at          timestamptz,
  created_at       timestamptz  not null default now(),
  constraint notifications_recipient check (user_id is not null or tenant_id is not null)
);

create index if not exists notifications_user_idx    on public.notifications (user_id, notification_id desc) where user_id is not null;
create index if not exists notifications_tenant_idx  on public.notifications (tenant_id, notification_id desc) where user_id is null;
create index if not exists notifications_subject_idx on public.notifications (tenant_id);
create index if not exists notifications_created_idx on public.notifications (created_at);

comment on table  public.notifications                 is 'การแจ้งเตือน (ระบบสร้างจาก trigger) — เจ้าหน้าที่และผู้เช่าเห็นเฉพาะของตัวเอง';
comment on column public.notifications.notification_id is 'รหัสการแจ้งเตือน (PK)';
comment on column public.notifications.user_id         is 'ผู้รับที่เป็นเจ้าหน้าที่ (FK → users) — NULL = แจ้งผู้เช่า';
comment on column public.notifications.tenant_id       is 'ผู้รับที่เป็นผู้เช่า หรือผู้เช่าที่เกี่ยวข้องกับแจ้งเตือนของเจ้าหน้าที่ (FK → tenants)';
comment on column public.notifications.kind            is 'ชนิด เช่น payment_submitted, invoice_issued, contract_approved';
comment on column public.notifications.title           is 'หัวข้อ';
comment on column public.notifications.body            is 'รายละเอียด';
comment on column public.notifications.link            is 'หน้าที่เปิดเมื่อกดแจ้งเตือน เช่น /admin/payments?open=12';
comment on column public.notifications.read_at         is 'วันเวลาที่อ่าน — NULL = ยังไม่อ่าน';
comment on column public.notifications.created_at      is 'วันเวลาที่สร้าง';

alter table public.notifications enable row level security;

-- อ่านได้เฉพาะของตัวเอง · แก้ได้แค่ "อ่านแล้ว" · เพิ่ม/ลบผ่าน API ไม่ได้ (ระบบสร้างเอง)
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications for select to authenticated
  using (
    (user_id = (select auth.uid()) and (select private.is_officer()))
    or (user_id is null and tenant_id = (select private.current_tenant_id()))
  );

drop policy if exists notifications_update on public.notifications;
create policy notifications_update on public.notifications for update to authenticated
  using (
    (user_id = (select auth.uid()) and (select private.is_officer()))
    or (user_id is null and tenant_id = (select private.current_tenant_id()))
  )
  with check (
    (user_id = (select auth.uid()) and (select private.is_officer()))
    or (user_id is null and tenant_id = (select private.current_tenant_id()))
  );

-- ส่งการเปลี่ยนแปลงแบบทันทีให้หน้าเว็บ (Supabase Realtime เคารพ RLS ข้างบน)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;


-- =====================================================================
-- 3) ตัวช่วยสร้างข้อความ
-- =====================================================================
create or replace function private.th_date(p_date date)
returns text language sql immutable set search_path = '' as $$
  select extract(day from p_date)::int || ' '
      || (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[extract(month from p_date)::int]
      || ' ' || (extract(year from p_date)::int + 543)
$$;

create or replace function private.th_period(p_period text)
returns text language sql immutable set search_path = '' as $$
  select (array['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'])[right(p_period, 2)::int]
      || ' ' || (left(p_period, 4)::int + 543)
$$;

-- "ตลาดเย็น แผง B001" / "อาคาร OTOP ห้อง A001"
create or replace function private.stall_label(p_stall_id int)
returns text language sql stable security definer set search_path = '' as $$
  select m.market_name || case s.unit_type when 'room' then ' ห้อง ' else ' แผง ' end || s.stall_code
  from public.stalls s
  join public.zones z on z.zone_id = s.zone_id
  join public.markets m on m.market_id = z.market_id
  where s.stall_id = p_stall_id
$$;

create or replace function private.tenant_label(p_tenant_id int)
returns text language sql stable security definer set search_path = '' as $$
  select t.full_name || coalesce(' (' || nullif(t.business_name, '') || ')', '')
  from public.tenants t where t.tenant_id = p_tenant_id
$$;

-- แจ้งเจ้าหน้าที่ทุกคนที่ใช้งานอยู่ (ยกเว้นคนที่ทำรายการเอง)
create or replace function private.notify_staff(
  p_kind text, p_title text, p_body text, p_link text, p_tenant_id int default null
) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notifications where created_at < now() - interval '180 days';
  insert into public.notifications (user_id, tenant_id, kind, title, body, link)
  select u.user_id, p_tenant_id, p_kind, left(p_title, 200), p_body, left(p_link, 200)
  from public.users u
  where u.status = 'active' and u.user_id is distinct from auth.uid();
end $$;

-- แจ้งผู้เช่า (ไม่แจ้งเรื่องที่ผู้เช่าทำเอง · ไม่แจ้งผู้เช่าที่ลบแล้ว)
create or replace function private.notify_tenant(
  p_tenant_id int, p_kind text, p_title text, p_body text, p_link text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_tenant_id is null or p_tenant_id = private.current_tenant_id() then
    return;
  end if;
  delete from public.notifications where created_at < now() - interval '180 days';
  insert into public.notifications (tenant_id, kind, title, body, link)
  select t.tenant_id, p_kind, left(p_title, 200), p_body, left(p_link, 200)
  from public.tenants t
  where t.tenant_id = p_tenant_id and t.deleted_at is null;
end $$;

-- ผู้ทำรายการเป็นผู้เช่า (login ผ่าน LINE) หรือไม่
create or replace function private.actor_is_tenant()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_tenant_id() is not null and private.current_user_role() is null
$$;


-- =====================================================================
-- 4) Trigger สร้างแจ้งเตือน (ทำงานหลังบันทึกสำเร็จ · ลำดับ 95 = หลัง trigger เดิมทั้งหมด)
-- =====================================================================

-- ---------- การชำระเงิน ----------
create or replace function private.payments_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inv     record;
  v_receipt text;
  v_reason  text;
begin
  select i.invoice_id, i.invoice_no, c.tenant_id into v_inv
  from public.invoices i join public.contracts c on c.contract_id = i.contract_id
  where i.invoice_id = new.invoice_id;

  if tg_op = 'INSERT' then
    if new.status = 'pending' and private.actor_is_tenant() then
      perform private.notify_staff('payment_submitted', 'แจ้งชำระเงินใหม่',
        format('%s · %s · %s บาท', private.tenant_label(v_inv.tenant_id), v_inv.invoice_no, private.baht(new.amount)),
        '/admin/payments?open=' || new.payment_id, v_inv.tenant_id);
    end if;
    return null;
  end if;

  if new.status = 'rejected' and old.status = 'pending' then
    perform private.notify_tenant(v_inv.tenant_id, 'payment_rejected', 'สลิปไม่ผ่านการตรวจสอบ',
      format('%s · %s บาท%s · แจ้งชำระใหม่ได้ที่หน้าบิล', v_inv.invoice_no, private.baht(new.amount),
             coalesce(' · เหตุผล: ' || nullif(btrim(new.note), ''), '')),
      '/liff/bills/' || v_inv.invoice_id);
  elsif new.status = 'rejected' and old.status = 'verified' then
    select r.receipt_no into v_receipt from public.receipts r where r.payment_id = new.payment_id;
    v_reason := (regexp_match(coalesce(new.note, ''), '([^\n]*)$'))[1];
    perform private.notify_tenant(v_inv.tenant_id, 'receipt_voided', 'ยกเลิกใบเสร็จ ' || coalesce(v_receipt, ''),
      format('%s บาท ของบิล %s ถูกยกเลิก บิลกลับเป็นรอชำระ%s', private.baht(new.amount), v_inv.invoice_no,
             coalesce(' · ' || nullif(btrim(v_reason), ''), '')),
      '/liff/bills/' || v_inv.invoice_id);
  end if;
  return null;
end $$;

drop trigger if exists payments_95_notify on public.payments;
create trigger payments_95_notify
  after insert or update of status on public.payments
  for each row execute function private.payments_notify();

-- ---------- ใบเสร็จ (ตรวจสลิปผ่าน หรือรับเงินที่สำนักงาน) ----------
create or replace function private.receipts_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_inv  record;
  v_left numeric;
begin
  select i.invoice_id, i.invoice_no, i.total_amount, c.tenant_id into v_inv
  from public.payments p
  join public.invoices i on i.invoice_id = p.invoice_id
  join public.contracts c on c.contract_id = i.contract_id
  where p.payment_id = new.payment_id;
  v_left := v_inv.total_amount - private.invoice_paid_amount(v_inv.invoice_id);
  perform private.notify_tenant(v_inv.tenant_id, 'payment_verified', 'ได้รับชำระเงินแล้ว',
    format('%s บาท · ใบเสร็จ %s · บิล %s %s', private.baht(new.amount), new.receipt_no, v_inv.invoice_no,
           case when v_left > 0 then 'ค้างอีก ' || private.baht(v_left) || ' บาท' else 'ชำระครบแล้ว' end),
    '/liff/receipts/' || new.receipt_id);
  return null;
end $$;

drop trigger if exists receipts_95_notify on public.receipts;
create trigger receipts_95_notify
  after insert on public.receipts
  for each row execute function private.receipts_notify();

-- ---------- ใบแจ้งหนี้ ----------
create or replace function private.invoices_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_tenant int;
begin
  select c.tenant_id into v_tenant from public.contracts c where c.contract_id = new.contract_id;

  if tg_op = 'INSERT' then
    if new.status = 'unpaid' then
      perform private.notify_tenant(v_tenant, 'invoice_issued', 'บิลใหม่ รอบ ' || private.th_period(new.billing_period),
        format('%s · %s บาท · ครบกำหนด %s', new.invoice_no, private.baht(new.total_amount), private.th_date(new.due_date)),
        '/liff/bills/' || new.invoice_id);
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    perform private.notify_tenant(v_tenant, 'invoice_cancelled', 'ยกเลิกบิล ' || new.invoice_no,
      format('บิลรอบ %s ยอด %s บาท ถูกยกเลิก ไม่ต้องชำระบิลนี้', private.th_period(new.billing_period), private.baht(new.total_amount)),
      '/liff/bills');
  elsif new.status = 'unpaid' and new.due_date is distinct from old.due_date then
    perform private.notify_tenant(v_tenant, 'invoice_due_changed', 'เปลี่ยนวันครบกำหนดชำระ',
      format('%s · ครบกำหนดใหม่ %s', new.invoice_no, private.th_date(new.due_date)),
      '/liff/bills/' || new.invoice_id);
  end if;
  return null;
end $$;

drop trigger if exists invoices_95_notify on public.invoices;
create trigger invoices_95_notify
  after insert or update of status, due_date on public.invoices
  for each row execute function private.invoices_notify();

-- ---------- สัญญาเช่า / คำขอเช่า ----------
create or replace function private.contracts_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_stall  text := private.stall_label(new.stall_id);
  v_tenant boolean := private.actor_is_tenant();
  v_note   text := coalesce(' · ' || nullif(btrim(new.note), ''), '');
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' and v_tenant then
      perform private.notify_staff('contract_requested', 'คำขอเช่าใหม่',
        format('%s ขอเช่า %s เริ่ม %s', private.tenant_label(new.tenant_id), v_stall, private.th_date(new.start_date)),
        '/admin/contracts?open=' || new.contract_id, new.tenant_id);
    elsif new.status = 'pending' then
      perform private.notify_tenant(new.tenant_id, 'contract_requested', 'สำนักงานบันทึกคำขอเช่าให้',
        format('%s เริ่ม %s · รออนุมัติ', v_stall, private.th_date(new.start_date)), '/liff/stalls');
    elsif new.status = 'active' then
      perform private.notify_tenant(new.tenant_id, 'contract_created', 'ทำสัญญาเช่าแล้ว',
        format('%s · สัญญา %s · %s ถึง %s', v_stall, new.contract_no, private.th_date(new.start_date), private.th_date(new.end_date)),
        '/liff/stalls');
    end if;
    return null;
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  if old.status = 'pending' and new.status = 'active' then
    perform private.notify_tenant(new.tenant_id, 'contract_approved', 'อนุมัติคำขอเช่าแล้ว',
      format('%s · สัญญา %s เริ่ม %s', v_stall, new.contract_no, private.th_date(new.start_date)), '/liff/stalls');
  elsif old.status = 'pending' and new.status = 'rejected' then
    perform private.notify_tenant(new.tenant_id, 'contract_rejected', 'ไม่อนุมัติคำขอเช่า', v_stall || v_note, '/liff/stalls');
  elsif old.status = 'pending' and new.status = 'cancelled' then
    if v_tenant then
      perform private.notify_staff('request_cancelled', 'ผู้เช่ายกเลิกคำขอเช่า',
        format('%s ยกเลิกคำขอ %s', private.tenant_label(new.tenant_id), v_stall),
        '/admin/contracts?tab=history', new.tenant_id);
    else
      perform private.notify_tenant(new.tenant_id, 'request_cancelled', 'คำขอเช่าถูกยกเลิก', v_stall || v_note, '/liff/stalls');
    end if;
  elsif old.status = 'active' and new.status = 'cancelled' then
    perform private.notify_tenant(new.tenant_id, 'contract_cancelled', 'ยกเลิกสัญญาเช่า',
      format('%s · สัญญา %s%s', v_stall, new.contract_no, v_note), '/liff/stalls');
  elsif old.status = 'active' and new.status = 'expired' then
    perform private.notify_tenant(new.tenant_id, 'contract_expired', 'สัญญาเช่าสิ้นสุดแล้ว',
      format('%s · สัญญา %s สิ้นสุด %s · ต้องการเช่าต่อติดต่อสำนักงาน', v_stall, new.contract_no, private.th_date(new.end_date)),
      '/liff/stalls');
  end if;
  return null;
end $$;

drop trigger if exists contracts_95_notify on public.contracts;
create trigger contracts_95_notify
  after insert or update of status on public.contracts
  for each row execute function private.contracts_notify();

-- ---------- ผู้เช่า: แก้ข้อมูลติดต่อเอง / ผูก LINE ----------
create or replace function private.tenants_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_changed text[] := '{}';
begin
  if new.deleted_at is not null then
    return null;
  end if;

  if private.actor_is_tenant() then
    if new.phone is distinct from old.phone then v_changed := v_changed || ('เบอร์โทร ' || coalesce(new.phone, '-')); end if;
    if new.address is distinct from old.address then v_changed := v_changed || 'ที่อยู่'::text; end if;
    if new.business_name is distinct from old.business_name then v_changed := v_changed || ('ชื่อร้าน ' || coalesce(new.business_name, '-')); end if;
    if cardinality(v_changed) > 0 then
      perform private.notify_staff('tenant_updated', 'ผู้เช่าแก้ไขข้อมูลติดต่อ',
        format('%s · %s', new.full_name, array_to_string(v_changed, ', ')), '/admin/tenants', new.tenant_id);
    end if;
  end if;

  if old.auth_id is null and new.auth_id is not null then
    perform private.notify_staff('line_linked', 'ผู้เช่าผูกบัญชี LINE แล้ว', private.tenant_label(new.tenant_id),
      '/admin/tenants', new.tenant_id);
    perform private.notify_tenant(new.tenant_id, 'welcome', 'ผูกบัญชี LINE เรียบร้อย',
      'ต่อไปจะได้รับแจ้งเตือนบิลใหม่และผลการตรวจสลิปที่นี่', '/liff');
  end if;
  return null;
end $$;

drop trigger if exists tenants_95_notify on public.tenants;
create trigger tenants_95_notify
  after update on public.tenants
  for each row execute function private.tenants_notify();


-- =====================================================================
-- 5) ลบผู้เช่า
--    supabase.rpc('delete_tenant', { p_tenant_id: 12 })
--    คืนค่า { mode: 'deleted' | 'anonymized', cancelled_requests: n }
--    สิทธิ์: เฉพาะผู้ดูแลระบบ (admin)
-- =====================================================================
create or replace function public.delete_tenant(p_tenant_id int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant    record;
  v_active    text;
  v_history   boolean;
  v_cancelled int := 0;
begin
  -- security definer: ตรวจผู้เรียกจาก JWT (ผ่านเว็บ = authenticated ต้องเป็น admin · SQL Editor / service_role ทำได้)
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'postgres') not in ('postgres', 'service_role')
     and not private.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ลบผู้เช่าได้' using errcode = '42501';
  end if;

  select t.tenant_id, t.full_name, t.deleted_at into v_tenant
  from public.tenants t where t.tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'ไม่พบผู้เช่ารหัส %', p_tenant_id;
  elsif v_tenant.deleted_at is not null then
    raise exception 'ผู้เช่ารายนี้ถูกลบข้อมูลไปแล้ว';
  end if;

  select string_agg(c.contract_no || ' ' || private.stall_label(c.stall_id), ', ' order by c.contract_no) into v_active
  from public.contracts c where c.tenant_id = p_tenant_id and c.status = 'active';
  if v_active is not null then
    raise exception 'ผู้เช่ารายนี้ยังมีสัญญาที่ใช้งานอยู่ (%) — ยกเลิกหรือปิดสัญญาที่หน้า "คำขอและสัญญาเช่า" ก่อน แล้วจึงลบผู้เช่า', v_active;
  end if;

  v_history := exists (select 1 from public.contracts c where c.tenant_id = p_tenant_id and c.status in ('active', 'expired'))
            or exists (select 1 from public.invoices i join public.contracts c on c.contract_id = i.contract_id
                       where c.tenant_id = p_tenant_id);

  if not v_history then
    -- ไม่มีประวัติการเช่า/การเงิน: ลบจริง (คำขอที่รออนุมัติ/ยกเลิก/ไม่อนุมัติ ลบตาม แผงที่จองกลับเป็นว่าง)
    delete from public.contracts where tenant_id = p_tenant_id;
    delete from public.tenants where tenant_id = p_tenant_id;
    return jsonb_build_object('mode', 'deleted', 'cancelled_requests', 0);
  end if;

  -- มีประวัติ: ยกเลิกคำขอที่ค้าง แล้วล้างข้อมูลส่วนตัว
  update public.contracts
  set status = 'cancelled',
      note = left(concat_ws(' · ', nullif(note, ''), 'ยกเลิกอัตโนมัติเพราะลบข้อมูลผู้เช่า'), 500)
  where tenant_id = p_tenant_id and status = 'pending';
  get diagnostics v_cancelled = row_count;

  update public.tenants
  set full_name     = 'ผู้เช่าที่ลบข้อมูลแล้ว #' || tenant_id,
      id_card       = null,
      phone         = null,
      address       = null,
      business_name = null,
      line_user_id  = null,
      auth_id       = null,
      status        = 'inactive',
      deleted_at    = now()
  where tenant_id = p_tenant_id;

  -- แจ้งเตือนที่มีชื่อ/ข้อมูลของผู้เช่ารายนี้
  delete from public.notifications where tenant_id = p_tenant_id;

  return jsonb_build_object('mode', 'anonymized', 'cancelled_requests', v_cancelled);
end $$;

comment on function public.delete_tenant(int) is
  'ลบผู้เช่า (เฉพาะ admin): ไม่มีประวัติ = ลบจริง · มีประวัติ = ล้างข้อมูลส่วนตัว เก็บสัญญา/ใบแจ้งหนี้/ใบเสร็จไว้';


-- =====================================================================
-- 6) สิทธิ์ของฟังก์ชัน
-- =====================================================================
revoke execute on function
  private.tenants_guard_deleted(), private.contracts_tenant_not_deleted(),
  private.th_date(date), private.th_period(text), private.stall_label(int), private.tenant_label(int),
  private.notify_staff(text, text, text, text, int), private.notify_tenant(int, text, text, text, text),
  private.actor_is_tenant(),
  private.payments_notify(), private.receipts_notify(), private.invoices_notify(),
  private.contracts_notify(), private.tenants_notify()
  from public;

revoke execute on function public.delete_tenant(int) from public, anon;
grant  execute on function public.delete_tenant(int) to authenticated, service_role;
