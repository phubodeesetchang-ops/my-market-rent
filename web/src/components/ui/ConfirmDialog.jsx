import { useState } from 'react'
import { thaiError } from '../../lib/errors'
import Modal, { ModalSection } from './Modal'
import { Button, FormError } from './form'

/**
 * หน้าต่างยืนยันก่อนทำรายการที่ย้อนกลับยาก (ลบ / ระงับ)
 * onConfirm ต้อง throw เมื่อไม่สำเร็จ (ข้อความจะแสดงในหน้าต่าง) ถ้าสำเร็จให้ผู้เรียกปิดหน้าต่างเอง
 */
export default function ConfirmDialog({ title, children, confirmLabel, variant = 'danger', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function confirm() {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (e) {
      setError(thaiError(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <FormError>{error}</FormError>
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onClose} disabled={busy}>
              ยกเลิก
            </Button>
            <Button variant={variant} onClick={confirm} disabled={busy}>
              {busy ? 'กำลังดำเนินการ…' : confirmLabel}
            </Button>
          </div>
        </>
      }
    >
      <ModalSection>
        <div className="space-y-2">{children}</div>
      </ModalSection>
    </Modal>
  )
}
