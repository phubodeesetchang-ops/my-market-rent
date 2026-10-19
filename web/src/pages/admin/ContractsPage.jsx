import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { formatBaht, formatDate, formatNumber, todayISO } from '../../lib/format'
import { contractTiming, liveRenewalOf, termLabel } from '../../lib/contracts'
import { stallPlace } from '../../lib/stalls'
import { digitsOnly } from '../../lib/validate'
import { useLoader } from '../../lib/useLoader'
import { useLiveVersion } from '../../lib/notifications'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { Badge, ContractStatusBadge, DataTable, EmptyBox, LoadError, Notice, PageHeader, Td, Th } from '../../components/ui/feedback'
import { Button, SelectInput, TextInput } from '../../components/ui/form'
import ContractDialog from '../../components/contracts/ContractDialog'
import ContractFormDialog from '../../components/contracts/ContractFormDialog'
import { TimingBadge } from '../../components/contracts/TimingBadge'

const CONTRACT_SELECT =
  'contract_id, contract_no, tenant_id, stall_id, start_date, end_date, rent_amount, rent_period, deposit_amount, status, renewed_from_id, note, created_at, created_by, ' +
  'tenants(tenant_id, full_name, business_name, phone, status), ' +
  'stalls(stall_id, stall_code, unit_type, base_rent, rent_period, status, zones(zone_name, markets(market_id, market_name)))'

async function fetchContracts() {
  const { data, error } = await supabase.from('contracts').select(CONTRACT_SELECT).order('created_at', { ascending: false })
  if (error) throw error
  return data
}

const PER = { monthly: 'เดือน', yearly: 'ปี' }
const TABS = [
  { key: 'pending', label: 'คำขอรออนุมัติ' },
  { key: 'active', label: 'สัญญาใช้งาน' },
  { key: 'history', label: 'ประวัติ' },
]
const inTab = (c, tab) => (tab === 'pending' ? c.status === 'pending' : tab === 'active' ? c.status === 'active' : !['pending', 'active'].includes(c.status))

/** ค้นจากเลขที่สัญญา ชื่อผู้เช่า ร้าน เบอร์โทร หรือรหัสแผง */
function matches(c, query) {
  const text = query.trim().toLowerCase()
  if (!text) return true
  const t = c.tenants ?? {}
  if ([c.contract_no, t.full_name, t.business_name, c.stalls?.stall_code].some((v) => v?.toLowerCase().includes(text))) return true
  const digits = digitsOnly(text)
  return digits.length >= 3 && digitsOnly(t.phone).includes(digits)
}

function sortFor(tab) {
  if (tab === 'pending') return (a, b) => a.created_at.localeCompare(b.created_at) // มาก่อนพิจารณาก่อน
  if (tab === 'active') return (a, b) => a.end_date.localeCompare(b.end_date) // ใกล้หมดอยู่บน
  return (a, b) => b.end_date.localeCompare(a.end_date)
}

function initialDialog(params) {
  const open = Number(params.get('open'))
  if (open) return { type: 'view', id: open }
  if (params.get('new')) return { type: 'form', mode: 'new', stallId: Number(params.get('stall')) || null, tenantId: Number(params.get('tenant')) || null }
  return null
}

function TenantCell({ c }) {
  return (
    <>
      <span className="font-medium text-ink">{c.tenants?.full_name ?? '-'}</span>
      {c.tenants?.business_name && <span className="block text-sm text-muted">{c.tenants.business_name}</span>}
    </>
  )
}

function Period({ c }) {
  return (
    <span className="whitespace-nowrap">
      {formatDate(c.start_date)} – {formatDate(c.end_date)}
      <span className="block text-sm text-muted">{termLabel(c.start_date, c.end_date)}</span>
    </span>
  )
}

function Rent({ c }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      {formatBaht(c.rent_amount, { withUnit: false })}
      <span className="text-muted"> / {PER[c.rent_period]}</span>
    </span>
  )
}

/** ป้ายท้ายแถวตามแท็บ */
function StateCell({ c, tab, all, today }) {
  if (tab === 'pending') {
    const from = c.renewed_from_id ? all.find((x) => x.contract_id === c.renewed_from_id) : null
    return (
      <span className="space-y-1">
        {from ? <Badge tone="outline">ต่ออายุ {from.contract_no}</Badge> : <Badge tone="amber">คำขอใหม่</Badge>}
        <span className="block text-sm text-muted">{c.created_by ? 'เจ้าหน้าที่สร้าง' : 'ผู้เช่าส่งผ่าน LINE'}</span>
      </span>
    )
  }
  if (tab === 'active') {
    const renewal = liveRenewalOf(c, all)
    return (
      <span className="flex flex-wrap gap-1.5">
        <TimingBadge timing={contractTiming(c, today)} />
        {renewal && <Badge tone={renewal.status === 'pending' ? 'amber' : 'green'}>{renewal.status === 'pending' ? 'ต่ออายุรออนุมัติ' : 'ต่ออายุแล้ว'}</Badge>}
        {!renewal && contractTiming(c, today)?.kind === 'running' && <span className="text-muted">-</span>}
      </span>
    )
  }
  return <ContractStatusBadge status={c.status} />
}

export default function ContractsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('tab')) ? params.get('tab') : 'pending'
  const live = useLiveVersion()
  const { data: contracts, error, loading, reload } = useLoader(fetchContracts, `contracts:${live}`)
  const [marketId, setMarketId] = useState('all')
  const [query, setQuery] = useState('')
  const [soonOnly, setSoonOnly] = useState(false)
  const [dialog, setDialog] = useState(() => initialDialog(params))
  const [notice, setNotice] = useState(null)

  // ลิงก์จากหน้าอื่น (?open= / ?new=) ใช้ครั้งเดียวตอนเปิดหน้า แล้วล้างออกจาก URL
  useEffect(() => {
    if (params.has('open') || params.has('new')) setParams({ tab }, { replace: true })
    // ทำครั้งเดียวตอนเปิดหน้า
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const canOperate = can(role, 'manageOperations')
  const today = todayISO()
  const all = contracts ?? []
  const markets = [...new Map(all.map((c) => [c.stalls?.zones?.markets?.market_id, c.stalls?.zones?.markets?.market_name])).entries()].filter(([id]) => id)
  const filtered = all.filter((c) => (marketId === 'all' || String(c.stalls?.zones?.markets?.market_id) === marketId) && matches(c, query))
  const counts = Object.fromEntries(TABS.map((t) => [t.key, filtered.filter((c) => inTab(c, t.key)).length]))
  let list = filtered.filter((c) => inTab(c, tab)).sort(sortFor(tab))
  if (tab === 'active' && soonOnly) list = list.filter((c) => ['expiring', 'overdue'].includes(contractTiming(c, today)?.kind))
  const overdue = all.filter((c) => contractTiming(c, today)?.kind === 'overdue')
  const selected = dialog?.id ? all.find((c) => c.contract_id === dialog.id) : null

  const goTab = (key) => setParams({ tab: key })
  function done(text, next = null, nextTab = null) {
    setNotice({ tone: 'ok', text })
    setDialog(next)
    if (nextTab && nextTab !== tab) goTab(nextTab)
    reload()
  }

  async function expireNow() {
    const { data, error: e } = await supabase.rpc('expire_contracts')
    if (e) throw e
    done(`ปิดสัญญาที่หมดอายุแล้ว ${formatNumber(data)} ฉบับ แผงที่ไม่มีสัญญาอื่นกลับเป็นว่าง`, null)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="คำขอและสัญญาเช่า"
        description="พิจารณาคำขอเช่า ทำสัญญา ต่ออายุ และยกเลิกสัญญา สถานะแผงเปลี่ยนตามสัญญาให้อัตโนมัติ"
        actions={
          canOperate && (
            <Button variant="primary" size="md" onClick={() => setDialog({ type: 'form', mode: 'new' })}>
              + ทำสัญญาใหม่
            </Button>
          )
        }
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {canOperate && overdue.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f4c7c1] bg-danger-bg px-4 py-3">
          <p className="text-danger">
            มีสัญญาที่เลยวันสิ้นสุดแล้ว <span className="font-semibold">{formatNumber(overdue.length)}</span> ฉบับ ยังนับเป็น "ใช้งาน" จนกว่าจะปิด
          </p>
          <Button variant="danger" onClick={() => setDialog({ type: 'expire' })}>
            ปิดสัญญาที่หมดอายุ ({formatNumber(overdue.length)})
          </Button>
        </div>
      )}

      <div role="tablist" aria-label="ประเภทรายการ" className="mt-6 flex flex-wrap gap-2 border-b border-line">
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => goTab(t.key)}
              className={`-mb-px border-b-2 px-3 pb-2 font-medium ${active ? 'border-leaf-700 text-leaf-800' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {t.label}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-sm tabular-nums ${active ? 'bg-leaf-100' : 'bg-leaf-50'}`}>{formatNumber(counts[t.key] ?? 0)}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-64">
          <TextInput
            type="search"
            aria-label="ค้นหาสัญญา"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ค้นหาเลขที่สัญญา ชื่อผู้เช่า ร้าน เบอร์โทร หรือรหัสแผง"
          />
        </div>
        <div className="w-44">
          <SelectInput aria-label="ตลาด" value={marketId} onChange={(e) => setMarketId(e.target.value)}>
            <option value="all">ทุกตลาด</option>
            {markets.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectInput>
        </div>
        {tab === 'active' && (
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-leaf-700" checked={soonOnly} onChange={(e) => setSoonOnly(e.target.checked)} />
            <span>เฉพาะใกล้หมด/เลยกำหนด</span>
          </label>
        )}
      </div>

      {error && <LoadError what="สัญญาเช่า" message={error} onRetry={reload} />}
      {!contracts && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดสัญญาเช่า…</p>}

      {contracts && (
        <div role="tabpanel" aria-label={TABS.find((t) => t.key === tab).label} className="mt-4">
          <p className="mb-2 text-sm text-muted tabular-nums" aria-live="polite">
            {formatNumber(list.length)} รายการ{loading && ' · กำลังโหลดใหม่…'}
          </p>
          {list.length === 0 ? (
            <EmptyBox>
              {tab === 'pending' ? 'ไม่มีคำขอที่รออนุมัติ' : tab === 'active' ? 'ไม่พบสัญญาที่ใช้งาน' : 'ยังไม่มีประวัติสัญญา'}
              {query || marketId !== 'all' ? ' ที่ตรงกับตัวกรอง' : ''}
            </EmptyBox>
          ) : (
            <>
              {/* มือถือ */}
              <ul className="divide-y divide-line rounded-xl border border-line sm:hidden" aria-label="รายการสัญญา">
                {list.map((c) => (
                  <li key={c.contract_id}>
                    <button type="button" className="block w-full px-4 py-3 text-left hover:bg-leaf-50" onClick={() => setDialog({ type: 'view', id: c.contract_id })}>
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block font-medium text-leaf-800">{c.tenants?.full_name ?? '-'}</span>
                          <span className="block text-sm text-muted">
                            {c.contract_no} · {stallPlace(c.stalls)}
                          </span>
                          <span className="block text-sm text-ink tabular-nums">
                            {formatDate(c.start_date)} – {formatDate(c.end_date)} · {formatBaht(c.rent_amount)}/{PER[c.rent_period]}
                          </span>
                        </span>
                        <StateCell c={c} tab={tab} all={all} today={today} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <DataTable label="รายการสัญญา" className="hidden sm:block">
                <thead>
                  <tr>
                    <Th>{tab === 'pending' ? 'ส่งเมื่อ' : 'เลขที่สัญญา'}</Th>
                    <Th>ผู้เช่า</Th>
                    <Th>แผง/ห้อง</Th>
                    <Th>ระยะเวลา</Th>
                    <Th className="text-right">ค่าเช่า</Th>
                    <Th>{tab === 'pending' ? 'ประเภท' : 'สถานะ'}</Th>
                    {tab === 'history' && <Th>หมายเหตุ</Th>}
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.contract_id} className="cursor-pointer hover:bg-leaf-50" onClick={() => setDialog({ type: 'view', id: c.contract_id })}>
                      <Td className="whitespace-nowrap">
                        <button
                          type="button"
                          className="font-medium text-leaf-800 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setDialog({ type: 'view', id: c.contract_id })
                          }}
                        >
                          {tab === 'pending' ? formatDate(c.created_at) : c.contract_no}
                        </button>
                        {tab === 'pending' && <span className="block text-sm text-muted">{c.contract_no}</span>}
                      </Td>
                      <Td>
                        <TenantCell c={c} />
                      </Td>
                      <Td className="whitespace-nowrap">{stallPlace(c.stalls)}</Td>
                      <Td>
                        <Period c={c} />
                      </Td>
                      <Td className="text-right">
                        <Rent c={c} />
                      </Td>
                      <Td>
                        <StateCell c={c} tab={tab} all={all} today={today} />
                      </Td>
                      {tab === 'history' && <Td className="max-w-64 truncate text-muted">{c.note ?? '-'}</Td>}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </>
          )}
        </div>
      )}

      {dialog?.type === 'view' && selected && (
        <ContractDialog
          key={selected.contract_id}
          contract={selected}
          all={all}
          role={role}
          onClose={() => setDialog(null)}
          onAction={(mode) => setDialog({ type: 'form', mode, id: selected.contract_id })}
          onChanged={(text) => done(text, { type: 'view', id: selected.contract_id }, 'history')}
          onOpen={(id) => setDialog({ type: 'view', id })}
        />
      )}
      {dialog?.type === 'form' && (dialog.mode === 'new' || selected) && (
        <ContractFormDialog
          mode={dialog.mode}
          contract={selected}
          presetStallId={dialog.stallId}
          presetTenantId={dialog.tenantId}
          onClose={() => setDialog(dialog.id ? { type: 'view', id: dialog.id } : null)}
          onSaved={(text, id) =>
            done(text, { type: 'view', id }, { new: 'active', approve: 'active', renew: 'pending', edit: null }[dialog.mode])
          }
        />
      )}
      {dialog?.type === 'expire' && (
        <ConfirmDialog
          title="ปิดสัญญาที่หมดอายุ"
          confirmLabel={`ปิด ${formatNumber(overdue.length)} สัญญา`}
          onClose={() => setDialog(null)}
          onConfirm={expireNow}
        >
          <p>สัญญาต่อไปนี้เลยวันสิ้นสุดแล้ว จะเปลี่ยนเป็น "สิ้นสุด" และแผงที่ไม่มีสัญญาอื่นจะกลับเป็น "ว่าง"</p>
          <ul className="divide-y divide-line rounded-lg border border-line text-sm">
            {overdue.slice(0, 6).map((c) => (
              <li key={c.contract_id} className="flex justify-between gap-3 px-3 py-1.5">
                <span>
                  {c.contract_no} · {c.tenants?.full_name}
                </span>
                <span className="text-muted">สิ้นสุด {formatDate(c.end_date)}</span>
              </li>
            ))}
            {overdue.length > 6 && <li className="px-3 py-1.5 text-muted">และอีก {formatNumber(overdue.length - 6)} สัญญา</li>}
          </ul>
        </ConfirmDialog>
      )}
    </div>
  )
}
