import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { isSupabaseConfigured } from './lib/supabase'
import { AuthProvider } from './auth/AuthProvider'
import RequireStaff from './auth/RequireStaff'
import LoginPage from './pages/LoginPage'
import SetupNeeded from './pages/SetupNeeded'
import AdminLayout from './pages/admin/AdminLayout'
import FullPageMessage from './components/FullPageMessage'
import LoadingScreen from './components/LoadingScreen'

// แต่ละหน้าโหลดแยกไฟล์เมื่อเปิด: ผู้เช่าที่เปิดผ่าน LINE บนมือถือไม่ต้องโหลดหน้าของเจ้าหน้าที่ และกลับกัน
const LiffApp = lazy(() => import('./pages/liff/LiffApp'))
const DashboardPage = lazy(() => import('./pages/admin/DashboardPage'))
const UpcomingPage = lazy(() => import('./pages/admin/UpcomingPage'))
const StallsPage = lazy(() => import('./pages/admin/StallsPage'))
const TenantsPage = lazy(() => import('./pages/admin/TenantsPage'))
const MarketsPage = lazy(() => import('./pages/admin/MarketsPage'))
const UsersPage = lazy(() => import('./pages/admin/UsersPage'))
const ContractsPage = lazy(() => import('./pages/admin/ContractsPage'))
const MeterReadingsPage = lazy(() => import('./pages/admin/MeterReadingsPage'))
const InvoicesPage = lazy(() => import('./pages/admin/InvoicesPage'))
const PaymentsPage = lazy(() => import('./pages/admin/PaymentsPage'))
const InvoicePrint = lazy(() => import('./pages/print/InvoicePrint'))
const ReceiptPrint = lazy(() => import('./pages/print/ReceiptPrint'))
const LiffPosterPrint = lazy(() => import('./pages/print/LiffPosterPrint'))

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
        <Suspense fallback={<LoadingScreen />}>
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
          <Route
            path="/print/liff-poster"
            element={
              <RequireStaff>
                <LiffPosterPrint />
              </RequireStaff>
            }
          />
          <Route path="/liff/*" element={<LiffApp />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  )
}
