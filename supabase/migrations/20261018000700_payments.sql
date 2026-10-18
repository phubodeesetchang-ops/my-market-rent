-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 007 : การชำระเงิน (ขั้นที่ 7)
--
--  เปลี่ยนโครงสร้าง (ผู้ใช้อนุมัติแล้ว)
--   - เพิ่ม markets.promptpay_id, markets.promptpay_name  (บัญชีพร้อมเพย์ของแต่ละตลาด)
--
--  ที่เหลือเป็น Storage + ฟังก์ชัน + trigger
--   1) Storage bucket "slips" (ส่วนตัว) เก็บรูปสลิป: <tenant_id>/<invoice_id>/<ชื่อไฟล์>
--   2) กติกาการชำระ: ลำดับสถานะ, ห้ามรับเกินยอดค้าง, แก้ยอดหลังตรวจไม่ได้
--   3) ตรวจผ่าน → ออกใบเสร็จให้อัตโนมัติ · ยอดที่ตรวจแล้วครบ → ใบแจ้งหนี้ "ชำระแล้ว" อัตโนมัติ
--   4) ใบแจ้งหนี้: สถานะต้องตรงกับยอดที่ชำระจริง, แก้ยอดในใบไม่ได้, ยกเลิกใบที่มีการชำระไม่ได้
--   5) ใบเสร็จแก้/ลบไม่ได้ — ยกเลิกได้โดยผู้ดูแลระบบ (การชำระเปลี่ยนเป็น "ไม่ผ่าน" ใบเสร็จยังอยู่)
--   6) ฟังก์ชันที่หน้าเว็บเรียก: verify_payment, reject_payment, record_payment, void_payment
--
--  กติกาที่ผู้ใช้เลือก
--   - แบ่งจ่ายได้หลายครั้ง แต่ละครั้งได้ใบเสร็จของตัวเอง รับเกินยอดค้างไม่ได้
--   - ผู้ดูแลระบบยกเลิกใบเสร็จได้พร้อมเหตุผล (ไม่ต้องเพิ่มคอลัมน์)
--
--  รันซ้ำได้ · รันต่อจาก migration 001–006
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) บัญชีพร้อมเพย์ของตลาด
--    เบอร์มือถือ 10 หลัก (ขึ้นต้น 0) หรือเลขประจำตัวผู้เสียภาษี/บัตรประชาชน 13 หลัก
-- ---------------------------------------------------------------------
alter table public.markets add column if not exists promptpay_id   varchar(20);
alter table public.markets add column if not exists promptpay_name varchar(150);
alter table public.markets drop constraint if exists markets_promptpay_id_format;
alter table public.markets add constraint markets_promptpay_id_format
  check (promptpay_id is null or promptpay_id ~ '^(0[0-9]{9}|[0-9]{13})$');

comment on column public.markets.promptpay_id   is 'พร้อมเพย์ของตลาด: เบอร์มือถือ 10 หลัก หรือเลขผู้เสียภาษี 13 หลัก (ตัวเลขล้วน) — NULL = ยังไม่ตั้ง';
comment on column public.markets.promptpay_name is 'ชื่อบัญชีพร้อมเพย์ (แสดงให้ผู้เช่าตรวจก่อนโอน)';


-- ---------------------------------------------------------------------
-- 2) ที่เก็บสลิป (Supabase Storage)
--    ไม่มีลิงก์สาธารณะ เปิดดูผ่าน signed URL ที่หมดอายุเอง · รูปเท่านั้น ไม่เกิน 5 MB
--    ผู้เช่าอัปโหลด/ดูได้เฉพาะโฟลเดอร์ของตัวเอง และเฉพาะใบแจ้งหนี้ของตัวเอง
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists slips_officer_select on storage.objects;
create policy slips_officer_select on storage.objects for select to authenticated
  using (bucket_id = 'slips' and (select private.is_officer()));

drop policy if exists slips_staff_insert on storage.objects;
create policy slips_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'slips' and (select private.is_staff()));

drop policy if exists slips_tenant_select on storage.objects;
create policy slips_tenant_select on storage.objects for select to authenticated
  using (bucket_id = 'slips' and (storage.foldername(name))[1] = (select private.current_tenant_id())::text);

drop policy if exists slips_tenant_insert on storage.objects;
create policy slips_tenant_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'slips'
    and (storage.foldername(name))[1] = (select private.current_tenant_id())::text
    and (storage.foldername(name))[2] in (select i::text from private.my_invoice_ids() as i)
  );

drop policy if exists slips_admin_delete on storage.objects;
create policy slips_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'slips' and (select private.is_admin()));


-- ---------------------------------------------------------------------
-- 3) ตัวช่วย
-- ---------------------------------------------------------------------
-- ยอดที่ตรวจแล้วของใบแจ้งหนี้ (security definer: ใช้ใน trigger ได้ไม่ว่าใครเรียก)
create or replace function private.invoice_paid_amount(p_invoice_id int)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(sum(p.amount), 0) from public.payments p
  where p.invoice_id = p_invoice_id and p.status = 'verified'
$$;

create or replace function private.payment_status_th(p_status text)
returns text language sql immutable set search_path = '' as $$
  select case p_status when 'pending' then 'รอตรวจสอบ' when 'verified' then 'ตรวจสอบแล้ว'
                       when 'rejected' then 'ไม่ผ่าน' else p_status end
$$;

create or replace function private.baht(p_amount numeric)
returns text language sql immutable set search_path = '' as $$
  select to_char(p_amount, 'FM999,999,990.00')
$$;


-- ---------------------------------------------------------------------
-- 4) กติกาการชำระ (ทำงานต่อจาก payments_10_before_write ของ migration 002)
--    รอตรวจสอบ → ตรวจสอบแล้ว / ไม่ผ่าน
--    ตรวจสอบแล้ว → ไม่ผ่าน (= ยกเลิกใบเสร็จ เฉพาะผู้ดูแลระบบ)
--    ไม่ผ่าน → เปลี่ยนต่อไม่ได้ (ให้แจ้งชำระใหม่)
-- ---------------------------------------------------------------------
create or replace function private.payments_rules()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_total  numeric;
  v_paid   numeric;
  v_check  boolean;
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      if old.status = 'rejected' then
        raise exception 'การชำระที่ไม่ผ่านหรือยกเลิกแล้ว เปลี่ยนสถานะไม่ได้ (ให้แจ้งชำระใหม่)';
      elsif old.status = 'verified' and new.status = 'pending' then
        raise exception 'การชำระที่ตรวจแล้วย้อนกลับเป็นรอตรวจสอบไม่ได้';
      elsif old.status = 'verified' and current_user = 'authenticated' and not private.is_admin() then
        raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ยกเลิกใบเสร็จได้' using errcode = '42501';
      end if;
    end if;
    if old.status <> 'pending'
       and (new.amount, new.invoice_id, new.payment_method, new.payment_date)
           is distinct from (old.amount, old.invoice_id, old.payment_method, old.payment_date) then
      raise exception 'การชำระที่ตรวจแล้วแก้ยอดเงิน ใบแจ้งหนี้ วันที่ หรือวิธีชำระไม่ได้';
    end if;
  end if;

  if new.payment_date > private.today_th() then
    raise exception 'วันที่ชำระต้องไม่เกินวันนี้';
  end if;

  -- ตรวจยอดตอนแจ้งชำระ ตอนตรวจผ่าน และตอนแก้ยอดของรายการที่รอตรวจ
  v_check := (tg_op = 'INSERT' and new.status in ('pending', 'verified'))
          or (tg_op = 'UPDATE' and new.status = 'verified' and old.status = 'pending')
          or (tg_op = 'UPDATE' and new.status = 'pending' and new.amount is distinct from old.amount);
  if v_check then
    -- ล็อกตามใบแจ้งหนี้ → ตรวจพร้อมกันหลายคนก็รับเกินยอดไม่ได้
    perform pg_advisory_xact_lock(hashtextextended('invoice-payment:' || new.invoice_id, 0));
    select i.status, i.rent_amount + i.water_amount + i.electricity_amount + i.fee_amount
      into v_status, v_total
    from public.invoices i where i.invoice_id = new.invoice_id;
    if not found then
      raise exception 'ไม่พบใบแจ้งหนี้นี้' using errcode = '42501';
    elsif v_status = 'cancelled' then
      raise exception 'ใบแจ้งหนี้นี้ถูกยกเลิกแล้ว รับชำระไม่ได้';
    end if;
    select coalesce(sum(p.amount), 0) into v_paid from public.payments p
    where p.invoice_id = new.invoice_id and p.status = 'verified' and p.payment_id is distinct from new.payment_id;
    if v_paid >= v_total then
      raise exception 'ใบแจ้งหนี้นี้ชำระครบแล้ว';
    elsif new.amount > v_total - v_paid then
      raise exception 'ยอด % บาท เกินยอดค้างชำระ (ค้าง % บาท)', private.baht(new.amount), private.baht(v_total - v_paid);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists payments_20_rules on public.payments;
create trigger payments_20_rules
  before insert or update on public.payments
  for each row execute function private.payments_rules();

-- หลังบันทึก: ออกใบเสร็จเมื่อตรวจผ่าน + ปรับสถานะใบแจ้งหนี้ตามยอดที่ตรวจแล้ว
-- security definer: ผู้เช่าแจ้งชำระหรือ trigger ทำงานต่อได้โดยไม่ติด RLS
create or replace function private.sync_invoice_paid(p_invoice_id int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.invoices i
  set status = case when private.invoice_paid_amount(i.invoice_id) >= i.total_amount then 'paid' else 'unpaid' end
  where i.invoice_id = p_invoice_id and i.status <> 'cancelled'
    and i.status is distinct from
        (case when private.invoice_paid_amount(i.invoice_id) >= i.total_amount then 'paid' else 'unpaid' end);
end $$;

create or replace function private.payments_after_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'verified'
     and (tg_op = 'INSERT' or old.status <> 'verified') then
    insert into public.receipts (payment_id, receipt_date, amount, issued_by)
    values (new.payment_id,
            coalesce((new.verified_at at time zone 'Asia/Bangkok')::date, private.today_th()),
            new.amount,
            coalesce(new.verified_by, auth.uid()))
    on conflict (payment_id) do nothing;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.sync_invoice_paid(old.invoice_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.invoice_id is distinct from old.invoice_id
                                        or new.status is distinct from old.status or new.amount is distinct from old.amount) then
    perform private.sync_invoice_paid(new.invoice_id);
  end if;
  return null;
end $$;

drop trigger if exists payments_90_after_change on public.payments;
create trigger payments_90_after_change
  after insert or update or delete on public.payments
  for each row execute function private.payments_after_change();


-- ---------------------------------------------------------------------
-- 5) ใบเสร็จ: ออกได้เฉพาะการชำระที่ตรวจแล้ว · แก้/ลบไม่ได้ (ยกเลิกผ่าน void_payment)
-- ---------------------------------------------------------------------
create or replace function private.receipts_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_amount numeric;
begin
  if tg_op = 'INSERT' then
    select p.status, p.amount into v_status, v_amount from public.payments p where p.payment_id = new.payment_id;
    if v_status is distinct from 'verified' then
      raise exception 'ออกใบเสร็จได้เฉพาะการชำระที่ตรวจสอบแล้ว';
    end if;
    new.amount := v_amount;
    return new;
  end if;
  if current_user = 'authenticated' then
    raise exception 'ใบเสร็จแก้ไขหรือลบไม่ได้ (ผู้ดูแลระบบยกเลิกใบเสร็จได้ที่หน้าตรวจการชำระเงิน)';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists receipts_10_guard on public.receipts;
create trigger receipts_10_guard
  before insert or update or delete on public.receipts
  for each row execute function private.receipts_guard();


-- ---------------------------------------------------------------------
-- 6) ใบแจ้งหนี้ (แทนที่ฟังก์ชันของ migration 006)
--    - ยกเลิก = จบ · ชำระแล้วยกเลิกไม่ได้
--    - สถานะ ชำระแล้ว/รอชำระ ต้องตรงกับยอดที่ตรวจแล้ว (ระบบปรับให้เองเมื่อตรวจ/ยกเลิกใบเสร็จ)
--    - ยกเลิกใบที่มีการชำระที่ตรวจแล้ว หรือมีการแจ้งชำระรอตรวจ ไม่ได้
--    - เจ้าหน้าที่แก้ยอด/สัญญา/รอบบิลในใบไม่ได้ (ยกเลิกแล้วออกใหม่) · แก้วันครบกำหนดได้
-- ---------------------------------------------------------------------
create or replace function private.invoices_guard_status()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_total   numeric := new.rent_amount + new.water_amount + new.electricity_amount + new.fee_amount;
  v_paid    numeric;
  v_pending int;
begin
  if current_user = 'authenticated'
     and (new.contract_id, new.billing_period, new.rent_amount, new.water_amount, new.electricity_amount, new.fee_amount)
         is distinct from (old.contract_id, old.billing_period, old.rent_amount, old.water_amount, old.electricity_amount, old.fee_amount) then
    raise exception 'แก้ยอดหรือรอบบิลในใบแจ้งหนี้ไม่ได้ — ยกเลิกใบนี้แล้วออกใบใหม่';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'cancelled' then
      raise exception 'ใบแจ้งหนี้ที่ยกเลิกแล้วเปลี่ยนสถานะไม่ได้ (ให้ออกใบใหม่แทน)';
    elsif old.status = 'paid' and new.status = 'cancelled' then
      raise exception 'ใบแจ้งหนี้ที่ชำระแล้วยกเลิกไม่ได้';
    end if;
    v_paid := private.invoice_paid_amount(new.invoice_id);
    if new.status = 'paid' and v_paid < v_total then
      raise exception 'ยอดที่ชำระแล้ว % บาท ยังไม่ครบยอดใบแจ้งหนี้ % บาท — บันทึกการชำระแทนการเปลี่ยนสถานะเอง',
        private.baht(v_paid), private.baht(v_total);
    elsif new.status = 'unpaid' and v_paid >= v_total then
      raise exception 'ใบแจ้งหนี้นี้ชำระครบแล้ว เปลี่ยนเป็นรอชำระไม่ได้ (ยกเลิกใบเสร็จก่อน)';
    elsif new.status = 'cancelled' then
      if v_paid > 0 then
        raise exception 'ใบแจ้งหนี้นี้มีการชำระที่ตรวจแล้ว % บาท ยกเลิกไม่ได้ (ยกเลิกใบเสร็จก่อน)', private.baht(v_paid);
      end if;
      select count(*) into v_pending from public.payments p where p.invoice_id = new.invoice_id and p.status = 'pending';
      if v_pending > 0 then
        raise exception 'ใบแจ้งหนี้นี้มีการแจ้งชำระรอตรวจสอบ % รายการ — ตรวจหรือปฏิเสธก่อนยกเลิกใบ', v_pending;
      end if;
    end if;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 7) ฟังก์ชันที่หน้าเว็บเรียก (สิทธิ์ตาม RLS ของผู้เรียก)
-- ---------------------------------------------------------------------

-- ตรวจผ่าน (แก้ยอดเป็นยอดที่ได้รับจริงได้) → คืนเลขใบเสร็จ
-- supabase.rpc('verify_payment', { p_payment_id: 12, p_amount: 585 })
create or replace function public.verify_payment(p_payment_id int, p_amount numeric default null)
returns text language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_no     text;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    raise exception 'เฉพาะเจ้าหน้าที่เท่านั้นที่ตรวจการชำระได้' using errcode = '42501';
  end if;
  select p.status into v_status from public.payments p where p.payment_id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบการชำระนี้';
  elsif v_status <> 'pending' then
    raise exception 'การชำระนี้ตรวจไปแล้ว (สถานะ: %)', private.payment_status_th(v_status);
  end if;
  if p_amount is not null and p_amount <= 0 then
    raise exception 'ยอดเงินต้องมากกว่า 0';
  end if;
  update public.payments
  set status = 'verified', amount = coalesce(p_amount, amount)
  where payment_id = p_payment_id;
  select r.receipt_no into v_no from public.receipts r where r.payment_id = p_payment_id;
  return v_no;
end $$;

-- ไม่ผ่าน (ต้องมีเหตุผล — ผู้เช่าเห็นทาง LINE)
-- supabase.rpc('reject_payment', { p_payment_id: 12, p_reason: 'ยอดในสลิปไม่ตรง' })
create or replace function public.reject_payment(p_payment_id int, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare
  v_status text;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    raise exception 'เฉพาะเจ้าหน้าที่เท่านั้นที่ตรวจการชำระได้' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'กรุณาระบุเหตุผลที่ไม่ผ่าน';
  elsif char_length(p_reason) > 500 then
    raise exception 'เหตุผลยาวเกิน 500 ตัวอักษร';
  end if;
  select p.status into v_status from public.payments p where p.payment_id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบการชำระนี้';
  elsif v_status <> 'pending' then
    raise exception 'การชำระนี้ตรวจไปแล้ว (สถานะ: %)', private.payment_status_th(v_status);
  end if;
  update public.payments set status = 'rejected', note = btrim(p_reason) where payment_id = p_payment_id;
end $$;

-- รับชำระที่สำนักงาน (เงินสด/โอน) → ตรวจแล้วทันที + ใบเสร็จ (คืน payment_id, receipt_id, receipt_no)
-- supabase.rpc('record_payment', { p_invoice_id: 3, p_amount: 585, p_method: 'cash' })
create or replace function public.record_payment(
  p_invoice_id int, p_amount numeric, p_method text,
  p_payment_date date default null, p_transaction_ref text default null,
  p_slip_image text default null, p_note text default null
) returns table (payment_id int, receipt_id int, receipt_no text)
language plpgsql set search_path = '' as $$
#variable_conflict use_column
declare
  v_id int;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    raise exception 'เฉพาะเจ้าหน้าที่เท่านั้นที่รับชำระได้' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'ยอดเงินต้องมากกว่า 0';
  end if;
  insert into public.payments (invoice_id, payment_date, amount, payment_method, transaction_ref, slip_image, note, status)
  values (p_invoice_id, coalesce(p_payment_date, private.today_th()), p_amount, p_method,
          nullif(btrim(p_transaction_ref), ''), nullif(p_slip_image, ''), nullif(btrim(p_note), ''), 'verified')
  returning payments.payment_id into v_id;
  return query select v_id, r.receipt_id, r.receipt_no::text from public.receipts r where r.payment_id = v_id;
end $$;

-- ยกเลิกใบเสร็จ (ผู้ดูแลระบบ) → การชำระเป็น "ไม่ผ่าน" ใบเสร็จยังอยู่ ใบแจ้งหนี้กลับเป็นรอชำระ
-- supabase.rpc('void_payment', { p_payment_id: 12, p_reason: 'บันทึกยอดผิด' })
create or replace function public.void_payment(p_payment_id int, p_reason text)
returns void language plpgsql set search_path = '' as $$
declare
  v_status text;
  v_no     text;
  v_by     text;
begin
  if current_user = 'authenticated' and not private.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่ยกเลิกใบเสร็จได้' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิกใบเสร็จ';
  elsif char_length(p_reason) > 400 then
    raise exception 'เหตุผลยาวเกิน 400 ตัวอักษร';
  end if;
  select p.status into v_status from public.payments p where p.payment_id = p_payment_id for update;
  if not found then
    raise exception 'ไม่พบการชำระนี้';
  elsif v_status <> 'verified' then
    raise exception 'ยกเลิกได้เฉพาะการชำระที่ตรวจแล้ว (สถานะ: %)', private.payment_status_th(v_status);
  end if;
  select r.receipt_no into v_no from public.receipts r where r.payment_id = p_payment_id;
  select u.full_name into v_by from public.users u where u.user_id = auth.uid();
  update public.payments
  set status = 'rejected',
      note = concat_ws(E'\n', nullif(note, ''),
               format('ยกเลิกใบเสร็จ %s: %s (โดย %s %s)', coalesce(v_no, '-'), btrim(p_reason),
                      coalesce(v_by, 'ผู้ดูแลระบบ'), to_char(private.today_th(), 'DD/MM/') || private.be_year(private.today_th())))
  where payment_id = p_payment_id;
end $$;


-- ---------------------------------------------------------------------
-- 8) สิทธิ์ของฟังก์ชัน
-- ---------------------------------------------------------------------
revoke execute on function private.invoice_paid_amount(int), private.payment_status_th(text), private.baht(numeric),
  private.sync_invoice_paid(int) from public;
grant execute on function private.invoice_paid_amount(int), private.payment_status_th(text), private.baht(numeric)
  to authenticated, service_role;

revoke execute on function public.verify_payment(int, numeric), public.reject_payment(int, text),
  public.record_payment(int, numeric, text, date, text, text, text), public.void_payment(int, text) from public, anon;
grant execute on function public.verify_payment(int, numeric), public.reject_payment(int, text),
  public.record_payment(int, numeric, text, date, text, text, text), public.void_payment(int, text)
  to authenticated, service_role;
