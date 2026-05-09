import { HashRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { StoreProvider } from './state/store'
import { DashboardPage } from './pages/Dashboard'
import { RosterPage } from './pages/Roster'
import { LogMatchPage } from './pages/LogMatch'
import { HistoryPage } from './pages/History'
import { AnalyticsPage } from './pages/Analytics'
import { SettingsPage } from './pages/Settings'
import { ProfilePage } from './pages/Profile'
import { PlayerProfilePage } from './pages/PlayerProfile'
import { PendingMatchesPage } from './pages/PendingMatches'
import { ClubsPage } from './pages/Clubs'
import { ClubProfilePage } from './pages/ClubProfile'
import { GroupsPage } from './pages/Groups'
import { GroupProfilePage } from './pages/GroupProfile'
import { ChallengesPage } from './pages/Challenges'

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
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/players/:id" element={<PlayerProfilePage />} />
            <Route path="/clubs" element={<ClubsPage />} />
            <Route path="/clubs/:slug" element={<ClubProfilePage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/groups/:slug" element={<GroupProfilePage />} />
            <Route path="/challenges" element={<ChallengesPage />} />
            <Route path="/matches/pending" element={<PendingMatchesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </StoreProvider>
  )
}
