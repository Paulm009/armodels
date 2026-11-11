const NAV_ITEMS = [
  { key: 'overview', label: 'Vista general', icon: '◧' },
  { key: 'campaigns', label: 'Campañas', icon: '◇' },
  { key: 'stores', label: 'Locales comerciales', icon: '⌂' },
  { key: 'reports', label: 'Reportes', icon: '≋' },
  { key: 'howtotest', label: 'Cómo probar', icon: '?' },
]

export default function Sidebar({ view, onNavigate }) {
  return (
    <aside className="fixed inset-y-0 left-0 w-64 bg-white border-r border-[#e6e4dc] hidden lg:flex flex-col z-40">
      <div className="px-5 py-6 border-b border-[#e6e4dc]">
        <div className="font-display font-extrabold text-lg text-[#1b4332] leading-tight">
          Aranjuez <span className="text-[#657069] font-semibold">WebAR</span>
        </div>
        <div className="text-xs text-[#657069] mt-1">Paseo Aranjuez · Cochabamba</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.key}
            onClick={() => onNavigate(item.key)}
            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left text-sm transition ${
              view === item.key
                ? 'bg-[#e9efe7] text-[#1b4332] font-semibold'
                : 'text-[#4a5750] hover:bg-[#f4f3ee]'
            }`}
          >
            <span className="w-5 text-center">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-5 py-4 border-t border-[#e6e4dc] text-xs text-[#657069]">
        Proyecto de grado · UCB
      </div>
    </aside>
  )
}
