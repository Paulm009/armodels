import { assetUrl } from '../api.js'

export default function HowToTest({ campaigns, onTest }) {
  const demo = campaigns.find((c) => c.campaign_id === 'camp-cafe-altura') || campaigns[0]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display font-extrabold text-xl">Cómo probar la experiencia WebAR</h1>
        <p className="text-sm text-[#657069] mt-1">Pasos para verificar el seguimiento de imágenes con 8th Wall.</p>
      </div>

      <ol className="space-y-4">
        <Step n={1} title="Descarga o muestra el afiche objetivo">
          El afiche del local es la imagen que la cámara debe reconocer. Ábrelo en otra pantalla o imprímelo.
        </Step>
        <Step n={2} title="Abre la experiencia en modo cámara">
          Pulsa «Probar AR» en una campaña publicada. Otorga permisos de cámara cuando el navegador los solicite.
        </Step>
        <Step n={3} title="Enfoca el afiche">
          Apunta con la cámara al afiche. Al reconocerlo (xrimagefound), se superpone el contenido promocional.
        </Step>
        <Step n={4} title="Revisa los reportes">
          Cada sesión, reconocimiento, tiempo de seguimiento y clic en CTA queda registrado en Reportes.
        </Step>
      </ol>

      {demo && (
        <div className="card p-6 flex flex-col sm:flex-row items-center gap-5">
          <div className="w-24 h-32 rounded-lg overflow-hidden border border-[#e6e4dc] bg-[#f1f3ef] shrink-0">
            {demo.targets?.[0]?.original_path ? (
              <img src={assetUrl(demo.targets[0].original_path)} alt={demo.nombre} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-xs text-[#657069]">Afiche</div>
            )}
          </div>
          <div className="flex-1">
            <div className="font-display font-bold text-[#18241e]">{demo.nombre}</div>
            <p className="text-sm text-[#657069] mt-1">
              Usa esta campaña de demostración para validar el reconocimiento del afiche.
            </p>
          </div>
          <button onClick={() => onTest(demo)} className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap">
            Probar ahora
          </button>
        </div>
      )}

      <div className="text-xs text-[#657069] leading-relaxed">
        <p className="font-semibold text-[#18241e] mb-1">Nota técnica</p>
        <p>
          El motor 8th Wall se carga desde{' '}
          <code className="bg-[#eef0f2] px-1 rounded">@8thwall/engine</code> (open-source, Image Targets) salvo que
          definas <code className="bg-[#eef0f2] px-1 rounded">VITE_8THWALL_APP_KEY</code> en tu entorno. La experiencia
          requiere HTTPS (o localhost) para acceder a la cámara en dispositivos móviles.
        </p>
      </div>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <li className="flex gap-4">
      <div className="w-8 h-8 rounded-full bg-[#1b4332] text-white flex items-center justify-center font-bold text-sm shrink-0">
        {n}
      </div>
      <div>
        <div className="font-semibold text-[#18241e]">{title}</div>
        <p className="text-sm text-[#657069] mt-1">{children}</p>
      </div>
    </li>
  )
}
