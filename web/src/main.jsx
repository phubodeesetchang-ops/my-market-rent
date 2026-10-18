import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// หลัง deploy เวอร์ชันใหม่ ไฟล์หน้าเดิมจะหายไป → ผู้ที่เปิดค้างไว้จะโหลดหน้าถัดไปไม่ได้ ให้รีเฟรชหน้าเอง (ครั้งเดียว)
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('reloadedAfterDeploy')) return
    sessionStorage.setItem('reloadedAfterDeploy', '1')
  } catch {
    return
  }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
