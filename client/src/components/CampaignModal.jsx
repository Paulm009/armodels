import { useEffect, useRef, useState } from 'react'
import { api, assetUrl } from '../api.js'

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
  media_mime_type: 'image/png',
}

function inferMediaMime(url) {
  const u = (url || '').toLowerCase()
  if (u.endsWith('.mp4')) return 'video/mp4'
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg'
  if (u.endsWith('.png')) return 'image/png'
  if (u.endsWith('.webp')) return 'image/webp'
  return ''
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
          media_mime_type: editing.content?.media_mime_type || 'image/png',
        }
      : EMPTY_FORM
  )
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)
  const [targets, setTargets] = useState([])
  const [targetsLoading, setTargetsLoading] = useState(true)
  const [uploadingTarget, setUploadingTarget] = useState(false)
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const targetFileRef = useRef(null)
  const mediaFileRef = useRef(null)

  useEffect(() => {
    let active = true
    api
      .listImageTargets()
      .then((list) => {
        if (!active) return
        setTargets(list)
        if (!editing && list.length > 0) {
          setForm((f) => {
            const stillExists = list.some((t) => t.name === f.target_name)
            return stillExists ? f : { ...f, target_name: list[0].name }
          })
        }
      })
      .catch((e) => {
        if (active) setErr(e.message)
      })
      .finally(() => {
        if (active) setTargetsLoading(false)
      })
    return () => {
      active = false
    }
  }, [editing])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const setMediaUrl = (e) => {
    const url = e.target.value
    setForm((f) => ({ ...f, media_url: url, media_mime_type: inferMediaMime(url) || f.media_mime_type }))
  }

  const selectedTarget = targets.find((t) => t.name === form.target_name)

  async function handleTargetFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploadingTarget(true)
    setErr(null)
    try {
      const created = await api.createImageTarget(file)
      setTargets((list) => {
        const withoutDup = list.filter((t) => t.name !== created.name)
        return [...withoutDup, created].sort((a, b) => a.name.localeCompare(b.name))
      })
      setForm((f) => ({ ...f, target_name: created.name }))
      showToast && showToast('Afiche objetivo creado correctamente.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setUploadingTarget(false)
    }
  }

  async function handleMediaFile(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = ''
    if (!file) return
    setUploadingMedia(true)
    setErr(null)
    try {
      const media = await api.uploadMedia(file)
      setForm((f) => ({ ...f, media_url: media.url, media_mime_type: media.mimeType }))
      showToast && showToast('Contenido AR subido correctamente.')
    } catch (e) {
      setErr(e.message)
    } finally {
      setUploadingMedia(false)
    }
  }

  async function handleSave() {
    if (!form.nombre.trim() || !form.local_id) {
      setErr('El título y el local son obligatorios.')
      return
    }
    if (!form.target_name) {
      setErr('Selecciona o sube un afiche para el seguimiento de imagen.')
      return
    }
    if (!form.media_url) {
      setErr('Selecciona o sube el contenido AR (video o imagen).')
      return
    }
    setSaving(true)
    setErr(null)

    const targetName = form.target_name
    const mime = form.media_mime_type || inferMediaMime(form.media_url) || 'image/png'
    const isVideo = mime.startsWith('video/')
    const target = {
      target_id: `tgt-${targetName}`,
      nombre_tecnico: targetName,
      image_path: selectedTarget?.imagePath || `/image-targets/${targetName}_luminance.png`,
      thumbnail_path: selectedTarget?.thumbnail || `/image-targets/${targetName}_thumbnail.png`,
      original_path: selectedTarget?.resources?.originalImage
        ? `/image-targets/${selectedTarget.resources.originalImage}`
        : `/image-targets/${targetName}_original.png`,
      properties: selectedTarget?.properties || {},
      contrast_score: 86,
      qr_access_url: `https://localhost/?campaign=${editing ? editing.campaign_id : 'nueva'}`,
    }

    const content = {
      tipo_contenido: isVideo ? 'VIDEO_MP4' : 'PANEL_INFORMATIVO',
      media_url: form.media_url,
      media_mime_type: mime,
      media_size_bytes: 1024,
      titulo_promocion: form.titulo_promocion || form.nombre,
      condiciones_texto: form.condiciones_texto || 'Promoción sujeta a disponibilidad en el local.',
      cta_primaria_label: form.cta_label || 'Ver condiciones',
      cta_secundaria_label: 'Consultar al local',
      cta_secundaria_url: form.cta_url || 'https://www.paseoaranjuez.com/',
      overlay_config: { posX: 13, posY: 4, widthPct: 77, filename: form.media_url.split('/').pop() },
    }

    const payload = {
      campaign_id: editing ? editing.campaign_id : `camp-${Date.now()}`,
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

          <Field label="Afiche para el seguimiento (image tracking)">
            {targetsLoading ? (
              <p className="text-xs text-[#657069]">Cargando afiches disponibles…</p>
            ) : targets.length === 0 ? (
              <p className="text-xs text-[#657069]">No hay afiches generados. Sube uno para crear el objetivo de seguimiento.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {targets.map((t) => (
                  <button
                    type="button"
                    key={t.name}
                    onClick={() => setForm((f) => ({ ...f, target_name: t.name }))}
                    className={`rounded-xl border p-2 text-left transition ${
                      form.target_name === t.name
                        ? 'border-[#1b4332] ring-2 ring-[#1b4332]/20 bg-[#f4f8f1]'
                        : 'border-[#dcdad2] hover:border-[#1b4332]/40'
                    }`}
                  >
                    <img
                      src={assetUrl(t.thumbnail || t.imagePath)}
                      alt={t.name}
                      className="w-full h-20 object-cover rounded-lg bg-[#f1f3ef]"
                    />
                    <div className="mt-1.5 text-xs font-semibold text-[#18241e] truncate">{t.name}</div>
                    {form.target_name === t.name && <div className="text-[10px] text-[#1b4332]">✓ Seleccionado</div>}
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <input ref={targetFileRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleTargetFile} />
              <button
                type="button"
                onClick={() => targetFileRef.current?.click()}
                disabled={uploadingTarget}
                className="px-3 py-2 rounded-xl border border-[#dcdad2] text-xs font-semibold hover:bg-[#f4f3ee] disabled:opacity-50"
              >
                {uploadingTarget ? 'Generando objetivo…' : 'Subir nuevo afiche'}
              </button>
              <span className="text-[11px] text-[#657069]">PNG o JPG de al menos 480 × 640 px.</span>
            </div>
          </Field>

          <Field label="Contenido AR (video o imagen sobre el afiche)">
            <div className="flex flex-wrap items-center gap-2">
              <input ref={mediaFileRef} type="file" accept="video/mp4,image/png,image/jpeg" className="hidden" onChange={handleMediaFile} />
              <button
                type="button"
                onClick={() => mediaFileRef.current?.click()}
                disabled={uploadingMedia}
                className="px-3 py-2 rounded-xl btn-primary text-xs font-bold disabled:opacity-50"
              >
                {uploadingMedia ? 'Subiendo…' : 'Subir video o imagen'}
              </button>
              <span className="text-[11px] text-[#657069]">MP4, PNG o JPG · máx. 15 MB.</span>
            </div>
            <input
              value={form.media_url}
              onChange={setMediaUrl}
              className={`${inputCls} mt-2`}
              placeholder="/media/promo_cafe_altura.png"
            />
            {form.media_url ? (
              (form.media_mime_type || inferMediaMime(form.media_url)).startsWith('video/') ? (
                <video
                  src={assetUrl(form.media_url)}
                  controls
                  muted
                  loop
                  playsInline
                  className="mt-2 w-full max-w-xs rounded-lg border border-[#e6e4dc] bg-black"
                />
              ) : (
                <img src={assetUrl(form.media_url)} alt="vista previa" className="mt-2 w-32 rounded-lg border border-[#e6e4dc]" />
              )
            ) : null}
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
