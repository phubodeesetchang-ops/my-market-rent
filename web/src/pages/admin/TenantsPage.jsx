import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { compareThai, formatNumber, formatPhone } from '../../lib/format'
import { stallPlace } from '../../lib/stalls'
import { digitsOnly } from '../../lib/validate'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { ActiveBadge, Badge, DataTable, EmptyBox, LoadError, Notice, PageHeader, Td, Th } from '../../components/ui/feedback'
import { Button, SelectInput, TextInput } from '../../components/ui/form'
import TenantDialog from '../../components/tenants/TenantDialog'
import TenantFormDialog from '../../components/tenants/TenantFormDialog'

// ห้ามใช้ select('*') กับ tenants (คอลัมน์ id_card ถูกปิดไม่ให้อ่านผ่าน API)
const TENANT_COLUMNS = 'tenant_id, full_name, business_name, phone, address, line_user_id, status, created_at'
const CONTRACT_COLUMNS =
  'contract_id, contract_no, status, start_date, end_date, rent_amount, rent_period, stalls(stall_id, stall_code, unit_type, zones(zone_name, markets(market_name)))'

async function fetchTenants() {
  const { data, error } = await supabase.from('tenants').select(`${TENANT_COLUMNS}, contracts(${CONTRACT_COLUMNS})`)
  if (error) throw error
  return data.sort((a, b) => compareThai(a.full_name, b.full_name))
}

const isLive = (c) => c.status === 'active' || c.status === 'pending'

/** ค้นจากชื่อ ชื่อร้าน เบอร์โทร (ตัวเลขอย่างน้อย 3 ตัว) หรือรหัสแผงที่เช่าอยู่ */
function matches(t, query) {
  const text = query.trim().toLowerCase()
  if (!text) return true
  if ([t.full_name, t.business_name].some((v) => v?.toLowerCase().includes(text))) return true
  const digits = digitsOnly(text)
  if (digits.length >= 3 && digitsOnly(t.phone).includes(digits)) return true
  return (t.contracts ?? []).some((c) => isLive(c) && c.stalls?.stall_code?.toLowerCase().includes(text))
}

function CurrentStalls({ contracts }) {
  const live = (contracts ?? []).filter(isLive)
  if (live.length === 0) return <span className="text-muted">-</span>
  return (
    <ul className="space-y-0.5">
      {live.map((c) => (
        <li key={c.contract_id} className="whitespace-nowrap">
          {stallPlace(c.stalls)}
          {c.status === 'pending' && <Badge tone="amber" className="ml-2">รออนุมัติ</Badge>}
        </li>
      ))}
    </ul>
  )
}

export default function TenantsPage() {
  const { role } = useAuth()
  const { data: tenants, error, loading, reload } = useLoader(fetchTenants)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [dialog, setDialog] = useState(null) // { type: 'view' | 'edit' | 'new', id? }
  const [notice, setNotice] = useState(null)

  const canOperate = can(role, 'manageOperations')
  const list = (tenants ?? []).filter((t) => (status === 'all' || t.status === status) && matches(t, query))
  const selected = dialog?.id ? tenants?.find((t) => t.tenant_id === dialog.id) : null

  function done(text, next = null) {
    setNotice({ tone: 'ok', text })
    setDialog(next)
    reload()
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ผู้เช่า"
        description="ข้อมูลผู้เช่าแผงและห้อง ค้นหาจากชื่อ ร้าน เบอร์โทร หรือรหัสแผง"
        actions={
          canOperate && (
            <Button variant="primary" size="md" onClick={() => setDialog({ type: 'new' })}>
              + เพิ่มผู้เช่า
            </Button>
          )
        }
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <TextInput
            type="search"
            aria-label="ค้นหาผู้เช่า"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาชื่อ ร้าน เบอร์โทร หรือรหัสแผง"
          />
        </div>
        <div className="w-40">
          <SelectInput aria-label="สถานะผู้เช่า" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">ทุกสถานะ</option>
            <option value="active">ใช้งาน</option>
            <option value="inactive">ระงับ</option>
          </SelectInput>
        </div>
      </div>

      {error && <LoadError what="รายชื่อผู้เช่า" message={error} onRetry={reload} />}
      {!tenants && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดรายชื่อผู้เช่า…</p>}

      {tenants && (
        <>
          <p className="mt-4 mb-2 text-sm text-muted tabular-nums" aria-live="polite">
            {list.length === tenants.length
              ? `ทั้งหมด ${formatNumber(tenants.length)} ราย`
              : `แสดง ${formatNumber(list.length)} จาก ${formatNumber(tenants.length)} ราย`}
            {loading && ' · กำลังโหลดใหม่…'}
          </p>
          {tenants.length === 0 ? (
            <EmptyBox>ยังไม่มีผู้เช่าในระบบ{canOperate && ' กด "+ เพิ่มผู้เช่า" เพื่อเริ่มต้น'}</EmptyBox>
          ) : list.length === 0 ? (
            <EmptyBox>ไม่พบผู้เช่าที่ตรงกับคำค้น</EmptyBox>
          ) : (
            <>
              {/* มือถือ: รายการแบบซ้อนบรรทัด อ่านได้โดยไม่ต้องเลื่อนซ้าย-ขวา */}
              <ul className="divide-y divide-line rounded-xl border border-line sm:hidden" aria-label="รายชื่อผู้เช่า">
                {list.map((t) => {
                  const live = (t.contracts ?? []).filter(isLive)
                  return (
                    <li key={t.tenant_id}>
                      <button
                        type="button"
                        className="block w-full px-4 py-3 text-left hover:bg-leaf-50"
                        onClick={() => setDialog({ type: 'view', id: t.tenant_id })}
                      >
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block font-medium text-leaf-800">{t.full_name}</span>
                            {t.business_name && <span className="block text-sm text-muted">{t.business_name}</span>}
                          </span>
                          <ActiveBadge status={t.status} />
                        </span>
                        <span className="mt-1 block text-sm text-ink tabular-nums">
                          {formatPhone(t.phone)}
                          {live.map((c) => (
                            <span key={c.contract_id} className="text-muted">
                              {' · '}
                              {stallPlace(c.stalls)}
                              {c.status === 'pending' && ' (รออนุมัติ)'}
                            </span>
                          ))}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <DataTable label="รายชื่อผู้เช่า" className="hidden sm:block">
                <thead>
                  <tr>
                    <Th>ผู้เช่า</Th>
                    <Th>เบอร์โทร</Th>
                    <Th>แผง/ห้องที่เช่า</Th>
                    <Th>LINE</Th>
                    <Th>สถานะ</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((t) => (
                    <tr
                      key={t.tenant_id}
                      className="cursor-pointer hover:bg-leaf-50"
                      onClick={() => setDialog({ type: 'view', id: t.tenant_id })}
                    >
                      <Td>
                        <button
                          type="button"
                          className="text-left font-medium text-leaf-800 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDialog({ type: 'view', id: t.tenant_id })
                          }}
                        >
                          {t.full_name}
                        </button>
                        {t.business_name && <p className="text-sm text-muted">{t.business_name}</p>}
                      </Td>
                      <Td className="whitespace-nowrap tabular-nums">{formatPhone(t.phone)}</Td>
                      <Td>
                        <CurrentStalls contracts={t.contracts} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {t.line_user_id ? <Badge tone="green">ผูกแล้ว</Badge> : <span className="text-muted">ยังไม่ผูก</span>}
                      </Td>
                      <Td>
                        <ActiveBadge status={t.status} />
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </>
          )}
        </>
      )}

      {dialog?.type === 'view' && selected && (
        <TenantDialog
          key={selected.tenant_id}
          tenant={selected}
          role={role}
          onClose={() => setDialog(null)}
          onEdit={() => setDialog({ type: 'edit', id: selected.tenant_id })}
          onChanged={(text) => done(text, { type: 'view', id: selected.tenant_id })}
          onDeleted={(text) => done(text)}
        />
      )}
      {(dialog?.type === 'new' || (dialog?.type === 'edit' && selected)) && (
        <TenantFormDialog
          tenant={dialog.type === 'edit' ? selected : null}
          onClose={() => setDialog(dialog.type === 'edit' ? { type: 'view', id: dialog.id } : null)}
          onSaved={(id, isNew, name) =>
            done(isNew ? `เพิ่มผู้เช่า ${name} แล้ว` : `บันทึกข้อมูล ${name} แล้ว`, { type: 'view', id })
          }
        />
      )}
    </div>
  )
}
