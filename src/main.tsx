import { Component, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import './pwa'
import App from './App'
import { MISCONFIGURED } from './supabase'

// One crash shouldn't leave a blank screen.
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.error(e) }
  render() {
    return this.state.failed ? (
      <div className="app"><div className="empty-card">
        <b>Something went wrong.</b><br />
        <button className="btn-black press" style={{ marginTop: 16 }} onClick={() => location.reload()}>Reload</button>
      </div></div>
    ) : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  MISCONFIGURED
    ? <div className="app"><div className="empty-card">
        <b>App not configured</b><br />Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then redeploy.
      </div></div>
    : <Guard><App /></Guard>,
)
