-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 004 : เครื่องมือสำหรับหน้าจัดการข้อมูลหลัก (ขั้นที่ 4)
--
--  1) change_utility_rate()  เปลี่ยนอัตราค่าน้ำ-ไฟ: ปิดอัตราเดิม + เปิดอัตราใหม่ในคำสั่งเดียว
--  2) กันไม่ให้ไม่เหลือผู้ดูแลระบบ (admin) ที่ใช้งานได้
--
--  ไม่เพิ่ม/ลบตารางหรือคอลัมน์ · รันต่อจาก migration 001–003
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) เปลี่ยนอัตราค่าน้ำ-ไฟ
--    อัตราเดิมที่ยังใช้อยู่จะสิ้นสุดวันก่อน p_effective_from แล้วเพิ่มอัตราใหม่
--    ทำในฟังก์ชันเดียว ถ้าพลาดตรงไหนจะไม่มีอะไรถูกแก้ (ไม่ค้างครึ่งทาง)
--    เรียกจากหน้าเว็บ: supabase.rpc('change_utility_rate', { p_market_id, p_utility_type, p_rate, p_effective_from })
--    สิทธิ์: เฉพาะ admin (ตรวจทั้งในฟังก์ชันและ RLS ของ utility_rates)
-- ---------------------------------------------------------------------
create or replace function public.change_utility_rate(
  p_market_id      int,
  p_utility_type   text,
  p_rate           numeric,
  p_effective_from date
) returns int
language plpgsql set search_path = '' as $$
declare
  v_current record;
  v_new_id  int;
begin
  if current_user = 'authenticated' and not private.is_admin() then
    raise exception 'เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนอัตราได้' using errcode = '42501';
  end if;
  if p_rate is null or p_rate <= 0 then
    raise exception 'อัตราต่อหน่วยต้องมากกว่า 0';
  end if;
  if p_effective_from is null then
    raise exception 'กรุณาระบุวันที่เริ่มใช้อัตราใหม่';
  end if;

  -- อัตราที่ยังใช้อยู่ ณ วันเริ่มอัตราใหม่ (หรือยังไม่มีวันสิ้นสุด)
  select r.rate_id, r.effective_from, r.rate_per_unit into v_current
  from public.utility_rates r
  where r.market_id = p_market_id
    and r.utility_type = p_utility_type
    and r.status = 'active'
    and (r.effective_to is null or r.effective_to >= p_effective_from)
  order by r.effective_from desc
  limit 1;

  if found then
    if v_current.effective_from >= p_effective_from then
      raise exception 'วันเริ่มใช้อัตราใหม่ต้องอยู่หลังวันเริ่มของอัตราปัจจุบัน (%)', v_current.effective_from;
    end if;
    update public.utility_rates
    set effective_to = p_effective_from - 1
    where rate_id = v_current.rate_id;
  end if;

  insert into public.utility_rates (market_id, utility_type, rate_per_unit, effective_from)
  values (p_market_id, p_utility_type, p_rate, p_effective_from)
  returning rate_id into v_new_id;

  return v_new_id;
end $$;

comment on function public.change_utility_rate(int, text, numeric, date) is
  'เปลี่ยนอัตราค่าน้ำ/ไฟของตลาด: ปิดอัตราเดิมวันก่อนวันเริ่มใหม่ แล้วเพิ่มอัตราใหม่ (เฉพาะ admin)';

revoke execute on function public.change_utility_rate(int, text, numeric, date) from public, anon;
grant  execute on function public.change_utility_rate(int, text, numeric, date) to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 2) ต้องเหลือผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คนเสมอ
--    (กันแอดมินลดสิทธิ์/ระงับ/ลบตัวเองหรือคนสุดท้าย จนไม่มีใครเข้าจัดการระบบได้)
-- ---------------------------------------------------------------------
create or replace function private.users_keep_one_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'admin' or new.status <> 'active')
     and not exists (
       select 1 from public.users u
       where u.user_id <> old.user_id and u.role = 'admin' and u.status = 'active'
     ) then
    raise exception 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน จึงเปลี่ยนบทบาท/ระงับ/ลบบัญชีนี้ไม่ได้';
  end if;
  return coalesce(new, old);
end $$;

revoke execute on function private.users_keep_one_admin() from public;

create trigger users_10_keep_one_admin
  before update or delete on public.users
  for each row execute function private.users_keep_one_admin();
