import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { useState, useEffect } from 'react';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import { getObserver } from '@/lib/observer';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';
import ScrollToTop from './components/ScrollToTop';
// Add page imports here
import MissionControl from './pages/MissionControl';
import CubeDetail from './pages/CubeDetail';
import StarfieldBackground from './components/StarfieldBackground';
import IdentifyGate from './components/IdentifyGate';

const PublicApp = () => {
  const [observer, setObserverState] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setObserverState(getObserver());
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-border border-t-accent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!observer) {
    return (
      <>
        <StarfieldBackground />
        <IdentifyGate onIdentified={(obs) => setObserverState(obs)} />
      </>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<MissionControl observer={observer} onSignOut={() => setObserverState(null)} />} />
      <Route path="/cube/:cubeId" element={<CubeDetail observer={observer} onSignOut={() => setObserverState(null)} />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      {/* Add your page Route elements here */}
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <ScrollToTop />
          <PublicApp />
        </Router>
        <Toaster />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App