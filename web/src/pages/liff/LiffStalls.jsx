import { useState } from 'react'
import { Link } from 'react-router-dom'
import { StallStatusBadge, StatusLegend } from '../../components/MarketMap'
import { StallBlock } from '../../components/SitePlan'
import Modal, { DetailRows, ModalSection } from '../../components/ui/Modal'
import { Button, Field, FormError, TextArea, TextInput } from '../../components/ui/form'
import { addDays, contractProblem, defaultEndDate, termLabel } from '../../lib/contracts'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatNumber, todayISO } from '../../lib/format'
import { fetchContracts, fetchMarkets } from '../../lib/liffData'
import { useLiff } from '../../lib/liffContext'
import { countByStatus, findStall, stallTitle } from '../../lib/stalls'
import { useLoader } from '../../lib/useLoader'
import { clearProblem, collectProblems } from '../../lib/validate'
import { Card, ErrorBox, Loading, PageTitle } from './parts'

const MAX_PENDING = 3 // ต้องตรงกับ migration 008
const PER = { monthly: 'เดือน', yearly: 'ปี' }
const rentText = (s) => (s.base_rent === null || s.base_rent === undefined ? 'สอบถามสำนักงาน' : `${formatBaht(s.base_rent)} / ${PER[s.rent_period] ?? 'เดือน'}`)
const sizeText = (s) => (s.size ? `${formatNumber(s.size)} ${s.size_unit ?? ''}`.trim() : null)

async function loadStalls() {
  const [markets, contracts] = await Promise.all([fetchMarkets(), fetchContracts()])
  return { markets, pending: contracts.filter((c) => c.status === 'pending').length }
}

function RequestDialog({ found, onClose, onSent }) {
  const { client } = useLiff()
  const { market, zone, stall } = found
  const today = todayISO()
  const [values, setValues] = useState(() => ({ start: today, end: defaultEndDate(today, stall.rent_period), note: '' }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  function setStart(e) {
    const start = e.target.value
    setValues((v) => ({ ...v, start, end: defaultEndDate(start, stall.rent_period) || v.end }))
    setErrors(clearProblem('start'))
  }

  async function submit(e) {
    e.preventDefault()
    const problems = collectProblems({
      start: !values.start ? 'กรุณาเลือกวันเริ่มเช่า' : values.start < today ? 'วันเริ่มเช่าต้องไม่ย้อนหลัง' : values.start > addDays(today, 365) ? 'ขอเช่าล่วงหน้าได้ไม่เกิน 1 ปี' : '',
      end: !values.end ? 'กรุณาเลือกวันสิ้นสุด' : values.end <= values.start ? 'วันสิ้นสุดต้องอยู่หลังวันเริ่มเช่า' : '',
    })
    setErrors(problems)
    if (Object.keys(problems).length) return
    setBusy(true)
    setError('')
    const { error: e2 } = await client
      .from('contracts')
      .insert({ stall_id: stall.stall_id, start_date: values.start, end_date: values.end, note: values.note.trim() || null })
      .select('contract_id')
      .single()
    if (e2) {
      setError(contractProblem(e2) ?? thaiError(e2))
      setBusy(false)
      return
    }
    onSent(`${market.market_name} · ${stallTitle(stall)}`)
  }

  return (
    <Modal
      title={stallTitle(stall)}
      subtitle={`${market.market_name} โซน ${zone.zone_name}`}
      badge={<StallStatusBadge status={stall.status} />}
      onClose={onClose}
      onSubmit={submit}
      busy={busy}
      footer={
        <>
          <FormError>{error}</FormError>
          <div className="flex justify-end gap-2">
            <Button onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'กำลังส่ง…' : 'ส่งคำขอเช่า'}
            </Button>
          </div>
        </>
      }
    >
      <ModalSection>
        <DetailRows rows={[['ค่าเช่า', rentText(stall)], sizeText(stall) && ['ขนาด', sizeText(stall)]]} />
      </ModalSection>
      <ModalSection title="ขอเช่าแผงนี้">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="เริ่มเช่า" error={errors.start}>
              <TextInput type="date" value={values.start} min={today} max={addDays(today, 365)} onChange={setStart} />
            </Field>
            <Field label="ถึง" error={errors.end}>
              <TextInput
                type="date"
                value={values.end}
                min={values.start}
                onChange={(e) => {
                  setValues((v) => ({ ...v, end: e.target.value }))
                  setErrors(clearProblem('end'))
                }}
              />
            </Field>
          </div>
          {termLabel(values.start, values.end) && <p className="text-sm text-muted">ระยะเวลา {termLabel(values.start, values.end)}</p>}
          <Field label="สินค้าที่จะขาย / ข้อความถึงเจ้าหน้าที่" optional>
            <TextArea value={values.note} onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))} rows={2} maxLength={500} />
          </Field>
          <p className="text-sm text-muted">ส่งคำขอแล้ว แผงจะขึ้นสถานะ "จอง" ไว้ให้ เจ้าหน้าที่จะติดต่อเพื่อทำสัญญาและอนุมัติ</p>
        </div>
      </ModalSection>
    </Modal>
  )
}

function TakenDialog({ found, full, onClose }) {
  const { market, zone, stall } = found
  const message =
    stall.status === 'vacant' && full
      ? `แผงนี้ว่าง แต่คุณมีคำขอรออนุมัติครบ ${MAX_PENDING} แผงแล้ว ยกเลิกคำขอเดิมที่หน้าแรกก่อนจึงจะขอแผงนี้ได้`
      : stall.status === 'maintenance'
        ? 'แผงนี้ปิดซ่อมบำรุงอยู่ ยังขอเช่าไม่ได้'
        : 'แผงนี้มีผู้เช่าหรือผู้จองแล้ว เลือกแผงสีขาว (ว่าง) แทน'
  return (
    <Modal title={stallTitle(stall)} subtitle={`${market.market_name} โซน ${zone.zone_name}`} badge={<StallStatusBadge status={stall.status} />} onClose={onClose}>
      <ModalSection>
        <p className="text-ink">{message}</p>
        <div className="mt-3">
          <DetailRows rows={[['ค่าเช่า', rentText(stall)], sizeText(stall) && ['ขนาด', sizeText(stall)]]} />
        </div>
      </ModalSection>
    </Modal>
  )
}

export default function LiffStalls() {
  const { data, error, reload } = useLoader(loadStalls, 'stalls')
  const [marketId, setMarketId] = useState(null)
  const [selected, setSelected] = useState(null)
  const [sent, setSent] = useState('')

  if (error && !data) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />

  const { markets, pending } = data
  const market = markets.find((m) => m.market_id === marketId) ?? markets[0]
  const found = selected ? findStall(markets, selected) : null
  const full = pending >= MAX_PENDING
  const counts = market ? countByStatus(market.zones.flatMap((z) => z.stalls)) : null

  return (
    <>
      <PageTitle sub="แตะแผงสีขาว (ว่าง) เพื่อส่งคำขอเช่า">เช่าแผง</PageTitle>

      {sent && (
        <p role="status" className="mb-3 rounded-lg bg-leaf-100 px-4 py-3 text-leaf-800">
          ส่งคำขอเช่า {sent} แล้ว รอเจ้าหน้าที่อนุมัติ ·{' '}
          <Link to="/liff" className="font-semibold underline">
            ดูคำขอของฉัน
          </Link>
        </p>
      )}
      {full && (
        <p className="mb-3 rounded-lg bg-stall-reserved px-4 py-3 text-stall-reserved-ink">
          มีคำขอรออนุมัติครบ {MAX_PENDING} แผงแล้ว รอเจ้าหน้าที่พิจารณาก่อน หรือยกเลิกคำขอเดิมที่หน้าแรก
        </p>
      )}

      {markets.length === 0 ? (
        <Card className="border-dashed text-muted">ยังไม่มีตลาดเปิดให้เช่า</Card>
      ) : (
        <>
          <div role="tablist" aria-label="เลือกตลาด" className="flex flex-wrap gap-2">
            {markets.map((m) => {
              const active = m.market_id === market.market_id
              const vacant = m.zones.reduce((n, z) => n + z.stalls.filter((s) => s.status === 'vacant').length, 0)
              return (
                <button
                  key={m.market_id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setMarketId(m.market_id)}
                  className={`rounded-full border px-3.5 py-1.5 font-medium whitespace-nowrap ${
                    active ? 'border-leaf-700 bg-leaf-700 text-white' : 'border-leaf-300 bg-white text-leaf-800'
                  }`}
                >
                  {m.market_name} <span className={active ? 'text-leaf-100' : 'text-muted'}>ว่าง {formatNumber(vacant)}</span>
                </button>
              )
            })}
          </div>

          <StatusLegend counts={counts} className="mt-3 text-sm" />

          <div className="mt-3 space-y-4">
            {market.zones.map((zone) => {
              const vacant = zone.stalls.filter((s) => s.status === 'vacant').length
              const sample = zone.stalls.find((s) => s.status === 'vacant') ?? zone.stalls[0]
              return (
                <Card key={zone.zone_id} className="overflow-x-auto px-3">
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 px-1">
                    <h2 className="font-semibold text-ink">
                      โซน {zone.zone_name}{' '}
                      <span className="text-sm font-normal text-muted">
                        {formatNumber(zone.stalls.length)} {sample?.unit_type === 'room' ? 'ห้อง' : 'แผง'} · ว่าง {formatNumber(vacant)}
                      </span>
                    </h2>
                    {sample && <span className="text-sm text-muted">{rentText(sample)}</span>}
                  </div>
                  {zone.stalls.length ? (
                    <StallBlock zone={zone} shape="grid" cols={8} cell="small" onSelect={setSelected} />
                  ) : (
                    <p className="px-1 text-muted">ยังไม่มีแผงในโซนนี้</p>
                  )}
                </Card>
              )
            })}
          </div>
        </>
      )}

      {found && found.stall.status === 'vacant' && !full && (
        <RequestDialog
          found={found}
          onClose={() => setSelected(null)}
          onSent={(name) => {
            setSelected(null)
            setSent(name)
            reload()
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}
      {found && (found.stall.status !== 'vacant' || full) && <TakenDialog found={found} full={full} onClose={() => setSelected(null)} />}
    </>
  )
}
