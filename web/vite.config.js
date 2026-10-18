import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
  // ไฟล์หลัก (React + Router + supabase-js) ~500 kB ก่อนบีบอัด (~145 kB เมื่อส่งจริง) — หน้าต่าง ๆ แยกไฟล์โหลดเมื่อเปิดแล้ว
  build: { chunkSizeWarningLimit: 600 },
})
