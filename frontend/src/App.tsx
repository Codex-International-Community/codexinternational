import { useEffect, useState } from 'react'
import './App.css'
import './Redesign.css'
import Home from './pages/Home'
import Landing from './pages/Landing'

type Route = 'landing' | 'home'

function readRoute(): Route {
  if (typeof window === 'undefined') return 'landing'
  const path = window.location.pathname.replace(/\/+$/, '') || '/'
  if (path === '/home') return 'home'
  return 'landing'
}

function navigate(path: string) {
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export default function App() {
  const [route, setRoute] = useState<Route>(readRoute)

  useEffect(() => {
    const onPop = () => setRoute(readRoute())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  if (route === 'home') return <Home />
  return <Landing onEnter={() => navigate('/home')} />
}