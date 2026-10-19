// ที่อยู่เว็บไซต์ของระบบ (ใช้ทำ QR เข้าเว็บ) — เปลี่ยนโดเมนได้ด้วย VITE_SITE_URL ในไฟล์ .env / Vercel
export const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://local-market-rent.vercel.app').replace(/\/+$/, '')

// รูป QR สำเร็จรูปใน web/public/qr (ทำจาก https://local-market-rent.vercel.app)
export const SITE_QR_FILES = { png: '/qr/local-market-rent-qr.png', svg: '/qr/local-market-rent-qr.svg' }
export const SITE_QR_MATCHES = SITE_URL === 'https://local-market-rent.vercel.app'
