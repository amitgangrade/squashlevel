import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { StoreProvider } from './state/store'
import { LeaderboardPage } from './pages/Leaderboard'
import { RosterPage } from './pages/Roster'
import { LogMatchPage } from './pages/LogMatch'
import { HistoryPage } from './pages/History'
import { SettingsPage } from './pages/Settings'
import { ProfilePage } from './pages/Profile'
import { PlayerProfilePage } from './pages/PlayerProfile'
import { ActivityPage } from './pages/Activity'
import { AuditLogPage } from './pages/AuditLog'
import { ClubsPage } from './pages/Clubs'
import { ClubProfilePage } from './pages/ClubProfile'
import { GroupsPage } from './pages/Groups'
import { GroupProfilePage } from './pages/GroupProfile'

export default function App() {
  return (
    <StoreProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<LeaderboardPage />} />
            <Route path="/roster" element={<RosterPage />} />
            <Route path="/log" element={<LogMatchPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/players/:id" element={<PlayerProfilePage />} />
            <Route path="/clubs" element={<ClubsPage />} />
            <Route path="/clubs/:slug" element={<ClubProfilePage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/groups/:slug" element={<GroupProfilePage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            {/* Old routes kept as redirects so existing bookmarks / links keep working. */}
            <Route path="/challenges" element={<Navigate to="/activity" replace />} />
            <Route path="/matches/pending" element={<Navigate to="/activity" replace />} />
            <Route path="/admin" element={<SettingsPage />} />
            <Route path="/settings" element={<Navigate to="/admin" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </StoreProvider>
  )
}
