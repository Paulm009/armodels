export default function Stores({ locales, campaigns, onNew, onEdit }) {
  const countFor = (id) => campaigns.filter((c) => c.local_id === id).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display font-extrabold text-xl">Locales comerciales</h1>
          <p className="text-sm text-[#657069]">{locales.length} locales en Paseo Aranjuez</p>
        </div>
        <button onClick={onNew} className="btn-primary px-4 py-2.5 rounded-xl text-sm font-bold">
          + Nuevo local
        </button>
      </div>

      {locales.length === 0 ? (
        <div className="card p-10 text-center text-[#657069]">No hay locales registrados.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {locales.map((l) => (
            <div key={l.id} className="card p-5 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <h3 className="font-display font-bold text-[#18241e]">{l.nombre}</h3>
                <button
                  onClick={() => onEdit(l)}
                  className="px-3 py-1.5 rounded-lg bg-white border border-[#dcdad2] text-xs font-semibold hover:bg-[#f4f3ee]"
                >
                  Editar
                </button>
              </div>
              <span className="pill px-2.5 py-1 rounded-full text-xs font-semibold self-start">{l.rubro}</span>
              <p className="text-sm text-[#4a5750]">{l.ubicacion}</p>
              <p className="text-xs text-[#657069] line-clamp-2">{l.descripcion}</p>
              <div className="text-xs text-[#657069] pt-2 border-t border-[#f0efe9]">
                {countFor(l.id)} campaña(s) asociadas
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
