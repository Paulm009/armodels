import { api, assetUrl } from '../api.js'

export default function HowToTest({ campaigns, onTest }) {
  const demo = campaigns.find((c) => c.campaign_id === 'camp-cafe-altura') || campaigns[0]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display font-extrabold text-xl">Cómo probar la experiencia WebAR</h1>
        <p className="text-sm text-[#657069] mt-1">
          Pasos para verificar el seguimiento de imágenes con 8th Wall en un teléfono real.
        </p>
      </div>

      <div className="rounded-xl border border-[#f0d9a8] bg-[#fff8e8] p-4 text-sm text-[#8a5a00]">
        <p className="font-semibold">Antes de empezar</p>
        <ul className="mt-1 space-y-1 list-disc list-inside">
          <li>Usa HTTPS o un túnel. La cámara no funciona por HTTP en red local.</li>
          <li>iPhone: Safari con iOS 16.4 o superior. Android: Chrome actualizado.</li>
          <li>Evita abrir el enlace dentro de Instagram, WhatsApp o Facebook; usa Safari/Chrome.</li>
          <li>Imprime el afiche o muéstralo en otra pantalla con buena iluminación y sin reflejos.</li>
        </ul>
      </div>

      <ol className="space-y-4">
        <Step n={1} title="Abre la experiencia pública">
          Desde el panel pulsa «Probar AR», o abre el enlace <code>/ar/&lt;campaignId&gt;</code> / escanea el QR del
          afiche. La pantalla de inicio muestra la compatibilidad detectada.
        </Step>
        <Step n={2} title="Autoriza la cámara">
          Pulsa «Iniciar experiencia AR» y concede el permiso. Si lo rechazaste, actívalo en los ajustes del navegador.
        </Step>
        <Step n={3} title="Enfoca el afiche">
          Apunta con la cámara trasera al afiche. Al reconocerlo se emite <code>reality.imagefound</code> y se muestra el
          contenido asociado al target.
        </Step>
        <Step n={4} title="Consulta y CTA">
          Abre «Info» para leer las condiciones y usa el botón de llamada a la acción. El clic queda registrado en la
          sesión.
        </Step>
        <Step n={5} title="Revisa los reportes">
          En «Reportes» consulta los 7 indicadores, su denominador y los valores «No calculable (N/C)» cuando no hay
          sesiones elegibles.
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
              Usa esta campaña de demostración para validar el reconocimiento del afiche y el contenido asociado.
            </p>
            <a
              href={api.qrUrl(demo.campaign_id, 512)}
              download={`qr_${demo.campaign_id}.png`}
              className="text-xs font-semibold text-[#1b4332] underline"
            >
              Descargar QR de esta campaña
            </a>
          </div>
          <button onClick={() => onTest(demo)} className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap">
            Probar ahora
          </button>
        </div>
      )}

      <div className="text-xs text-[#657069] leading-relaxed">
        <p className="font-semibold text-[#18241e] mb-1">Nota técnica</p>
        <p>
          El motor open-source se carga desde <code>@8thwall/engine@0.1.0</code>. La app valida HTTPS, WebGL,
          WebAssembly SIMD y la versión de iOS antes de iniciar. Si el dispositivo no es compatible, muestra la
          promoción en modo texto en lugar de una pantalla negra.
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
