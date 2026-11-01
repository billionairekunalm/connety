import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { networkInterfaces } from 'node:os'

// This computer's Wi-Fi address, so QR codes made on localhost point somewhere a phone can open.
// ponytail: picks the Wi-Fi adapter by name, else the first LAN address; override with VITE_PUBLIC_URL.
const nets = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
  (list ?? []).filter(n => n.family === 'IPv4' && !n.internal).map(n => ({ name, ip: n.address })))
const lan = (nets.find(n => /wi-?fi|wlan|wireless/i.test(n.name)) ?? nets[0])?.ip

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: { host: true },  // reachable from phones on the same Wi-Fi
  preview: { host: true },
  define: { __LAN_IP__: JSON.stringify(command === 'serve' ? lan ?? '' : '') },
}))
