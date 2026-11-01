import { createRoot } from 'react-dom/client'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import './pwa'
import App from './App'

createRoot(document.getElementById('root')!).render(<App />)
