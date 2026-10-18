import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

// ยังไม่ได้สร้างไฟล์ .env หรือยังเป็นค่าตัวอย่าง → หน้าเว็บจะแสดงวิธีตั้งค่าแทน
export const isSupabaseConfigured =
  Boolean(url && key) && !url.includes('xxxxxxxx') && !key.includes('xxxxxxxx')

/** ที่อยู่ของ Edge Function (ใช้บอกผู้ใช้ให้เปิดตรวจเองเมื่อเรียกไม่ได้) */
export const functionUrl = (name) => `${(url ?? '').replace(/\/+$/, '')}/functions/v1/${name}`

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null
