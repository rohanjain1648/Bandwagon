import { DEMO_HACKATHON_SLUG } from '@bw/shared';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/Shell';
import { Spinner } from './components/ui';
import { useMe } from './lib/queries';
import { ArenaPage } from './pages/Arena';
import { LoginPage, SignupPage } from './pages/Auth';
import { BoardPage } from './pages/Board';
import { JoinByCodePage } from './pages/JoinByCode';
import { MyTeamPage } from './pages/MyTeam';
import { ProfilePage } from './pages/Profile';
import { RequestsPage } from './pages/Requests';
import { SuggestionsPage } from './pages/Suggestions';
import { TeamViewPage } from './pages/TeamView';

function Home() {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (!me.data) return <Navigate to="/login" replace />;
  return <Navigate to={`/h/${me.data.hackathons[0]?.slug ?? DEMO_HACKATHON_SLUG}`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/join/:code" element={<JoinByCodePage />} />
      <Route path="/me" element={<ProfilePage />} />
      <Route path="/h/:slug" element={<AppShell />}>
        <Route index element={<BoardPage />} />
        <Route path="team" element={<MyTeamPage />} />
        <Route path="teams/:teamId" element={<TeamViewPage />} />
        <Route path="requests" element={<RequestsPage />} />
        <Route path="for-you" element={<SuggestionsPage />} />
        <Route path="arena" element={<ArenaPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
