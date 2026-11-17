import { useState } from 'react'
import { api } from '../api.js'

export default function LoginScreen({ onLogin }) {
  const [usuario, setUsuario] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const showDemo = import.meta.env.VITE_SHOW_DEMO_CREDENTIALS !== 'false'

  const submit = async (event) => {
    event.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data = await api.login(usuario.trim(), password)
      onLogin(data.user)
    } catch (err) {
      setError(err.message || 'No se pudo iniciar sesión.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#f8f7f3]">
      <div className="card w-full max-w-md p-7 space-y-5">
        <div className="space-y-1 text-center">
          <div className="font-display font-extrabold text-2xl text-[#1b4332]">Aranjuez WebAR</div>
          <p className="text-sm text-[#657069]">Acceso al portal administrativo de Paseo Aranjuez</p>
        </div>

        <form onSubmit={submit} className="space-y-4" aria-label="Formulario de inicio de sesión">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#4a5750]">Usuario</span>
            <input
              value={usuario}
              onChange={(e) => setUsuario(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1b4332]/20"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-[#4a5750]">Contraseña</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#dcdad2] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#1b4332]/20"
            />
          </label>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm" role="alert">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full py-3 rounded-xl text-sm font-bold disabled:opacity-50">
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>

        {showDemo && (
          <div className="rounded-xl border border-[#e6e4dc] bg-[#f8f7f3] p-3 text-xs text-[#657069]">
            <p className="font-semibold text-[#18241e]">Credenciales de demostración</p>
            <p className="mt-1">marketing / marketing123 · gerencia / gerencia123</p>
            <p>community / community123 (solo lectura de campañas)</p>
          </div>
        )}

        <p className="text-center text-xs text-[#657069]">
          Si eres visitante, abre el enlace o escanea el QR de la campaña.
        </p>
      </div>
    </div>
  )
}
