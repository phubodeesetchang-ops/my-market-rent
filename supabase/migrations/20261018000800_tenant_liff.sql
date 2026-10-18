-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 008 : หน้าผู้เช่าผ่าน LINE (ขั้นที่ 8)
--
--  ไม่เพิ่ม/ลบตารางหรือคอลัมน์ — ปรับกติกาสำหรับผู้เช่าที่เข้าใช้งานเองผ่าน LINE
--   1) ผู้เช่าแก้ข้อมูลตัวเองได้เฉพาะ เบอร์โทร ที่อยู่ ชื่อร้าน
--      (ชื่อ-นามสกุล เลขบัตร สถานะ บัญชี LINE ต้องให้สำนักงานแก้)
--   2) คำขอเช่าจากผู้เช่า: รออนุมัติได้พร้อมกันไม่เกิน 3 แผง
--      และวันเริ่มต้องไม่ย้อนหลัง ไม่เกิน 1 ปีข้างหน้า (กันจองแผงทิ้งไว้)
--
--  การผูกบัญชี LINE กับข้อมูลผู้เช่าทำใน Edge Function line-auth (ตรวจ ID token กับ LINE ก่อนเสมอ)
--  รันซ้ำได้ · รันต่อจาก migration 001–007
-- =====================================================================


-- 1) ผู้เช่าแก้ข้อมูลตัวเอง (แทนที่ฟังก์ชันของ migration 002)
create or replace function private.tenants_guard_self_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and not private.is_staff() then
    if new.status is distinct from old.status
       or new.line_user_id is distinct from old.line_user_id
       or new.auth_id is distinct from old.auth_id then
      raise exception 'ผู้เช่าแก้ไขสถานะหรือบัญชี LINE เองไม่ได้' using errcode = '42501';
    end if;
    if (to_jsonb(new) - 'phone' - 'address' - 'business_name')
       is distinct from (to_jsonb(old) - 'phone' - 'address' - 'business_name') then
      raise exception 'ผู้เช่าแก้ไขได้เฉพาะเบอร์โทร ที่อยู่ และชื่อร้าน (ชื่อหรือเลขบัตรผิด ติดต่อสำนักงาน)' using errcode = '42501';
    end if;
    if coalesce(btrim(new.phone), '') = '' then
      raise exception 'กรุณากรอกเบอร์โทร';
    end if;
  end if;
  return new;
end $$;


-- 2) คำขอเช่าจากผู้เช่า (ทำงานหลัง contracts_10_before_insert ซึ่งกำหนดผู้เช่า/สถานะให้แล้ว)
create or replace function private.contracts_tenant_request_rules()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_pending int;
begin
  if current_user = 'authenticated' and not private.is_staff() then
    if new.start_date < private.today_th() then
      raise exception 'วันเริ่มเช่าต้องไม่ย้อนหลัง';
    elsif new.start_date > private.today_th() + 365 then
      raise exception 'ขอเช่าล่วงหน้าได้ไม่เกิน 1 ปี';
    end if;
    select count(*) into v_pending from public.contracts c
    where c.tenant_id = new.tenant_id and c.status = 'pending';
    if v_pending >= 3 then
      raise exception 'มีคำขอเช่ารออนุมัติอยู่ % แผงแล้ว รอเจ้าหน้าที่พิจารณาก่อน หรือยกเลิกคำขอเดิม', v_pending;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists contracts_15_tenant_request_rules on public.contracts;
create trigger contracts_15_tenant_request_rules
  before insert on public.contracts
  for each row execute function private.contracts_tenant_request_rules();
