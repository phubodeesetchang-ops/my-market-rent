import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { formatBaht, formatDate, formatNumber, todayISO } from '../../lib/format'
import { FEE_PERIOD, MARKET_TYPE, UTILITY_TYPE } from '../../lib/labels'
import { useLoader } from '../../lib/useLoader'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { ActiveBadge, Badge, DataTable, EmptyBox, LoadError, Notice, PageHeader, Td, Th } from '../../components/ui/feedback'
import { Button } from '../../components/ui/form'
import { FeeFormDialog, MarketFormDialog, PromptPayDialog, RateDialog, ZoneFormDialog } from '../../components/markets/MarketDialogs'
import { PromptPayQR } from '../../components/payments/PromptPayQR'
import { formatPromptPayId } from '../../lib/promptpay'

async function fetchMarketSettings() {
  const { data, error } = await supabase
    .from('markets')
    .select(
      'market_id, market_name, market_type, description, status, promptpay_id, promptpay_name, zones(zone_id, zone_name, description, stalls(count)), utility_rates(rate_id, utility_type, rate_per_unit, unit_name, effective_from, effective_to, status), fees(fee_id, fee_name, fee_amount, fee_period, status)',
    )
    .order('market_id')
    .order('zone_name', { referencedTable: 'zones' })
    .order('effective_from', { referencedTable: 'utility_rates', ascending: false })
    .order('fee_id', { referencedTable: 'fees' })
  if (error) throw error
  return data
}

const stallCount = (zone) => zone.stalls?.[0]?.count ?? 0

/** อัตราที่ใช้อยู่วันนี้ และอัตราที่ตั้งไว้ล่วงหน้า */
function ratesOf(market, type, today) {
  const list = market.utility_rates.filter((r) => r.utility_type === type && r.status === 'active')
  const current = list.find((r) => r.effective_from <= today && (!r.effective_to || r.effective_to >= today)) ?? null
  const upcoming = list.filter((r) => r.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))
  return { list, current, upcoming }
}

function Section({ title, action, children }) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3 border-b border-line pb-2">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function RateCard({ market, type, today, canEdit, onChange }) {
  const { list, current, upcoming } = ratesOf(market, type, today)
  return (
    <div className="rounded-xl border border-line bg-white px-5 py-4" data-rate={type}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-medium text-muted">ค่า{UTILITY_TYPE[type]}</p>
          {current ? (
            <>
              <p className="text-2xl font-semibold text-ink tabular-nums">
                {formatBaht(current.rate_per_unit, { withUnit: false })}
                <span className="text-base font-normal text-muted"> บาท/หน่วย</span>
              </p>
              <p className="text-sm text-muted">ใช้ตั้งแต่ {formatDate(current.effective_from)}</p>
            </>
          ) : (
            <p className="mt-1 font-medium text-danger">ยังไม่มีอัตราที่ใช้วันนี้</p>
          )}
        </div>
        {canEdit && (
          <Button onClick={() => onChange(type, current, upcoming)}>{current ? 'เปลี่ยนอัตรา' : 'ตั้งอัตรา'}</Button>
        )}
      </div>
      {upcoming.map((r) => (
        <p key={r.rate_id} className="mt-3 rounded-lg bg-stall-reserved/60 px-3 py-1.5 text-sm text-stall-reserved-ink">
          อัตราใหม่ {formatBaht(r.rate_per_unit)}/หน่วย เริ่ม {formatDate(r.effective_from)}
        </p>
      ))}
      {list.length > 1 && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer font-medium text-leaf-700">ประวัติอัตรา ({list.length})</summary>
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
            {list.map((r) => (
              <li key={r.rate_id} className="flex justify-between gap-3 px-3 py-1.5 tabular-nums">
                <span>
                  {formatDate(r.effective_from)} – {r.effective_to ? formatDate(r.effective_to) : 'ปัจจุบัน'}
                </span>
                <span className="font-medium">{formatBaht(r.rate_per_unit)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

export default function MarketsPage() {
  const { role } = useAuth()
  const { data: markets, error, loading, reload } = useLoader(fetchMarketSettings)
  const [pickedId, setPickedId] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [notice, setNotice] = useState(null)

  const canEdit = can(role, 'manageMarketSettings')
  const market = markets?.find((m) => m.market_id === pickedId) ?? markets?.[0] ?? null
  const today = todayISO()

  function done(text) {
    setNotice({ tone: 'ok', text })
    setDialog(null)
    reload()
  }

  async function toggleFee(fee) {
    const next = fee.status === 'active' ? 'inactive' : 'active'
    const { data, error: e } = await supabase.from('fees').update({ status: next }).eq('fee_id', fee.fee_id).select('fee_id')
    if (e || !data?.length) return setNotice({ tone: 'error', text: e ? thaiError(e) : 'บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์' })
    done(next === 'active' ? `เปิดใช้${fee.fee_name}แล้ว` : `ระงับ${fee.fee_name}แล้ว`)
  }

  async function removeRow(table, idColumn, id, text) {
    const { error: e, count } = await supabase.from(table).delete({ count: 'exact' }).eq(idColumn, id)
    if (e) throw e.code === '23503' ? new Error('ลบไม่ได้ เพราะยังมีข้อมูลอื่นอ้างอิงอยู่') : e
    if (count === 0) throw new Error('ลบไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์ลบ (เฉพาะผู้ดูแลระบบ)')
    done(text)
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="ตลาดและอัตราค่าบริการ"
        description={
          canEdit
            ? 'ข้อมูลตลาด อัตราค่าน้ำ-ไฟ ค่าธรรมเนียม และโซน'
            : 'ข้อมูลตลาด อัตราค่าน้ำ-ไฟ ค่าธรรมเนียม และโซน (แก้ไขได้เฉพาะผู้ดูแลระบบ)'
        }
        actions={
          canEdit && (
            <Button variant="primary" size="md" onClick={() => setDialog({ type: 'market-new' })}>
              + เพิ่มตลาด
            </Button>
          )
        }
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      {error && <LoadError what="ข้อมูลตลาด" message={error} onRetry={reload} />}
      {!markets && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดข้อมูลตลาด…</p>}
      {markets?.length === 0 && <EmptyBox>ยังไม่มีตลาดในระบบ</EmptyBox>}

      {market && (
        <>
          <div role="tablist" aria-label="เลือกตลาด" className="mt-6 flex flex-wrap gap-2">
            {markets.map((m) => {
              const active = m.market_id === market.market_id
              return (
                <button
                  key={m.market_id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setPickedId(m.market_id)}
                  className={`rounded-lg px-4 py-2 font-medium ${
                    active ? 'bg-leaf-700 text-white' : 'border border-line bg-white text-ink hover:bg-leaf-100'
                  }`}
                >
                  {m.market_name}
                  {m.status !== 'active' && <span className={active ? 'text-white/80' : 'text-muted'}> (ระงับ)</span>}
                </button>
              )
            })}
          </div>

          <div role="tabpanel" aria-label={market.market_name} className={loading ? 'opacity-70 transition-opacity' : ''}>
            <div className="mt-6 flex flex-wrap items-start justify-between gap-4 rounded-xl border border-line bg-leaf-50 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h2 className="text-xl font-semibold text-ink">{market.market_name}</h2>
                  <Badge tone="outline">{MARKET_TYPE[market.market_type]}</Badge>
                  <ActiveBadge status={market.status} />
                </div>
                <p className="mt-1 text-muted">
                  {market.description || 'ไม่มีรายละเอียด'} · {formatNumber(market.zones.length)} โซน ·{' '}
                  {formatNumber(market.zones.reduce((n, z) => n + stallCount(z), 0))} {market.market_type === 'building' ? 'ห้อง' : 'แผง'}
                </p>
              </div>
              {canEdit && <Button onClick={() => setDialog({ type: 'market-edit' })}>แก้ไขข้อมูลตลาด</Button>}
            </div>

            <Section title="อัตราค่าน้ำ-ไฟ">
              <div className="grid gap-4 md:grid-cols-2">
                {['electricity', 'water'].map((type) => (
                  <RateCard
                    key={type}
                    market={market}
                    type={type}
                    today={today}
                    canEdit={canEdit}
                    onChange={(t, current, upcoming) => setDialog({ type: 'rate', utility: t, current, upcoming })}
                  />
                ))}
              </div>
            </Section>

            <Section
              title="รับชำระผ่านพร้อมเพย์"
              action={canEdit && <Button onClick={() => setDialog({ type: 'promptpay' })}>{market.promptpay_id ? 'แก้ไขพร้อมเพย์' : 'ตั้งพร้อมเพย์'}</Button>}
            >
              {market.promptpay_id ? (
                <div className="flex flex-wrap items-center gap-5 rounded-xl border border-line px-5 py-4">
                  <PromptPayQR promptpayId={market.promptpay_id} name={market.promptpay_name} size={112} caption={false} />
                  <div className="min-w-0">
                    <p className="text-lg font-semibold text-ink tabular-nums">{formatPromptPayId(market.promptpay_id)}</p>
                    <p className="text-muted">{market.promptpay_name}</p>
                    <p className="mt-1 text-sm text-muted">ใบแจ้งหนี้ของแผงในตลาดนี้จะมี QR พร้อมยอดเงินให้ผู้เช่าสแกนจ่าย · QR ทางซ้ายไม่มียอด ใช้ทดสอบชื่อบัญชี</p>
                  </div>
                </div>
              ) : (
                <EmptyBox>ยังไม่ได้ตั้งพร้อมเพย์ — ใบแจ้งหนี้ของตลาดนี้จะไม่มี QR (ผู้เช่าชำระเงินสด/แจ้งโอนได้ตามปกติ)</EmptyBox>
              )}
            </Section>

            <Section
              title="ค่าธรรมเนียม"
              action={canEdit && <Button onClick={() => setDialog({ type: 'fee-new' })}>+ เพิ่มค่าธรรมเนียม</Button>}
            >
              {market.fees.length === 0 ? (
                <EmptyBox>ยังไม่มีค่าธรรมเนียมของตลาดนี้</EmptyBox>
              ) : (
                <>
                <ul className="divide-y divide-line rounded-xl border border-line sm:hidden" aria-label={`ค่าธรรมเนียมของ${market.market_name}`}>
                  {market.fees.map((f) => (
                    <li key={f.fee_id} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-ink">{f.fee_name}</p>
                          <p className="text-sm text-muted">
                            {formatBaht(f.fee_amount)} · {FEE_PERIOD[f.fee_period] ?? '-'}
                          </p>
                        </div>
                        <ActiveBadge status={f.status} />
                      </div>
                      {canEdit && (
                        <div className="-ml-3 mt-1 flex flex-wrap gap-1">
                          <Button variant="ghost" onClick={() => setDialog({ type: 'fee-edit', fee: f })}>
                            แก้ไข
                          </Button>
                          <Button variant="ghost" onClick={() => toggleFee(f)}>
                            {f.status === 'active' ? 'ระงับ' : 'เปิดใช้'}
                          </Button>
                          <Button variant="danger-ghost" onClick={() => setDialog({ type: 'fee-delete', fee: f })}>
                            ลบ
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <DataTable label={`ค่าธรรมเนียมของ${market.market_name}`} className="hidden sm:block">
                  <thead>
                    <tr>
                      <Th>ชื่อ</Th>
                      <Th className="text-right">จำนวนเงิน</Th>
                      <Th>เรียกเก็บ</Th>
                      <Th>สถานะ</Th>
                      {canEdit && <Th className="text-right">จัดการ</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {market.fees.map((f) => (
                      <tr key={f.fee_id}>
                        <Td className="font-medium">{f.fee_name}</Td>
                        <Td className="text-right tabular-nums">{formatBaht(f.fee_amount)}</Td>
                        <Td>{FEE_PERIOD[f.fee_period] ?? '-'}</Td>
                        <Td>
                          <ActiveBadge status={f.status} />
                        </Td>
                        {canEdit && (
                          <Td className="text-right whitespace-nowrap">
                            <Button variant="ghost" onClick={() => setDialog({ type: 'fee-edit', fee: f })}>
                              แก้ไข
                            </Button>
                            <Button variant="ghost" onClick={() => toggleFee(f)}>
                              {f.status === 'active' ? 'ระงับ' : 'เปิดใช้'}
                            </Button>
                            <Button variant="danger-ghost" onClick={() => setDialog({ type: 'fee-delete', fee: f })}>
                              ลบ
                            </Button>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                </>
              )}
            </Section>

            <Section title="โซน" action={canEdit && <Button onClick={() => setDialog({ type: 'zone-new' })}>+ เพิ่มโซน</Button>}>
              {market.zones.length === 0 ? (
                <EmptyBox>ยังไม่มีโซนในตลาดนี้</EmptyBox>
              ) : (
                <>
                <ul className="divide-y divide-line rounded-xl border border-line sm:hidden" aria-label={`โซนของ${market.market_name}`}>
                  {market.zones.map((z) => (
                    <li key={z.zone_id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="font-medium text-ink">
                          โซน {z.zone_name}{' '}
                          <span className="font-normal text-muted">
                            · {formatNumber(stallCount(z))} {market.market_type === 'building' ? 'ห้อง' : 'แผง'}
                          </span>
                        </p>
                        {z.description && <p className="text-sm text-muted">{z.description}</p>}
                      </div>
                      {canEdit && (
                        <div className="flex shrink-0 gap-1">
                          <Button variant="ghost" onClick={() => setDialog({ type: 'zone-edit', zone: z })}>
                            แก้ไข
                          </Button>
                          <Button
                            variant="danger-ghost"
                            onClick={() => setDialog({ type: 'zone-delete', zone: z })}
                            disabled={stallCount(z) > 0}
                            title={stallCount(z) > 0 ? 'ลบได้เฉพาะโซนที่ไม่มีแผง' : undefined}
                          >
                            ลบ
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
                <DataTable label={`โซนของ${market.market_name}`} className="hidden sm:block">
                  <thead>
                    <tr>
                      <Th>โซน</Th>
                      <Th>รายละเอียด</Th>
                      <Th className="text-right">จำนวน{market.market_type === 'building' ? 'ห้อง' : 'แผง'}</Th>
                      {canEdit && <Th className="text-right">จัดการ</Th>}
                    </tr>
                  </thead>
                  <tbody>
                    {market.zones.map((z) => (
                      <tr key={z.zone_id}>
                        <Td className="font-medium">โซน {z.zone_name}</Td>
                        <Td className="text-muted">{z.description || '-'}</Td>
                        <Td className="text-right tabular-nums">{formatNumber(stallCount(z))}</Td>
                        {canEdit && (
                          <Td className="text-right whitespace-nowrap">
                            <Button variant="ghost" onClick={() => setDialog({ type: 'zone-edit', zone: z })}>
                              แก้ไข
                            </Button>
                            <Button
                              variant="danger-ghost"
                              onClick={() => setDialog({ type: 'zone-delete', zone: z })}
                              disabled={stallCount(z) > 0}
                              title={stallCount(z) > 0 ? 'ลบได้เฉพาะโซนที่ไม่มีแผง' : undefined}
                            >
                              ลบ
                            </Button>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                </>
              )}
              {canEdit && market.zones.some((z) => stallCount(z) > 0) && (
                <p className="mt-2 text-sm text-muted">ลบได้เฉพาะโซนที่ไม่มีแผงแล้ว (ลบแผงได้ที่หน้าภาพรวมหรือหน้าแผงค้า)</p>
              )}
            </Section>
          </div>
        </>
      )}

      {dialog?.type === 'market-new' && (
        <MarketFormDialog
          onClose={() => setDialog(null)}
          onSaved={(id, text) => {
            setPickedId(id)
            done(text)
          }}
        />
      )}
      {dialog?.type === 'market-edit' && market && (
        <MarketFormDialog market={market} onClose={() => setDialog(null)} onSaved={(_id, text) => done(text)} />
      )}
      {dialog?.type === 'promptpay' && market && (
        <PromptPayDialog market={market} onClose={() => setDialog(null)} onSaved={(_id, text) => done(text)} />
      )}
      {(dialog?.type === 'zone-new' || dialog?.type === 'zone-edit') && market && (
        <ZoneFormDialog market={market} zone={dialog.zone} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === 'zone-delete' && (
        <ConfirmDialog
          title={`ลบโซน ${dialog.zone.zone_name}`}
          confirmLabel="ลบโซน"
          onClose={() => setDialog(null)}
          onConfirm={() => removeRow('zones', 'zone_id', dialog.zone.zone_id, `ลบโซน ${dialog.zone.zone_name} แล้ว`)}
        >
          <p>
            ลบโซน {dialog.zone.zone_name} ออกจาก{market.market_name}ถาวร?
          </p>
        </ConfirmDialog>
      )}
      {dialog?.type === 'rate' && market && (
        <RateDialog market={market} utilityType={dialog.utility} current={dialog.current} upcoming={dialog.upcoming} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {(dialog?.type === 'fee-new' || dialog?.type === 'fee-edit') && market && (
        <FeeFormDialog market={market} fee={dialog.fee} onClose={() => setDialog(null)} onSaved={done} />
      )}
      {dialog?.type === 'fee-delete' && (
        <ConfirmDialog
          title={`ลบ${dialog.fee.fee_name}`}
          confirmLabel="ลบค่าธรรมเนียม"
          onClose={() => setDialog(null)}
          onConfirm={() => removeRow('fees', 'fee_id', dialog.fee.fee_id, `ลบ${dialog.fee.fee_name}แล้ว`)}
        >
          <p>ลบ{dialog.fee.fee_name}ของ{market.market_name}ถาวร?</p>
          <p className="text-sm text-muted">ถ้าแค่ไม่ต้องการเก็บชั่วคราว ให้ใช้ "ระงับ" แทน</p>
        </ConfirmDialog>
      )}
    </div>
  )
}
