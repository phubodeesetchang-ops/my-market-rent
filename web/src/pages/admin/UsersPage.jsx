import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { compareThai, formatDate, formatPhone } from '../../lib/format'
import { ROLE } from '../../lib/labels'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import Modal, { DetailRows, ModalSection } from '../../components/ui/Modal'
import { ActiveBadge, Badge, DataTable, LoadError, Notice, PageHeader, Td, Th } from '../../components/ui/feedback'
import { Button } from '../../components/ui/form'
import { PasswordDialog, UserCreateDialog, UserEditDialog } from '../../components/users/UserDialogs'

const ROLE_ORDER = { admin: 0, staff: 1, manager: 2 }

async function fetchUsers() {
  const { data, error } = await supabase.from('users').select('user_id, username, full_name, role, phone, email, status, created_at')
  if (error) throw error
  return data.sort(
    (a, b) =>
      (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1) ||
      ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
      compareThai(a.full_name, b.full_name),
  )
}

/** แสดงอีเมล + รหัสผ่านครั้งเดียวหลังสร้างบัญชี/ตั้งรหัสใหม่ ให้ผู้ดูแลคัดลอกไปแจ้งเจ้าของบัญชี */
function CredentialsDialog({ info, onClose }) {
  const [copied, setCopied] = useState(false)
  const text = `อีเมล: ${info.email}\nรหัสผ่าน: ${info.password}`

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Modal
      title={info.title}
      subtitle={info.name}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={copy}>{copied ? 'คัดลอกแล้ว' : 'คัดลอกอีเมลและรหัสผ่าน'}</Button>
          <Button variant="primary" onClick={onClose}>
            เสร็จแล้ว
          </Button>
        </div>
      }
    >
      <ModalSection>
        <DetailRows
          rows={[
            { label: 'อีเมล', value: <span className="font-mono">{info.email}</span> },
            { label: 'รหัสผ่าน', value: <span className="font-mono text-lg font-semibold tracking-wide">{info.password}</span> },
          ]}
        />
        <p className="mt-3 text-sm text-muted">รหัสผ่านนี้จะไม่แสดงอีก แจ้งเจ้าของบัญชีเป็นการส่วนตัว (ไม่ส่งในกลุ่มแชท)</p>
      </ModalSection>
    </Modal>
  )
}

export default function UsersPage() {
  const { profile, refreshProfile } = useAuth()
  const { data: users, error, loading, reload } = useLoader(fetchUsers)
  const [dialog, setDialog] = useState(null) // { type: 'new' | 'edit' | 'password' | 'credentials', user?, info? }
  const [notice, setNotice] = useState(null)

  function done(text, next = null) {
    if (text) setNotice({ tone: 'ok', text })
    setDialog(next)
    reload()
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ผู้ใช้ระบบ"
        description="บัญชีเจ้าหน้าที่ที่เข้าสู่ระบบด้วยอีเมลและรหัสผ่าน (ผู้เช่าใช้งานผ่าน LINE ไม่ต้องมีบัญชีที่นี่)"
        actions={
          <Button variant="primary" size="md" onClick={() => setDialog({ type: 'new' })}>
            + เพิ่มผู้ใช้
          </Button>
        }
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {error && <LoadError what="รายชื่อผู้ใช้" message={error} onRetry={reload} />}
      {!users && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดรายชื่อผู้ใช้…</p>}

      {users && (
        <>
          <p className="mt-6 mb-2 text-sm text-muted" aria-live="polite">
            ทั้งหมด {users.length} บัญชี{loading && ' · กำลังโหลดใหม่…'}
          </p>
          {/* มือถือ: การ์ด */}
          <ul className="divide-y divide-line rounded-xl border border-line sm:hidden" aria-label="รายชื่อผู้ใช้ระบบ">
            {users.map((u) => {
              const isSelf = u.user_id === profile?.user_id
              return (
                <li key={u.user_id} className={`px-4 py-3 ${u.status === 'active' ? '' : 'bg-leaf-50/60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">
                        {u.full_name}
                        {isSelf && <span className="font-normal text-muted"> (คุณ)</span>}
                      </p>
                      <p className="truncate text-sm text-muted">{u.email ?? '-'}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Badge tone={u.role === 'admin' ? 'solid' : u.role === 'staff' ? 'green' : 'outline'}>{ROLE[u.role]}</Badge>
                      {u.status !== 'active' && <ActiveBadge status={u.status} />}
                    </div>
                  </div>
                  <p className="mt-0.5 text-sm text-muted">
                    {u.username} · {u.phone ? `${formatPhone(u.phone)} · ` : ''}เพิ่มเมื่อ {formatDate(u.created_at)}
                  </p>
                  <div className="-ml-3 mt-1 flex flex-wrap gap-1">
                    <Button variant="ghost" onClick={() => setDialog({ type: 'edit', user: u })}>
                      แก้ไข
                    </Button>
                    <Button variant="ghost" onClick={() => setDialog({ type: 'password', user: u })}>
                      ตั้งรหัสผ่านใหม่
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
          <DataTable label="รายชื่อผู้ใช้ระบบ" className="hidden sm:block">
            <thead>
              <tr>
                <Th>ชื่อ</Th>
                <Th>อีเมล</Th>
                <Th>บทบาท</Th>
                <Th>เบอร์โทร</Th>
                <Th>สถานะ</Th>
                <Th className="text-right">จัดการ</Th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = u.user_id === profile?.user_id
                return (
                  <tr key={u.user_id} className={u.status === 'active' ? '' : 'bg-leaf-50/60'}>
                    <Td>
                      <p className="font-medium text-ink">
                        {u.full_name}
                        {isSelf && <span className="font-normal text-muted"> (คุณ)</span>}
                      </p>
                      <p className="text-sm text-muted">
                        {u.username} · เพิ่มเมื่อ {formatDate(u.created_at)}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap">{u.email ?? '-'}</Td>
                    <Td>
                      <Badge tone={u.role === 'admin' ? 'solid' : u.role === 'staff' ? 'green' : 'outline'}>{ROLE[u.role]}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{formatPhone(u.phone)}</Td>
                    <Td>
                      <ActiveBadge status={u.status} />
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <Button variant="ghost" onClick={() => setDialog({ type: 'edit', user: u })}>
                        แก้ไข
                      </Button>
                      <Button variant="ghost" onClick={() => setDialog({ type: 'password', user: u })}>
                        ตั้งรหัสผ่านใหม่
                      </Button>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
          <p className="mt-3 text-sm text-muted">
            ระบบไม่ลบบัญชีเจ้าหน้าที่ เพื่อเก็บประวัติว่าใครทำรายการอะไร ให้ใช้ &ldquo;ระงับ&rdquo; ในหน้าแก้ไขแทน
          </p>
        </>
      )}

      {dialog?.type === 'new' && (
        <UserCreateDialog
          onClose={() => setDialog(null)}
          onSaved={(info) => done(`สร้างบัญชี ${info.name} แล้ว`, { type: 'credentials', info: { ...info, title: 'สร้างบัญชีแล้ว' } })}
        />
      )}
      {dialog?.type === 'edit' && (
        <UserEditDialog
          user={dialog.user}
          isSelf={dialog.user.user_id === profile?.user_id}
          onClose={() => setDialog(null)}
          onSaved={(text) => {
            if (dialog.user.user_id === profile?.user_id) refreshProfile()
            done(text)
          }}
        />
      )}
      {dialog?.type === 'password' && (
        <PasswordDialog
          user={dialog.user}
          onClose={() => setDialog(null)}
          onSaved={(info) => done(`ตั้งรหัสผ่านใหม่ให้ ${info.name} แล้ว`, { type: 'credentials', info: { ...info, title: 'ตั้งรหัสผ่านใหม่แล้ว' } })}
        />
      )}
      {dialog?.type === 'credentials' && <CredentialsDialog info={dialog.info} onClose={() => setDialog(null)} />}
    </div>
  )
}
