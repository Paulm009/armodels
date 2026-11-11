import { useState } from 'react'
import { api, assetUrl } from '../api.js'

const KNOWN_TARGETS = [
  { name: 'cafe_altura', label: 'Afiche Café Altura' },
  { name: 'iconic_models', label: 'Afiche iconic models' },
]

const EMPTY_FORM = {
  nombre: '',
  local_id: '',
  estado: 'EN_PREPARACION',
  fecha_inicio: '2026-11-01',
  fecha_fin: '2026-12-31',
  titulo_promocion: '',
  condiciones_texto: '',
  cta_label: 'Ver condiciones',
  cta_url: 'https://www.paseoaranjuez.com/',
  target_name: 'cafe_altura',
  media_url: '/media/promo_cafe_altura.png',
}

export default function CampaignModal({ editing, locales, onClose, onSaved, showToast }) {
  const [form, setForm] = useState(() =>
    editing
      ? {
          nombre: editing.nombre || '',
          local_id: editing.local_id || '',
          estado: editing.estado || 'EN_PREPARACION',
          fecha_inicio: editing.fecha_inicio || '2026-11-01',
          fecha_fin: editing.fecha_fin || '2026-12-31',
          titulo_promocion: editing.content?.titulo_promocion || '',
          condiciones_texto: editing.content?.condiciones_texto || '',
          cta_label: editing.content?.cta_primaria_label || 'Ver condiciones',
          cta_url: editing.content?.cta_secundaria_url || 'https://www.paseoaranjuez.com/',
          target_name: editing.targets?.[0]?.nombre_tecnico || 'cafe_altura',
          media_url: editing.content?.media_url || '/media/promo_cafe_altura.png',
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function handleSave() {
    if (!form.nombre.trim() || !form.local_id) {
      setErr('El título y el local son obligatorios.')
      return
    }
    setSaving(true)
    setErr(null)

    const targetName = form.target_name || 'cafe_altura'
    const campaignId = editing ? editing.campaign_id : `camp-${Date.now()}`
    const target = {
      target_id: `tgt-${targetName}`,
      nombre_tecnico: targetName,
      image_path: `/image-targets/${targetName}_luminance.png`,
      thumbnail_path: `/image-targets/${targetName}_thumbnail.png`,
      original_path: `/image-targets/${targetName}_original.png`,
      properties: {},
      contrast_score: 86,
      qr_access_url: `${window.location.origin}/?campaign=${encodeURIComponent(campaignId)}`,
    }

    const content = {
      tipo_contenido: form.media_url.endsWith('.mp4') ? 'VIDEO_MP4' : 'PANEL_INFORMATIVO',
      media_url: form.media_url,
      media_mime_type: form.media_url.endsWith('.mp4') ? 'video/mp4' : 'image/png',
      media_size_bytes: 1024,
      titulo_promocion: form.titulo_promocion || form.nombre,
      condiciones_texto: form.condiciones_texto || 'Promoción sujeta a disponibilidad en el local.',
      cta_primaria_label: form.cta_label || 'Ver condiciones',
      cta_secundaria_label: 'Consultar al local',
      cta_secundaria_url: form.cta_url || 'https://www.paseoaranjuez.com/',
      overlay_config: { posX: 13, posY: 4, widthPct: 77, filename: form.media_url.split('/').pop() },
    }

    const payload = {
      campaign_id: campaignId,
      local_id: form.local_id,
      nombre: form.nombre.trim(),
      estado: form.estado,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin,
      target,
      content,
    }

    try {
      await api.createCampaign(payload)
      onSaved()
    } catch (e) {
      setErr(e.message)
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-[#e6e4dc] flex items-center justify-between sticky top-0 bg-white">
          <h2 className="font-display font-extrabold text-xl text-[#18241e]">
            {editing ? `Editar campaña (creará v${(editing.version || 0) + 1})` : 'Nueva campaña'}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#f4f3ee] text-[#657069]">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {err && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">{err}</div>}

          <Field label="Título de la campaña">
            <input value={form.nombre} onChange={set('nombre')} className={inputCls} placeholder="Ej. Una pausa para compartir" />
          </Field>

          <Field label="Local comercial">
            <select value={form.local_id} onChange={set('local_id')} className={inputCls}>
              <option value="">Selecciona un local…</option>
              {locales.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Estado">
              <select value={form.estado} onChange={set('estado')} className={inputCls}>
                <option value="EN_PREPARACION">En preparación</option>
                <option value="PUBLICADA">Publicada</option>
                <option value="ARCHIVADA">Archivada</option>
              </select>
            </Field>
            <Field label="Fecha inicio">
              <input type="date" value={form.fecha_inicio} onChange={set('fecha_inicio')} className={inputCls} />
            </Field>
            <Field label="Fecha fin">
              <input type="date" value={form.fecha_fin} onChange={set('fecha_fin')} className={inputCls} />
            </Field>
          </div>

          <Field label="Título de la promoción (overlay)">
            <input value={form.titulo_promocion} onChange={set('titulo_promocion')} className={inputCls} placeholder="Ej. 2 × 1 en capuchinos" />
          </Field>

          <Field label="Condiciones (texto accesible)">
            <textarea value={form.condiciones_texto} onChange={set('condiciones_texto')} rows={3} className={inputCls} />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Etiqueta CTA">
              <input value={form.cta_label} onChange={set('cta_label')} className={inputCls} />
            </Field>
            <Field label="URL CTA">
              <input value={form.cta_url} onChange={set('cta_url')} className={inputCls} />
            </Field>
          </div>

          <Field label="Imagen objetivo (8th Wall)">
            <select value={form.target_name} onChange={set('target_name')} className={inputCls}>
              {KNOWN_TARGETS.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-[#657069] mt-1">
              Los objetivos se generan con <code className="bg-[#eef0f2] px-1 rounded">npm run prepare-targets</code>.
            </p>
          </Field>

          <Field label="Contenido (imagen o video)">
            <input value={form.media_url} onChange={set('media_url')} className={inputCls} placeholder="/media/promo_cafe_altura.png" />
            {form.media_url.startsWith('/media/') && (
              <img src={assetUrl(form.media_url)} alt="vista previa" className="mt-2 w-32 rounded-lg border border-[#e6e4dc]" />
            )}
          </Field>
        </div>

        <div className="px-6 py-4 border-t border-[#e6e4dc] flex justify-end gap-3 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl border border-[#dcdad2] text-sm font-semibold">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving} className="btn-primary px-5 py-2.5 rounded-xl text-sm font-bold disabled:opacity-50">
            {saving ? 'Guardando…' : 'Guardar campaña'}
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
