import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { thaiError } from '../lib/errors'
import FullPageMessage from '../components/FullPageMessage'

const PROBLEM_TEXT = {
  'not-officer': {
    title: 'บัญชีนี้ไม่ใช่บัญชีเจ้าหน้าที่',
    body: (
      <>
        <p>ถ้าคุณเป็นผู้เช่าแผง ให้เข้าใช้งานผ่าน LINE ของตลาด</p>
        <p>
          ถ้าเป็น<span className="whitespace-nowrap">เจ้าหน้าที่</span> ให้ผู้ดูแลระบบเพิ่มบัญชีของคุณในเมนู
          <span className="whitespace-nowrap">ผู้ใช้ระบบ</span>
        </p>
      </>
    ),
  },
  inactive: {
    title: 'บัญชีนี้ถูกระงับการใช้งาน',
    body: 'ติดต่อผู้ดูแลระบบเพื่อเปิดใช้งานบัญชีอีกครั้ง',
  },
}

/**
 * ครอบหน้าที่ต้องเป็นเจ้าหน้าที่เท่านั้น
 * roles: จำกัดเฉพาะบางบทบาท เช่น ['admin'] (ไม่ระบุ = เจ้าหน้าที่ทุกบทบาท)
 */
export default function RequireStaff({ roles, children }) {
  const { session, role, checking, accessProblem, profileError, signOut } = useAuth()
  const location = useLocation()

  if (checking) {
    return <FullPageMessage title="กำลังตรวจสอบสิทธิ์" />
  }
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  if (accessProblem) {
    const text = PROBLEM_TEXT[accessProblem] ?? {
      title: 'ตรวจสอบสิทธิ์ไม่สำเร็จ',
      body: thaiError(profileError),
    }
    return (
      <FullPageMessage title={text.title} body={text.body}>
        <button
          type="button"
          onClick={signOut}
          className="rounded-lg border border-leaf-300 bg-white px-4 py-2 font-medium text-leaf-800 hover:bg-leaf-100"
        >
          ออกจากระบบ
        </button>
      </FullPageMessage>
    )
  }
  if (roles && !roles.includes(role)) {
    return <Navigate to="/admin" replace />
  }
  return children
}
