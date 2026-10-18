import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { thaiError } from '../../lib/errors'
import { currentPeriod, formatBaht, formatNumber, formatPeriod } from '../../lib/format'
import { isPeriod, utilityCost } from '../../lib/billing'
import { useLoader } from '../../lib/useLoader'
import { toNumberOrNull } from '../../lib/validate'
import { useAuth } from '../../auth/AuthProvider'
import { can } from '../../auth/permissions'
import { EmptyBox, LoadError, Notice, PageHeader } from '../../components/ui/feedback'
import { Button, Field, FormError, SelectInput, TextInput } from '../../components/ui/form'
import { PeriodPicker } from '../../components/invoices/parts'

const TYPES = [
  { key: 'electricity', label: 'ไฟฟ้า' },
  { key: 'water', label: 'น้ำ' },
]

async function fetchSheet(period) {
  const { data, error } = await supabase.rpc('meter_sheet', { p_period: period })
  if (error) throw error
  return data
}

const asText = (v) => (v === null || v === undefined ? '' : String(Number(v)))
const cellKey = (stallId, type) => `${stallId}:${type}`

/** ค่าตั้งต้นของช่องกรอก: เลขที่จดแล้ว หรือเลขครั้งก่อนที่แนะนำ + ช่องครั้งนี้ว่าง */
function initialCell(row, type) {
  return {
    previous: asText(row[`${type}_reading_id`] ? row[`${type}_previous`] : row[`${type}_suggested`]),
    current: asText(row[`${type}_current`]),
  }
}

/**
 * ตรวจช่องเดียว → { changed, error, field, payload }
 * payload = แถวที่จะบันทึก (null ถ้าไม่มีอะไรเปลี่ยนหรือยังกรอกไม่ครบ), field = ช่องที่ผิด
 */
function evaluate(row, type, cell, period) {
  const saved = Boolean(row[`${type}_reading_id`])
  const init = initialCell(row, type)
  const changed = cell.previous.trim() !== init.previous || cell.current.trim() !== init.current
  const result = (error = '', field = null, payload = null) => ({ changed, error, field, payload })
  if (!changed) return result()
  const prev = toNumberOrNull(cell.previous)
  const cur = toNumberOrNull(cell.current)
  if (cell.current.trim() === '') return saved ? result('ลบเลขที่บันทึกแล้วไม่ได้ ให้แก้เป็นเลขที่ถูกต้อง', 'current') : result()
  if (!Number.isFinite(cur) || cur < 0) return result('เลขครั้งนี้ต้องเป็นตัวเลข', 'current')
  if (prev === null) return result('กรอกเลขครั้งก่อนด้วย', 'previous')
  if (!Number.isFinite(prev) || prev < 0) return result('เลขครั้งก่อนต้องเป็นตัวเลข', 'previous')
  if (cur < prev) return result('เลขครั้งนี้น้อยกว่าครั้งก่อน', 'current')
  return result('', null, { stall_id: row.stall_id, utility_type: type, billing_period: period, previous_reading: prev, current_reading: cur })
}

/** ช่องกรอกของมิเตอร์หนึ่งประเภทในแผงหนึ่ง */
function MeterInputs({ row, type, label, cell, check, readOnly, onChange, onEnter }) {
  const error = check.error
  const locked = row[`${type}_invoice_no`]
  const prev = toNumberOrNull(cell.previous)
  const cur = toNumberOrNull(cell.current)
  const rate = row[`${type}_rate`] === null ? null : Number(row[`${type}_rate`])
  const units = prev !== null && cur !== null && cur >= prev ? cur - prev : null
  const cost = utilityCost(prev, cur, rate)
  const id = `m-${row.stall_id}-${type}`
  const where = `${row.unit_type === 'room' ? 'ห้อง' : 'แผง'} ${row.stall_code} ${row.market_name}`
  const disabled = readOnly || Boolean(locked)
  // ช่องที่แก้แล้วแต่ยังไม่บันทึก: พื้นเหลืองอ่อน ให้เห็นว่ายังค้างอยู่
  const init = initialCell(row, type)
  const input = (changed) =>
    `w-full rounded-md border border-line px-2 py-1.5 text-right tabular-nums focus:border-leaf-700 focus:outline-none focus:ring-2 focus:ring-leaf-300 disabled:bg-leaf-50 disabled:text-muted aria-[invalid=true]:border-danger ${changed ? 'bg-stall-reserved/40' : 'bg-white'}`
  return (
    <div className="min-w-0">
      <div className="grid grid-cols-2 gap-1.5">
        <label className="min-w-0">
          <span className="block text-xs text-muted">ครั้งก่อน</span>
          <input
            id={`${id}-prev`}
            aria-label={`${label} ครั้งก่อน ${where}`}
            aria-describedby={`${id}-hint`}
            className={input(cell.previous.trim() !== init.previous)}
            inputMode="decimal"
            autoComplete="off"
            value={cell.previous}
            disabled={disabled}
            aria-invalid={check.field === 'previous' ? true : undefined}
            onChange={(e) => onChange({ ...cell, previous: e.target.value })}
          />
        </label>
        <label className="min-w-0">
          <span className="block text-xs text-muted">ครั้งนี้</span>
          <input
            id={`${id}-cur`}
            data-col={`${type}-current`}
            aria-label={`${label} ครั้งนี้ ${where}`}
            aria-describedby={`${id}-hint`}
            className={input(cell.current.trim() !== init.current)}
            inputMode="decimal"
            autoComplete="off"
            value={cell.current}
            disabled={disabled}
            aria-invalid={check.field === 'current' ? true : undefined}
            onChange={(e) => onChange({ ...cell, current: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onEnter(e.currentTarget)
              }
            }}
          />
        </label>
      </div>
      <p id={`${id}-hint`} className={`mt-1 text-xs tabular-nums ${error ? 'font-medium text-danger' : 'text-muted'}`}>
        {error ||
          (locked
            ? `อยู่ในใบแจ้งหนี้ ${locked}`
            : units !== null
              ? `${formatNumber(units)} หน่วย × ${formatBaht(rate, { withUnit: false })} = ${formatBaht(cost)}`
              : rate === null
                ? 'ตลาดนี้ยังไม่ได้ตั้งอัตรา'
                : `อัตรา ${formatBaht(rate, { withUnit: false })} บาท/หน่วย`)}
      </p>
    </div>
  )
}

export default function MeterReadingsPage() {
  const { role } = useAuth()
  const [params, setParams] = useSearchParams()
  // รอบบิลอยู่ใน URL (?period=2026-10) รีเฟรชหรือส่งลิงก์ต่อแล้วยังเป็นรอบเดิม
  const period = isPeriod(params.get('period')) ? params.get('period') : currentPeriod()
  const { data: rows, error, loading, reload } = useLoader(() => fetchSheet(period), period)
  const [marketId, setMarketId] = useState('all')
  const [zone, setZone] = useState('all')
  const [query, setQuery] = useState('')
  const [onlyMissing, setOnlyMissing] = useState(false)
  const [edits, setEdits] = useState({}) // key → { previous, current }
  const [saving, setSaving] = useState(false)
  const [savedRows, setSavedRows] = useState(null) // ข้อมูลชุดก่อนบันทึก: ล้างการแก้ไขเมื่อโหลดชุดใหม่มาแล้ว (ไม่ให้เลขกระพริบกลับ)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState(null)
  // โหลดใหม่ไม่สำเร็จ ก็ปลดล็อกปุ่มด้วย (ข้อมูลบันทึกแล้ว แถบแดงด้านบนให้กดโหลดใหม่)
  if (savedRows && (rows !== savedRows || (!loading && error))) {
    setSavedRows(null)
    setEdits({})
  }
  const busy = saving || savedRows !== null

  const canOperate = can(role, 'manageOperations')
  const all = rows ?? []
  const markets = [...new Map(all.map((r) => [r.market_id, r.market_name])).entries()]
  const zones = [...new Set(all.filter((r) => marketId === 'all' || String(r.market_id) === marketId).map((r) => r.zone_name))]
  const cellOf = (row, type) => edits[cellKey(row.stall_id, type)] ?? initialCell(row, type)

  // ตรวจทุกช่องที่แก้
  const checks = new Map(all.flatMap((row) => TYPES.map((t) => [cellKey(row.stall_id, t.key), evaluate(row, t.key, cellOf(row, t.key), period)])))
  const checkOf = (row, type) => checks.get(cellKey(row.stall_id, type))
  const results = [...checks.values()]
  const payloads = results.filter((c) => c.payload).map((c) => c.payload)
  const problems = results.filter((c) => c.error).length
  const dirty = results.some((c) => c.changed)

  const text = query.trim().toLowerCase()
  const list = all.filter(
    (r) =>
      (marketId === 'all' || String(r.market_id) === marketId) &&
      (zone === 'all' || r.zone_name === zone) &&
      (!text || r.stall_code.toLowerCase().includes(text) || r.tenant_name?.toLowerCase().includes(text) || r.business_name?.toLowerCase().includes(text)) &&
      (!onlyMissing || !r.electricity_reading_id || !r.water_reading_id),
  )
  const done = (type) => all.filter((r) => r[`${type}_reading_id`]).length

  function setCell(row, type, cell) {
    setEdits((e) => ({ ...e, [cellKey(row.stall_id, type)]: cell }))
  }

  // Enter ในช่อง "ครั้งนี้" → ไปช่องเดียวกันของแผงถัดไป (จดเรียงแผงได้เร็ว)
  function focusNext(el) {
    const col = el.dataset.col
    const inputs = [...document.querySelectorAll(`input[data-col="${col}"]:not([disabled])`)].filter((x) => x.offsetParent !== null)
    const next = inputs[inputs.indexOf(el) + 1]
    if (next) next.focus()
  }

  async function save() {
    setFormError('')
    if (problems > 0) return setFormError(`มี ${problems} ช่องที่ต้องแก้ก่อนบันทึก (ดูข้อความสีแดง)`)
    if (payloads.length === 0) return
    setSaving(true)
    const { data, error: e } = await supabase
      .from('utility_readings')
      .upsert(payloads, { onConflict: 'stall_id,utility_type,billing_period' })
      .select('reading_id')
    setSaving(false)
    if (e) return setFormError(thaiError(e))
    if (!data?.length) return setFormError('บันทึกไม่สำเร็จ บัญชีนี้ไม่มีสิทธิ์จดมิเตอร์')
    setSavedRows(rows)
    setNotice({ tone: 'ok', text: `บันทึกมิเตอร์รอบ ${formatPeriod(period, { long: true })} แล้ว ${formatNumber(data.length)} รายการ` })
    reload()
  }

  return (
    <div className="mx-auto max-w-6xl pb-24">
      <PageHeader
        title="จดมิเตอร์น้ำ-ไฟ"
        description="บันทึกเลขมิเตอร์ประจำเดือนของแผงที่มีสัญญา เลขครั้งก่อนดึงจากเดือนที่แล้วให้อัตโนมัติ · กด Enter ในช่อง ครั้งนี้ เพื่อไปแผงถัดไป"
      />
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <div className="mt-6 flex flex-wrap items-end gap-3">
        <PeriodPicker
          className="w-60"
          value={period}
          disabled={dirty}
          hint={dirty ? 'บันทึกหรือยกเลิกการแก้ไขก่อนเปลี่ยนรอบ' : undefined}
          onChange={(p) => {
            setParams({ period: p }, { replace: true })
            setEdits({})
            setNotice(null)
          }}
        />
        <Field label="ตลาด" className="w-44">
          <SelectInput
            value={marketId}
            onChange={(e) => {
              setMarketId(e.target.value)
              setZone('all')
            }}
          >
            <option value="all">ทุกตลาด</option>
            {markets.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="โซน" className="w-32">
          <SelectInput value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="all">ทุกโซน</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                โซน {z}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="ค้นหา" className="min-w-0 flex-1 basis-48">
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="รหัสแผง หรือชื่อผู้เช่า" />
        </Field>
        <label className="inline-flex items-center gap-2 pb-2">
          <input type="checkbox" className="h-4 w-4 accent-leaf-700" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
          <span>เฉพาะที่ยังจดไม่ครบ</span>
        </label>
      </div>

      {error && <LoadError what="รายการมิเตอร์" message={error} onRetry={reload} />}
      {!rows && !error && <p className="mt-8 text-muted" aria-live="polite">กำลังโหลดรายการแผง…</p>}

      {rows && (
        <>
          <p className="mt-4 mb-2 text-sm text-muted tabular-nums" aria-live="polite">
            {formatNumber(all.length)} แผงที่มีสัญญาในรอบนี้ · จดแล้ว ไฟ {formatNumber(done('electricity'))}/{formatNumber(all.length)} · น้ำ{' '}
            {formatNumber(done('water'))}/{formatNumber(all.length)}
            {loading && ' · กำลังโหลดใหม่…'}
          </p>
          {list.length === 0 ? (
            <EmptyBox>{all.length === 0 ? 'ไม่มีแผงที่มีสัญญาในรอบบิลนี้' : 'ไม่พบแผงที่ตรงกับตัวกรอง'}</EmptyBox>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line" aria-label="รายการมิเตอร์">
              {list.map((row) => (
                <li key={row.stall_id} className="grid gap-3 px-4 py-3 md:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)] md:items-start" data-stall-row={row.stall_code}>
                  <div className="min-w-0">
                    <p className="font-medium text-ink">
                      {row.unit_type === 'room' ? 'ห้อง' : 'แผง'} {row.stall_code}{' '}
                      <span className="font-normal text-muted">
                        {row.market_name} โซน {row.zone_name}
                      </span>
                    </p>
                    <p className="truncate text-sm text-muted">{row.tenant_name}</p>
                  </div>
                  {TYPES.map((t) => (
                    <fieldset key={t.key} className="min-w-0">
                      <legend className="mb-0.5 text-sm font-medium text-leaf-800">{t.label}</legend>
                      <MeterInputs
                        row={row}
                        type={t.key}
                        label={t.label}
                        cell={cellOf(row, t.key)}
                        check={checkOf(row, t.key)}
                        readOnly={!canOperate}
                        onChange={(cell) => setCell(row, t.key, cell)}
                        onEnter={focusNext}
                      />
                    </fieldset>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {canOperate && rows && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 px-4 py-3 backdrop-blur lg:left-[17rem]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <FormError>{formError}</FormError>
              {!formError && (
                <p className="text-sm text-muted">
                  {payloads.length > 0 ? `แก้ไขแล้ว ${formatNumber(payloads.length)} รายการ ยังไม่ได้บันทึก` : 'ยังไม่มีการแก้ไข'}
                  {problems > 0 && <span className="font-medium text-danger"> · ต้องแก้ {formatNumber(problems)} ช่อง</span>}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setEdits({})
                  setFormError('')
                }}
                disabled={!dirty || busy}
              >
                ยกเลิกการแก้ไข
              </Button>
              <Button variant="primary" size="md" onClick={save} disabled={busy || payloads.length === 0}>
                {busy ? 'กำลังบันทึก…' : `บันทึก${payloads.length ? ` ${formatNumber(payloads.length)} รายการ` : ''}`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
