import { useCallback, useEffect, useState } from 'react'
import Sidebar from './components/Sidebar.jsx'
import Overview from './views/Overview.jsx'
import Campaigns from './views/Campaigns.jsx'
import Stores from './views/Stores.jsx'
import Reports from './views/Reports.jsx'
import HowToTest from './views/HowToTest.jsx'
import CampaignModal from './components/CampaignModal.jsx'
import StoreModal from './components/StoreModal.jsx'
import WebARModal from './components/WebARModal.jsx'
import AccessChooser from './components/AccessChooser.jsx'
import PosterModal from './components/PosterModal.jsx'
import { api } from './api.js'

const VIEW_TITLES = {
  overview: 'Vista general',
  campaigns: 'Campañas',
  stores: 'Locales comerciales',
  reports: 'Reportes',
  howtotest: 'Cómo probar',
}

export default function App() {
  const [view, setView] = useState('overview')
  const [locales, setLocales] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [campaignModal, setCampaignModal] = useState({ open: false, editing: null })
  const [storeModal, setStoreModal] = useState({ open: false, editing: null })
  const [chooser, setChooser] = useState(null) // campaña para elegir Ver afiche / Probar cámara
  const [poster, setPoster] = useState(null) // campaña cuyo afiche se muestra
  const [webar, setWebar] = useState(null) // { campaign }
  const [toast, setToast] = useState(null)

  const showToast = useCallback((msg) => {
    setToast(msg)
    window.clearTimeout(window.__toastTimer)
    window.__toastTimer = window.setTimeout(() => setToast(null), 3200)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [localesData, campaignsData, reportsData] = await Promise.all([
        api.listLocales(),
        api.listCampaigns(),
        api.listReports(),
      ])
      setLocales(localesData)
      setCampaigns(campaignsData)
      setReports(reportsData)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const handleNavigate = (v) => setView(v)

  return (
    <div className="min-h-screen">
      <Sidebar view={view} onNavigate={handleNavigate} />

      <div className="lg:pl-64">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-2 text-sm text-[#657069] mb-4">
            <span>Panel</span>
            <span>/</span>
            <span className="font-semibold text-[#18241e]">{VIEW_TITLES[view]}</span>
          </div>

          {error && (
            <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-24 text-[#657069]">Cargando datos…</div>
          ) : (
            <>
              {view === 'overview' && (
                <Overview
                  campaigns={campaigns}
                  reports={reports}
                  locales={locales}
                  onNavigate={handleNavigate}
                  onNewCampaign={() => setCampaignModal({ open: true, editing: null })}
                  onTest={(c) => setChooser(c)}
                />
              )}
              {view === 'campaigns' && (
                <Campaigns
                  campaigns={campaigns}
                  locales={locales}
                  onNewCampaign={() => setCampaignModal({ open: true, editing: null })}
                  onEdit={(c) => setCampaignModal({ open: true, editing: c })}
                  onTest={(c) => setChooser(c)}
                />
              )}
              {view === 'stores' && (
                <Stores
                  locales={locales}
                  campaigns={campaigns}
                  onNew={() => setStoreModal({ open: true, editing: null })}
                  onEdit={(l) => setStoreModal({ open: true, editing: l })}
                />
              )}
              {view === 'reports' && <Reports reports={reports} onRefresh={refresh} />}
              {view === 'howtotest' && (
                <HowToTest onNavigate={handleNavigate} onTest={(c) => setChooser(c)} campaigns={campaigns} />
              )}
            </>
          )}
        </main>
      </div>

      {campaignModal.open && (
        <CampaignModal
          editing={campaignModal.editing}
          locales={locales}
          onClose={() => setCampaignModal({ open: false, editing: null })}
          onSaved={() => {
            setCampaignModal({ open: false, editing: null })
            refresh()
            showToast('Campaña guardada correctamente.')
          }}
          showToast={showToast}
        />
      )}

      {storeModal.open && (
        <StoreModal
          editing={storeModal.editing}
          onClose={() => setStoreModal({ open: false, editing: null })}
          onSaved={() => {
            setStoreModal({ open: false, editing: null })
            refresh()
            showToast('Local guardado correctamente.')
          }}
          showToast={showToast}
        />
      )}

      {chooser && (
        <AccessChooser
          campaign={chooser}
          onClose={() => setChooser(null)}
          onViewPoster={() => {
            setPoster(chooser)
            setChooser(null)
          }}
          onCamera={() => {
            setWebar({ campaign: chooser })
            setChooser(null)
          }}
        />
      )}

      {poster && (
        <PosterModal
          campaign={poster}
          onClose={() => setPoster(null)}
          onBack={() => {
            setChooser(poster)
            setPoster(null)
          }}
        />
      )}

      {webar && (
        <WebARModal
          campaign={webar.campaign}
          onClose={() => setWebar(null)}
          onEvent={refresh}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] px-5 py-3 rounded-xl bg-[#18241e] text-white text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  )
}
