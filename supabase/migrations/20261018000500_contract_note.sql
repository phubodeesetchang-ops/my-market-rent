-- =====================================================================
--  ระบบบริหารจัดการแผงค้าและจัดเก็บค่าเช่าตลาดท้องถิ่น
--  Migration 005 : สัญญาเช่า (ขั้นที่ 5)
--
--  1) เพิ่มคอลัมน์ contracts.note 1 คอลัมน์ (ผู้ใช้อนุมัติให้เพิ่มแล้ว)
--  ใช้เก็บ: เหตุผลที่ไม่อนุมัติ / เหตุผลที่ยกเลิก / หมายเหตุอื่นของสัญญา
--  ผู้เช่าใส่ได้ตอนส่งคำขอเช่า (เช่น สินค้าที่จะขาย) และเห็นหมายเหตุของสัญญาตัวเอง
--
--  2) ต่ออายุซ้ำได้หลังคำขอต่ออายุถูกไม่อนุมัติ/ยกเลิก (เปลี่ยน unique ของ renewed_from_id)
--
--  ไม่แตะข้อมูลเดิม (คอลัมน์ใหม่เว้นว่างได้) · รันซ้ำได้ · รันต่อจาก migration 001–004
-- =====================================================================

alter table public.contracts
  add column if not exists note text;

alter table public.contracts
  drop constraint if exists contracts_note_length;
alter table public.contracts
  add constraint contracts_note_length check (note is null or char_length(note) <= 500);

comment on column public.contracts.note is
  'หมายเหตุของสัญญา เช่น เหตุผลที่ไม่อนุมัติ/ยกเลิก (ไม่เกิน 500 ตัวอักษร)';


-- ---------------------------------------------------------------------
-- สัญญาหนึ่งมี "สัญญาต่ออายุ" ที่ยังมีผลได้ฉบับเดียว (ผู้ใช้อนุมัติให้แก้แล้ว)
-- เดิม renewed_from_id เป็น UNIQUE ทั้งคอลัมน์ ทำให้คำขอต่ออายุที่ถูกไม่อนุมัติ/ยกเลิก
-- กันไม่ให้ส่งคำขอต่ออายุใหม่ได้อีกเลย → เปลี่ยนเป็นนับเฉพาะ รออนุมัติ / ใช้งาน / สิ้นสุด
-- ---------------------------------------------------------------------
alter table public.contracts
  drop constraint if exists contracts_renewed_from_id_key;

create unique index if not exists contracts_one_renewal_per_contract
  on public.contracts (renewed_from_id)
  where renewed_from_id is not null and status in ('pending', 'active', 'expired');

comment on index public.contracts_one_renewal_per_contract is
  'สัญญาหนึ่งมีสัญญาต่ออายุที่ยังมีผล (รออนุมัติ/ใช้งาน/สิ้นสุด) ได้ฉบับเดียว — ฉบับที่ไม่อนุมัติ/ยกเลิกไม่นับ';
