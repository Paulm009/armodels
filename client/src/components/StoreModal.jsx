import { useState } from 'react'
import { api } from '../api.js'

const RUBROS = ['Gastronomía', 'Retail / Moda', 'Entretenimiento / Cine', 'Servicios / Oficinas']

export default function StoreModal({ editing, onClose, onSaved }) {
  const [form, setForm] = useState(() =>
    editing
      ? {
          nombre: editing.nombre || '',
          rubro: editing.rubro || 'Gastronomía',
          ubicacion: editing.ubicacion || '',
          whatsapp: editing.whatsapp || '',
          descripcion: editing.descripcion || '',
        }
      : { nombre: '', rubro: 'Gastronomía', ubicacion: '', whatsapp: '', descripcion: '' }
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.nombre.trim()) {
      setErr('El nombre es obligatorio.')
      return
    }
    setSaving(true)
    setErr(null)
    try {
      const data = {
        nombre: form.nombre.trim(),
        rubro: form.rubro,
        ubicacion: form.ubicacion,
        contacto_whatsapp: form.whatsapp,
        descripcion: form.descripcion,
      }
      if (editing) {
        await api.updateLocal(editing.id, data)
      } else {
        await api.createLocal(data)
      }
      onSaved()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg">
        <div className="px-6 py-5 border-b border-[#e6e4dc] flex items-center justify-between">
          <h2 className="font-display font-extrabold text-xl text-[#18241e]">
            {editing ? 'Editar local' : 'Nuevo local'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f4f3ee] text-[#657069]">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {err && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{err}</div>}

          <Field label="Nombre">
            <input value={form.nombre} onChange={set('nombre')} className={inputCls} placeholder="Ej. Café Altura" />
          </Field>
          <Field label="Rubro">
            <select value={form.rubro} onChange={set('rubro')} className={inputCls}>
              {RUBROS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Ubicación en el mall">
            <input value={form.ubicacion} onChange={set('ubicacion')} className={inputCls} placeholder="Ej. Planta baja" />
          </Field>
          <Field label="WhatsApp de contacto">
            <input value={form.whatsapp} onChange={set('whatsapp')} className={inputCls} placeholder="+591 …" />
          </Field>
          <Field label="Descripción">
            <textarea value={form.descripcion} onChange={set('descripcion')} rows={3} className={inputCls} />
          </Field>
        </div>

        <div className="px-6 py-4 border-t border-[#e6e4dc] flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar local'}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3.5 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1b4332]/20'

function Field({ label, children }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-[#4a5750]">{label}</label>
      {children}
    </div>
  )
}
