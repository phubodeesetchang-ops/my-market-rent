import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthProvider } from './auth/AuthProvider'
import RequireStaff from './auth/RequireStaff'
import LoginPage from './pages/LoginPage'
import SetupNeeded from './pages/SetupNeeded'
import AdminLayout from './pages/admin/AdminLayout'
import DashboardPage from './pages/admin/DashboardPage'
import UpcomingPage from './pages/admin/UpcomingPage'
import StallsPage from './pages/admin/StallsPage'
import TenantsPage from './pages/admin/TenantsPage'
import MarketsPage from './pages/admin/MarketsPage'
import UsersPage from './pages/admin/UsersPage'
import ContractsPage from './pages/admin/ContractsPage'
import MeterReadingsPage from './pages/admin/MeterReadingsPage'
import InvoicesPage from './pages/admin/InvoicesPage'
import PaymentsPage from './pages/admin/PaymentsPage'
import InvoicePrint from './pages/print/InvoicePrint'
import ReceiptPrint from './pages/print/ReceiptPrint'
import LiffHome from './pages/liff/LiffHome'
import FullPageMessage from './components/FullPageMessage'

// หน้าที่จะทำในขั้นถัด ๆ ไป
const UPCOMING = [
  { path: 'reports', title: 'รายงาน', step: 9, detail: 'รายรับรายวัน/รายเดือน อัตราแผงว่าง และผู้ค้างชำระ' },
]

function NotFound() {
  return (
    <FullPageMessage title="ไม่พบหน้านี้" body="ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายไปแล้ว">
      <Link to="/admin" className="font-medium text-leaf-700 hover:underline">
        ไปหน้าภาพรวม
      </Link>
    </FullPageMessage>
  )
}

export default function App() {
  if (!isSupabaseConfigured) return <SetupNeeded />

  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/admin" replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/admin"
            element={
              <RequireStaff>
                <AdminLayout />
              </RequireStaff>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="contracts" element={<ContractsPage />} />
            <Route path="readings" element={<MeterReadingsPage />} />
            <Route path="invoices" element={<InvoicesPage />} />
            <Route path="payments" element={<PaymentsPage />} />
            <Route path="stalls" element={<StallsPage />} />
            <Route path="tenants" element={<TenantsPage />} />
            <Route path="markets" element={<MarketsPage />} />
            {UPCOMING.map((p) => (
              <Route key={p.path} path={p.path} element={<UpcomingPage {...p} />} />
            ))}
            <Route
              path="users"
              element={
                <RequireStaff roles={['admin']}>
                  <UsersPage />
                </RequireStaff>
              }
            />
          </Route>
          <Route
            path="/print/invoice/:id"
            element={
              <RequireStaff>
                <InvoicePrint />
              </RequireStaff>
            }
          />
          <Route
            path="/print/receipt/:id"
            element={
              <RequireStaff>
                <ReceiptPrint />
              </RequireStaff>
            }
          />
          <Route path="/liff/*" element={<LiffHome />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
