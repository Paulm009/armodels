import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import LoginScreen from './components/LoginScreen.jsx'
import PublicExperience from './components/PublicExperience.jsx'
import { api } from './api.js'

const VIEW_TITLES = {
  overview: 'Vista general',
  campaigns: 'Campañas',
  stores: 'Locales comerciales',
  reports: 'Reportes',
  howtotest: 'Cómo probar',
}

function getPublicAccess() {
  if (typeof window === 'undefined') return null
  const pathMatch = window.location.pathname.match(/^\/ar\/([^/]+)/)
  if (pathMatch) {
    return { campaignId: decodeURIComponent(pathMatch[1]), accessMechanism: 'QR_CODE' }
  }
  const params = new URLSearchParams(window.location.search)
  const campaignId = params.get('campaign')
  if (campaignId) return { campaignId, accessMechanism: 'DIRECT_URL' }
  return null
}

export default function App() {
  const publicAccess = useMemo(() => getPublicAccess(), [])
  const [view, setView] = useState('overview')
  const [locales, setLocales] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [authState, setAuthState] = useState(publicAccess ? 'authed' : 'checking')
  const [user, setUser] = useState(null)

  const [campaignModal, setCampaignModal] = useState({ open: false, editing: null })
  const [storeModal, setStoreModal] = useState({ open: false, editing: null })
  const [chooser, setChooser] = useState(null)
  const [poster, setPoster] = useState(null)
  const [webar, setWebar] = useState(null)
  const [toast, setToast] = useState(null)
  const telemetryTimer = useRef(null)

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
    if (publicAccess) return
    let active = true
    api
      .me()
      .then((data) => {
        if (!active) return
        setUser(data.user)
        setAuthState('authed')
      })
      .catch(() => {
        if (active) setAuthState('anonymous')
      })

    const onUnauthorized = () => {
      setUser(null)
      setAuthState('anonymous')
    }
    window.addEventListener('webar:unauthorized', onUnauthorized)
    return () => {
      active = false
      window.removeEventListener('webar:unauthorized', onUnauthorized)
    }
  }, [publicAccess])

  useEffect(() => {
    if (authState === 'authed' && !publicAccess) refresh()
  }, [authState, publicAccess, refresh])

  useEffect(() => {
    return () => {
      window.clearTimeout(telemetryTimer.current)
    }
  }, [])

  const handleTelemetry = useCallback(() => {
    window.clearTimeout(telemetryTimer.current)
    telemetryTimer.current = window.setTimeout(() => refresh(), 1800)
  }, [refresh])

  const handleLogin = (loggedUser) => {
    setUser(loggedUser)
    setAuthState('authed')
  }

  const handleLogout = async () => {
    try {
      await api.logout()
    } finally {
      setUser(null)
      setAuthState('anonymous')
    }
  }

  const handleNavigate = (nextView) => setView(nextView)

  if (publicAccess) {
    return (
      <PublicExperience
        campaignId={publicAccess.campaignId}
        accessMechanism={publicAccess.accessMechanism}
      />
    )
  }

  if (authState === 'checking') {
    return <div className="min-h-screen flex items-center justify-center text-[#657069]">Verificando sesión…</div>
  }

  if (authState === 'anonymous') {
    return <LoginScreen onLogin={handleLogin} />
  }

  return (
    <div className="min-h-screen">
      <Sidebar view={view} onNavigate={handleNavigate} user={user} onLogout={handleLogout} />

      <div className="lg:pl-64">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-2 text-sm text-[#657069] mb-4">
            <span>Panel</span>
            <span>/</span>
            <span className="font-semibold text-[#18241e]">{VIEW_TITLES[view]}</span>
          </div>

          {error && (
            <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
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
                  onChanged={refresh}
                />
              )}
              {view === 'campaigns' && (
                <Campaigns
                  campaigns={campaigns}
                  locales={locales}
                  onNewCampaign={() => setCampaignModal({ open: true, editing: null })}
                  onEdit={(c) => setCampaignModal({ open: true, editing: c })}
                  onTest={(c) => setChooser(c)}
                  onChanged={refresh}
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
            setWebar({ campaign: chooser, accessMechanism: 'DIRECT_URL' })
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
          accessMechanism={webar.accessMechanism || 'DIRECT_URL'}
          onClose={() => {
            setWebar(null)
            refresh()
          }}
          onEvent={handleTelemetry}
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
