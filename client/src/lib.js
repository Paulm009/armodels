import { assetUrl } from './api.js'

export const ESTADO_LABELS = {
  PUBLICADA: 'Publicada',
  EN_PREPARACION: 'En preparación',
  ARCHIVADA: 'Archivada',
  VENCIDA: 'Vencida',
}

export function statusLabel(estado) {
  return ESTADO_LABELS[estado] || estado
}

export function statusClass(estado) {
  switch (estado) {
    case 'PUBLICADA':
      return 'bg-[#e6f4ea] text-[#1b4332]'
    case 'EN_PREPARACION':
      return 'bg-[#fff4e0] text-[#8a5a00]'
    case 'ARCHIVADA':
      return 'bg-[#eef0f2] text-[#657069]'
    case 'VENCIDA':
      return 'bg-[#fdeaea] text-[#9b1c1c]'
    default:
      return 'bg-[#eef0f2] text-[#657069]'
  }
}

export function mediaTypeLabel(content) {
  if (!content) return 'Sin contenido'
  if (content.tipo_contenido === 'VIDEO_MP4') return '1 video(s)'
  if (content.tipo_contenido === 'IMAGEN_3D') return 'Imagen 3D'
  return 'Imagen / Panel'
}

export function posterUrl(campaign) {
  const target = campaign.targets && campaign.targets[0]
  if (target && target.thumbnail_path) return assetUrl(target.thumbnail_path)
  if (target && target.original_path) return assetUrl(target.original_path)
  return ''
}
