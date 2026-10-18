import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { formatBaht, formatNumber } from '../../lib/format'
import { RENT_PERIOD, STALL_STATUS, STALL_STATUS_ORDER, UNIT_TYPE } from '../../lib/labels'
import { countByStatus, findStall, stallTitle } from '../../lib/stalls'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { StallStatusBadge } from '../../components/MarketMap'
import StallDialog from '../../components/StallDialog'
import StallFormDialog from '../../components/stalls/StallFormDialog'
import ZoneRentDialog from '../../components/stalls/ZoneRentDialog'
import { Badge, DataTable, EmptyBox, LoadError, Notice, PageHeader, Td, Th } from '../../components/ui/feedback'
import { Button, Field, SelectInput, TextInput } from '../../components/ui/form'

const PER = { monthly: 'เดือน', yearly: 'ปี' }

/** ตลาด → โซน → แผง พร้อมผู้เช่าปัจจุบัน (เฉพาะสัญญาที่ใช้งาน/รออนุมัติ) */
async function fetchStallData() {
  const { data, error } = await supabase
    .from('markets')
    .select(
      'market_id, market_name, market_type, zones(zone_id, zone_name, stalls(stall_id, stall_code, status, unit_type, size, size_unit, base_rent, rent_period, contracts(contract_id, status, tenants(full_name, business_name))))',
    )
    .eq('status', 'active')
    .in('zones.stalls.contracts.status', ['active', 'pending'])
    .order('market_id')
    .order('zone_name', { referencedTable: 'zones' })
    .order('stall_code', { referencedTable: 'zones.stalls' })
  if (error) throw error
  return data
}

function TenantCell({ contracts }) {
  const list = contracts ?? []
  if (list.length === 0) return <span className="text-muted">-</span>
  return (
    <ul className="space-y-0.5">
      {list.map((c) => (
        <li key={c.contract_id} className="whitespace-nowrap">
          {c.tenants?.full_name ?? '-'}
          {c.status === 'pending' && <Badge tone="amber" className="ml-2">รออนุมัติ</Badge>}
        </li>
      ))}
    </ul>
  )
}

export default function StallsPage() {
  const { role } = useAuth()
  const { data: markets, error, loading, reload } = useLoader(fetchStallData)
  const [marketId, setMarketId] = useState('all')
  const [zoneId, setZoneId] = useState('all')
  const [status, setStatus] = useState('all')
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState(null) // { type: 'view' | 'edit' | 'new' | 'zone-rent', id? }
  const [notice, setNotice] = useState(null)

  const canOperate = can(role, 'manageOperations')
  const market = markets?.find((m) => String(m.market_id) === marketId) ?? null
  const zone = market?.zones.find((z) => String(z.zone_id) === zoneId) ?? null

  const rows = (markets ?? []).flatMap((m) =>
    m.zones.flatMap((z) => z.stalls.map((s) => ({ market: m, zone: z, stall: s }))),
  )
  const text = query.trim().toLowerCase()
  const list = rows.filter(
    ({ market: m, zone: z, stall: s }) =>
      (marketId === 'all' || String(m.market_id) === marketId) &&
      (zoneId === 'all' || String(z.zone_id) === zoneId) &&
      (status === 'all' || s.status === status) &&
      (!text ||
        s.stall_code.toLowerCase().includes(text) ||
        (s.contracts ?? []).some((c) => c.tenants?.full_name?.toLowerCase().includes(text) || c.tenants?.business_name?.toLowerCase().includes(text))),
  )
  const counts = countByStatus(list.map((r) => r.stall))
  const selected = markets && dialog?.id ? findStall(markets, dialog.id) : null

  function done(text, next = null) {
    setNotice({ tone: 'ok', text })
    setDialog(next)
    reload()
  }

  function changeMarket(e) {
    setMarketId(e.target.value)
    setZoneId('all')
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="แผงค้า"
        description="แผงและห้องเช่าทุกตลาด กดที่รหัสเพื่อดูข้อมูล แก้ไข หรือตั้งซ่อมบำรุง"
        actions={
          canOperate &&
          markets?.length > 0 && (
            <Button variant="primary" size="md" onClick={() => setDialog({ type: 'new' })}>
              + เพิ่มแผง/ห้อง
            </Button>
          )
        }
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <Field label="ตลาด" className="w-48">
          <SelectInput value={marketId} onChange={changeMarket}>
            <option value="all">ทุกตลาด</option>
            {(markets ?? []).map((m) => (
              <option key={m.market_id} value={m.market_id}>
                {m.market_name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="โซน" className="w-36">
          <SelectInput value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={!market}>
            <option value="all">ทุกโซน</option>
            {(market?.zones ?? []).map((z) => (
              <option key={z.zone_id} value={z.zone_id}>
                โซน {z.zone_name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="สถานะ" className="w-36">
          <SelectInput value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">ทุกสถานะ</option>
            {STALL_STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {STALL_STATUS[s]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="ค้นหา" className="min-w-0 flex-1 basis-56">
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="รหัสแผง หรือชื่อผู้เช่า" />
        </Field>
      </div>

      {zone && canOperate && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-leaf-50 px-4 py-3">
          <p className="text-ink">
            {market.market_name} โซน {zone.zone_name}: {formatNumber(zone.stalls.length)} {market.market_type === 'building' ? 'ห้อง' : 'แผง'}
          </p>
          <Button onClick={() => setDialog({ type: 'zone-rent', zoneId: zone.zone_id })} disabled={zone.stalls.length === 0}>
            ตั้งค่าเช่าทั้งโซน
          </Button>
        </div>
      )}

      {error && <LoadError what="รายการแผง" message={error} onRetry={reload} />}
      {!markets && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดรายการแผง…</p>}

      {markets && (
        <>
          <p className="mt-4 mb-2 text-sm text-muted tabular-nums" aria-live="polite">
            แสดง {formatNumber(list.length)} จาก {formatNumber(rows.length)} แผง/ห้อง ·{' '}
            {STALL_STATUS_ORDER.map((s) => `${STALL_STATUS[s]} ${formatNumber(counts[s])}`).join(' · ')}
            {loading && ' · กำลังโหลดใหม่…'}
          </p>
          {list.length === 0 ? (
            <EmptyBox>{rows.length === 0 ? 'ยังไม่มีแผงในระบบ' : 'ไม่พบแผงที่ตรงกับตัวกรอง'}</EmptyBox>
          ) : (
            <>
              {/* มือถือ: รายการแบบซ้อนบรรทัด */}
              <ul className="divide-y divide-line rounded-xl border border-line sm:hidden" aria-label="รายการแผงและห้อง">
                {list.map(({ market: m, zone: z, stall: s }) => (
                  <li key={s.stall_id}>
                    <button
                      type="button"
                      className="block w-full px-4 py-3 text-left hover:bg-leaf-50"
                      onClick={() => setDialog({ type: 'view', id: s.stall_id })}
                    >
                      <span className="flex items-start justify-between gap-3">
                        <span className="min-w-0">
                          <span className="block font-medium text-leaf-800">
                            {stallTitle(s)} <span className="font-normal text-muted">{m.market_name} โซน {z.zone_name}</span>
                          </span>
                          <span className="block text-sm text-muted tabular-nums">
                            {s.base_rent != null ? `${formatBaht(s.base_rent)} / ${PER[s.rent_period]}` : 'ยังไม่กำหนดค่าเช่า'}
                            {s.size ? ` · ${formatNumber(s.size)} ${s.size_unit ?? ''}` : ''}
                          </span>
                          {(s.contracts ?? []).map((c) => (
                            <span key={c.contract_id} className="block text-sm text-ink">
                              {c.tenants?.full_name ?? '-'}
                              {c.status === 'pending' && <span className="text-stall-reserved-ink"> (รออนุมัติ)</span>}
                            </span>
                          ))}
                        </span>
                        <StallStatusBadge status={s.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <DataTable label="รายการแผงและห้อง" className="hidden sm:block">
                <thead>
                  <tr>
                    <Th>รหัส</Th>
                    <Th>ตลาด / โซน</Th>
                    <Th>ประเภท</Th>
                    <Th className="text-right">ขนาด</Th>
                    <Th className="text-right">ค่าเช่าเริ่มต้น</Th>
                    <Th>สถานะ</Th>
                    <Th>ผู้เช่า</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(({ market: m, zone: z, stall: s }) => (
                    <tr key={s.stall_id} className="cursor-pointer hover:bg-leaf-50" onClick={() => setDialog({ type: 'view', id: s.stall_id })}>
                      <Td>
                        <button
                          type="button"
                          className="font-medium whitespace-nowrap text-leaf-800 hover:underline"
                          aria-label={`${stallTitle(s)} ${m.market_name}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setDialog({ type: 'view', id: s.stall_id })
                          }}
                        >
                          {s.stall_code}
                        </button>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {m.market_name} <span className="text-muted">โซน {z.zone_name}</span>
                      </Td>
                      <Td className="whitespace-nowrap">
                        {UNIT_TYPE[s.unit_type]}
                        {RENT_PERIOD[s.rent_period]}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">
                        {s.size ? `${formatNumber(s.size)} ${s.size_unit ?? ''}` : <span className="text-muted">-</span>}
                      </Td>
                      <Td className="text-right whitespace-nowrap tabular-nums">
                        {s.base_rent != null ? (
                          <>
                            {formatBaht(s.base_rent, { withUnit: false })}
                            <span className="text-muted"> / {PER[s.rent_period]}</span>
                          </>
                        ) : (
                          <span className="text-muted">ยังไม่กำหนด</span>
                        )}
                      </Td>
                      <Td>
                        <StallStatusBadge status={s.status} />
                      </Td>
                      <Td>
                        <TenantCell contracts={s.contracts} />
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
        <StallDialog
          info={selected}
          role={role}
          onClose={() => setDialog(null)}
          onChanged={reload}
          onDeleted={() => done(`ลบ${stallTitle(selected.stall)} แล้ว`)}
          onEdit={() => setDialog({ type: 'edit', id: selected.stall.stall_id })}
        />
      )}
      {dialog?.type === 'edit' && selected && (
        <StallFormDialog
          info={selected}
          onClose={() => setDialog({ type: 'view', id: selected.stall.stall_id })}
          onSaved={(s) => done(`บันทึก${stallTitle(s)} แล้ว`, { type: 'view', id: s.stall_id })}
        />
      )}
      {dialog?.type === 'new' && (
        <StallFormDialog
          markets={markets}
          initialZoneId={zone?.zone_id ?? market?.zones[0]?.zone_id}
          onClose={() => setDialog(null)}
          onSaved={(s) => done(`เพิ่ม${stallTitle(s)} แล้ว`, { type: 'view', id: s.stall_id })}
        />
      )}
      {dialog?.type === 'zone-rent' && zone && (
        <ZoneRentDialog market={market} zone={zone} onClose={() => setDialog(null)} onSaved={(text) => done(text)} />
      )}
    </div>
  )
}
