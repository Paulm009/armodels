/**
 * Utilidad pura para construir metadatos de Image Target compatibles con el
 * motor open-source de 8th Wall (formato producido por @8thwall/image-target-cli).
 * El generador real que produce luminancia/miniatura/recorte está en
 * `scripts/generate-image-targets.mjs`.
 */
function build8thWallTargetMetadata({ targetId, targetName, imagePath, thumbnailPath, originalPath, properties = {} }) {
  const name = targetName || targetId || 'target'
  return {
    imagePath: imagePath || `image-targets/${name}_luminance.png`,
    thumbnailPath: thumbnailPath || `image-targets/${name}_thumbnail.png`,
    croppedPath: `image-targets/${name}_cropped.png`,
    name,
    type: 'PLANAR',
    properties: {
      left: 0,
      top: 0,
      width: 480,
      height: 640,
      isRotated: false,
      originalWidth: 480,
      originalHeight: 640,
      ...properties,
    },
    resources: {
      originalImage: originalPath || `${name}_original.png`,
      croppedImage: `${name}_cropped.png`,
      thumbnailImage: `${name}_thumbnail.png`,
      luminanceImage: `${name}_luminance.png`,
    },
    created: Date.now(),
    updated: Date.now(),
  }
}

module.exports = { build8thWallTargetMetadata }
