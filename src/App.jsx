import { Toaster } from '@/components/ui/toaster';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClientInstance } from '@/lib/query-client';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { useEffect, useState } from 'react';
import PageNotFound from './lib/PageNotFound';
import { getObserver } from '@/lib/observer';
import ScrollToTop from './components/ScrollToTop';
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

function App() {
  return (
    <QueryClientProvider client={queryClientInstance}>
      <Router>
        <ScrollToTop />
        <PublicApp />
      </Router>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
