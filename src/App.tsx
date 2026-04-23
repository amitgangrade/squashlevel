import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { StoreProvider } from './state/store'
import { DashboardPage } from './pages/Dashboard'
import { RosterPage } from './pages/Roster'
import { LogMatchPage } from './pages/LogMatch'
import { HistoryPage } from './pages/History'
import { AnalyticsPage } from './pages/Analytics'
import { SettingsPage } from './pages/Settings'

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="/roster" element={<RosterPage />} />
            <Route path="/log" element={<LogMatchPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </StoreProvider>
  )
}
