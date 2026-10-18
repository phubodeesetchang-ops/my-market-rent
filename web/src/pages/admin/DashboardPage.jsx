import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatDate, formatNumber, todayISO } from '../../lib/format'
import { countByStatus, findStall, indexZones, newStallDefaults, stallTitle } from '../../lib/stalls'
import { DEFAULT_COLS, SITE_PLANS } from '../../lib/siteLayouts'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { StatusLegend } from '../../components/MarketMap'
import { SitePlan, ZoneRowsPlan, ZoneStack } from '../../components/SitePlan'
import StallDialog from '../../components/StallDialog'
import { LoadingMark } from '../../components/LoadingScreen'
import StallFormDialog from '../../components/stalls/StallFormDialog'

/** ดึงตลาด → โซน → แผง ในคำสั่งเดียว (RLS: เจ้าหน้าที่ทุกบทบาทเห็นทั้งหมด) */
async function fetchMarkets() {
  const { data, error } = await supabase
    .from('markets')
    .select(
      'market_id, market_name, market_type, zones(zone_id, zone_name, stalls(stall_id, stall_code, status, unit_type, size, size_unit, base_rent, rent_period))',
    )
    .eq('status', 'active')
    .order('market_id')
    .order('zone_name', { referencedTable: 'zones' })
    .order('stall_code', { referencedTable: 'zones.stalls' })
  if (error) throw error
  return data
}

const allStallsOf = (market) => market.zones.flatMap((z) => z.stalls)

/** สรุปจำนวนของตลาดในผัง เช่น "ตลาดเย็น 38 แผง ว่าง 30" */
function MarketCounts({ markets }) {
  return (
    <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted tabular-nums">
      {markets.map((m) => {
        const stalls = allStallsOf(m)
        const unit = m.market_type === 'building' ? 'ห้อง' : 'แผง'
        return (
          <span key={m.market_id}>
            {m.market_name} {formatNumber(stalls.length)} {unit}, ว่าง {formatNumber(countByStatus(stalls).vacant)}
          </span>
        )
      })}
    </p>
  )
}

function PlanSection({ title, markets, children }) {
  return (
    <section className="min-w-0">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line pb-2">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <MarketCounts markets={markets} />
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  )
}

/** โซนของส่วนผังนี้ ตามลำดับในผัง (ใช้แสดงแบบการ์ดบนมือถือ) */
function sectionItems(sec, zoneIndex) {
  if (sec.type === 'site') {
    return sec.plan.blocks
      .map((b) => {
        const found = zoneIndex.get(`${b.market}|${b.zone}`)
        return found && { market: found.market, zone: found.zone, label: b.label, cell: b.cell }
      })
      .filter(Boolean)
  }
  return sec.zones.map((zone) => ({ market: sec.market, zone, cell: sec.plan.zoneRows.cell }))
}

export default function DashboardPage() {
  const { role } = useAuth()
  const wide = useMediaQuery('(min-width: 768px)')
  const [{ markets, error }, setResult] = useState({ markets: null, error: null })
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [editing, setEditing] = useState(false)
  const [addingZoneId, setAddingZoneId] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetchMarkets()
      .then((data) => !cancelled && setResult({ markets: data, error: null }))
      .catch((e) => !cancelled && setResult((prev) => ({ markets: prev.markets, error: thaiError(e) })))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const closeDialog = useCallback(() => setSelectedId(null), [])
  const startEdit = useCallback(() => setEditing(true), [])

  function retry() {
    setResult({ markets: null, error: null })
    reload()
  }

  const zoneIndex = useMemo(() => indexZones(markets ?? []), [markets])

  // แบ่งตลาด/โซนตามผังที่กำหนดไว้ใน siteLayouts.js ที่เหลือแสดงเป็นแถวทั่วไป
  const sections = useMemo(() => {
    if (!markets) return []
    const used = new Set()
    const out = []
    for (const plan of SITE_PLANS) {
      if (plan.blocks) {
        const names = [...new Set(plan.blocks.map((b) => b.market))]
        const planMarkets = markets.filter((m) => names.includes(m.market_name))
        for (const b of plan.blocks) {
          const found = zoneIndex.get(`${b.market}|${b.zone}`)
          if (found) used.add(found.zone.zone_id)
        }
        if (planMarkets.length > 0) out.push({ key: plan.key, type: 'site', plan, title: plan.title, markets: planMarkets })
      } else if (plan.zoneRows) {
        const market = markets.find((m) => m.market_name === plan.zoneRows.market)
        if (!market) continue
        market.zones.forEach((z) => used.add(z.zone_id))
        out.push({ key: plan.key, type: 'rows', plan, title: plan.title, markets: [market], market, zones: market.zones })
      }
    }
    for (const market of markets) {
      const rest = market.zones.filter((z) => !used.has(z.zone_id))
      if (rest.length === 0) continue
      const partial = rest.length < market.zones.length
      out.push({
        key: `rest-${market.market_id}`,
        type: 'rows',
        plan: { zoneRows: { cols: DEFAULT_COLS, cell: 'stall' } },
        title: partial ? `${market.market_name} (โซนที่ยังไม่ได้วางในผัง)` : market.market_name,
        markets: [market],
        market,
        zones: rest,
      })
    }
    return out
  }, [markets, zoneIndex])

  const selected = markets && selectedId ? findStall(markets, selectedId) : null
  const allStalls = markets?.flatMap(allStallsOf) ?? []
  const canAdd = can(role, 'manageOperations')

  async function addStall(market, zone) {
    setNotice(null)
    setAddingZoneId(zone.zone_id)
    const { data, error: insertError } = await supabase
      .from('stalls')
      .insert({ zone_id: zone.zone_id, ...newStallDefaults(market, zone) })
      .select('stall_id, stall_code, unit_type')
      .single()
    setAddingZoneId(null)
    if (insertError) return setNotice({ tone: 'error', text: thaiError(insertError) })
    setNotice({ tone: 'ok', text: `เพิ่ม${stallTitle(data)} ใน${market.market_name} โซน ${zone.zone_name} แล้ว` })
    setSelectedId(data.stall_id)
    reload()
  }

  function handleDeleted() {
    const s = selected?.stall
    setSelectedId(null)
    if (s) setNotice({ tone: 'ok', text: `ลบ${stallTitle(s)} แล้ว` })
    reload()
  }

  const planProps = { onSelect: setSelectedId, onAdd: canAdd ? addStall : undefined, addingZoneId }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold text-ink">ภาพรวมแผงค้า</h1>
          <p className="text-muted">สถานะแผงทุกตลาด ณ วันที่ {formatDate(todayISO(), { long: true })} กดที่ช่องเพื่อดูข้อมูลแผง</p>
        </div>
      </header>

      {notice && (
        <div
          role="status"
          className={`mt-5 flex items-center justify-between gap-4 rounded-lg px-4 py-2.5 ${
            notice.tone === 'error' ? 'bg-danger-bg text-danger' : 'bg-leaf-100 text-leaf-800'
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-sm font-medium hover:underline">
            ปิด
          </button>
        </div>
      )}

      {error && (
        <div role="alert" className="mt-6 rounded-lg bg-danger-bg px-4 py-3 text-danger">
          <p>โหลดแผนผังไม่สำเร็จ: {error}</p>
          <button type="button" onClick={retry} className="mt-2 font-semibold underline">
            ลองโหลดใหม่
          </button>
        </div>
      )}

      {!markets && !error && (
        <div className="mt-16 flex flex-col items-center gap-3 text-muted" role="status">
          <LoadingMark size={64} />
          กำลังโหลดแผนผังตลาด…
        </div>
      )}

      {markets && markets.length === 0 && (
        <div className="mt-8 max-w-2xl rounded-xl border border-dashed border-leaf-300 bg-leaf-50 px-5 py-4">
          <p className="font-medium text-ink">ไม่พบข้อมูลตลาดที่บัญชีนี้มองเห็น</p>
          <p className="mt-1 text-muted">
            ถ้ายังไม่ได้รัน <code className="rounded bg-white px-1">supabase/seed.sql</code> ให้รันก่อน ถ้ารันแล้วยังขึ้นข้อความนี้
            ให้ทำตาม README หัวข้อ &ldquo;แก้ปัญหา: หน้าภาพรวมไม่แสดงตลาด&rdquo;
          </p>
        </div>
      )}

      {markets && markets.length > 0 && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 rounded-xl border border-line bg-leaf-50 px-5 py-4">
            <StatusLegend counts={countByStatus(allStalls)} />
            <p className="text-muted tabular-nums">
              ทั้งหมด <span className="font-semibold text-ink">{formatNumber(allStalls.length)}</span> แผง/ห้อง
            </p>
          </div>

          <div className="mt-8 space-y-12">
            {sections.map((sec) => (
              <PlanSection key={sec.key} title={sec.title} markets={sec.markets}>
                {!wide ? (
                  <ZoneStack items={sectionItems(sec, zoneIndex)} {...planProps} />
                ) : sec.type === 'site' ? (
                  <SitePlan plan={sec.plan} zoneIndex={zoneIndex} {...planProps} />
                ) : (
                  <ZoneRowsPlan
                    market={sec.market}
                    zones={sec.zones}
                    cols={sec.plan.zoneRows.cols}
                    cell={sec.plan.zoneRows.cell}
                    {...planProps}
                  />
                )}
              </PlanSection>
            ))}
          </div>
        </>
      )}

      {selected && !editing && (
        <StallDialog
          info={selected}
          role={role}
          onClose={closeDialog}
          onChanged={reload}
          onDeleted={handleDeleted}
          onEdit={startEdit}
        />
      )}
      {selected && editing && (
        <StallFormDialog
          info={selected}
          onClose={() => setEditing(false)}
          onSaved={(s) => {
            setEditing(false)
            setNotice({ tone: 'ok', text: `บันทึก${stallTitle(s)} แล้ว` })
            reload()
          }}
        />
      )}
    </div>
  )
}
