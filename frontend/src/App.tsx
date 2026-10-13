import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useParams, useLocation, Link } from 'react-router-dom';
import { Menu, Users } from 'lucide-react';
const LandingPage = React.lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));
const UserPage = React.lazy(() => import('./pages/UserPage').then(module => ({ default: module.UserPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(module => ({ default: module.AdminPage })));
const HelpPage = React.lazy(() => import('./pages/HelpPage').then(module => ({ default: module.HelpPage })));
const ShortcutPage = React.lazy(() => import('./pages/ShortcutPage').then(module => ({ default: module.ShortcutPage })));
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage').then(module => ({ default: module.NotFoundPage })));
const SharePage = React.lazy(() => import('./pages/SharePage').then(module => ({ default: module.SharePage })));
import { Starfield } from './components/Starfield';
import { AuraField } from './components/AuraField';
import { Sidebar } from './components/Sidebar';
import { PublicDirectory } from './components/PublicDirectory';
import { ThemeProvider, useTheme } from './contexts/ThemeContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { apiRequest, wsUrl as buildWsUrl } from './services/api';
import { cn } from './lib/utils';

interface UserData {
  users?: Array<{ username: string; folder: string }>;
  user?: { username: string; show_in_list?: boolean };
  usage?: number;
  files?: Array<{
    name: string;
    size: number;
    size_bytes: number;
    created: string;
    remaining_days: number;
    remaining_hours: number;
    expired: boolean;
    is_locked?: boolean;
  }>;
  urls?: Array<{ url: string; created: string; is_locked?: boolean }>;
  error?: string;
}

// Main content wrapper that handles data fetching based on route
const MainContent: React.FC<{
  users: Array<{ username: string; folder: string }>;
  config: { allowed_extensions?: string[] };
  loading: boolean;
  onOpenDirectory?: () => void;
}> = ({ users, config, loading, onOpenDirectory }) => {
  const { username } = useParams<{ username: string }>();
  const location = useLocation();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [userLoading, setUserLoading] = useState(false);

  const { token } = useAuth();

  // Fetch user data when username changes
  useEffect(() => {
    if (!username) return;
    
    let isMounted = true;
    const fetchData = async () => {
      setUserLoading(true);
      try {
        const data = await apiRequest(`/user/${username}`, { token });
        if (isMounted) setUserData(data);
      } catch (err) {
        console.error('Fetch user data failed:', err);
        if (isMounted) setUserData({ error: '目錄不存在' });
      } finally {
        if (isMounted) setUserLoading(false);
      }
    };

    fetchData();
      
    return () => {
      isMounted = false;
    };
  }, [username, token]);

  if (loading || userLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-quantum-cyan animate-pulse tracking-[0.4em] font-bold text-xs uppercase">
          正在載入系統...
        </div>
      </div>
    );
  }

  // Home page - show upload center
  if (location.pathname === '/') {
    return <LandingPage data={{ users, config }} />;
  }

  // Help page
  if (location.pathname === '/help') {
    return <HelpPage onOpenDirectory={onOpenDirectory} />;
  }

  // iPhone Shortcut setup page
  if (location.pathname === '/shortcut') {
    return <ShortcutPage />;
  }

  // User page - check if user exists
  if (username) {
    // If user not found, show 404
    if (userData?.error) {
      return <NotFoundPage />;
    }
    return (
      <UserPage
        data={userData || { user: { username }, usage: 0, files: [], urls: [] }}
      />
    );
  }

  return null;
};

// Admin route wrapper
const AdminRoute: React.FC = () => {
  return <AdminPage />;
};

// Layout wrapper for main SPA layout (excludes admin)
const MainLayout: React.FC<{
  users: Array<{ username: string; folder: string }>;
  config: { allowed_extensions?: string[] };
  loading: boolean;
}> = ({ users, config, loading }) => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const location = useLocation();

  // Determine if we constitute a "dashboard" view (UserPage) that needs independent scrolling panes
  const isDashboard = !['/', '/help', '/shortcut'].includes(location.pathname);

  // Close mobile drawers on window resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setSidebarOpen(false);
        setDirectoryOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="h-dvh flex flex-col relative overflow-hidden bg-transparent">
      <header className="glass-header-premium lg:hidden">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 hover:bg-white/10 rounded-lg transition-colors"
            >
              <Menu className="w-6 h-6" />
            </button>
            <Link to="/" className="flex items-center gap-2 group">
              <span className="filenexus-brand">
                FileNexus
              </span>
            </Link>
          </div>
          <button
            onClick={() => setDirectoryOpen(!directoryOpen)}
            className="p-2 rounded-xl bg-white/60 dark:bg-white/5 text-gray-600 dark:text-neural-violet hover:bg-purple-500/10 transition-colors border border-white/20"
            aria-label="目錄"
          >
            <Users className="w-5 h-5" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex relative overflow-hidden">
        {/* Left Sidebar - Navigation */}
        <Sidebar 
          isOpen={sidebarOpen} 
          onToggle={() => setSidebarOpen(!sidebarOpen)} 
        />

        {/* Center Content */}
        <main className={cn(
          "flex-1 min-w-0 flex flex-col transition-all duration-300 relative",
          location.pathname !== '/' && "p-4 lg:p-6 xl:p-8",
          (isDashboard || location.pathname === '/') 
            ? "overflow-hidden" 
            : "custom-scrollbar overflow-y-auto"
        )}>
          <MainContent 
            users={users} 
            config={config} 
            loading={loading} 
            onOpenDirectory={() => setDirectoryOpen(true)}
          />
        </main>

        {/* Right Sidebar - Public Directory */}
        <PublicDirectory
          users={users}
          isOpen={directoryOpen}
          onToggle={() => setDirectoryOpen(!directoryOpen)}
        />
      </div>
    </div>
  );
};

/**
 * Inner app component that uses theme context.
 */
const AppContent: React.FC = () => {
  const { theme } = useTheme();
  const [users, setUsers] = useState<Array<{ username: string; folder: string }>>([]);
  const [config, setConfig] = useState<{ allowed_extensions?: string[] }>({});
  const [loading, setLoading] = useState(true);


  // Fetch initial user list and config
  useEffect(() => {
    const fetchInit = () => {
      apiRequest('/init')
        .then((data) => {
          // data.users is array, data.config is object
          setUsers(data.users || []);
          setConfig(data.config || {});
        })
        .catch((err) => console.error('Fetch error:', err))
        .finally(() => setLoading(false));
    };

    fetchInit();

    // WebSocket for realtime user list updates
    // Direct endpoint on app.py to bypass router issues
    const wsUrl = buildWsUrl('/ws/global');
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('Connected to global WS');
    };

    socket.onmessage = (event) => {
      if (event.data === 'USER_LIST_UPDATE') {
        fetchInit();
      }
    };

    socket.onclose = () => {
      console.log('Global WS closed');
    };

    return () => {
      if (socket) socket.close();
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="min-h-screen relative text-gray-900 dark:text-white/90 selection:bg-quantum-cyan/30">
        {/* Background Layer - Dynamic based on theme */}
        {theme === 'dark' ? <Starfield /> : <AuraField />}

        <React.Suspense fallback={
           <div className="flex items-center justify-center min-h-screen">
             <div className="text-quantum-cyan animate-pulse tracking-[0.4em] font-bold text-xs uppercase">
               LOADING...
             </div>
           </div>
        }>
          <Routes>
            {/* Admin page has its own layout */}
            <Route path="/admin" element={
              <main className="container mx-auto px-4 py-8 relative z-10">
                <AdminRoute />
              </main>
            } />

            {/* All other routes use the main SPA layout */}
            <Route path="/:username" element={
              <MainLayout users={users} config={config} loading={loading} />
            } />
            <Route path="/" element={
              <MainLayout users={users} config={config} loading={loading} />
            } />
            
            <Route path="/help" element={
              <MainLayout users={users} config={config} loading={loading} />
            } />

            <Route path="/shortcut" element={
              <MainLayout users={users} config={config} loading={loading} />
            } />

            <Route path="/share/:token" element={<SharePage />} />

            {/* Catch-all 404 route */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </React.Suspense>

        <footer className="text-center py-0 lg:py-2 flex items-center justify-center gap-2 fixed bottom-2 w-full z-10">
          <span className="filenexus-brand text-[0.625rem]! tracking-[0.3em] uppercase">FileNexus</span>
          <span className="text-gray-400 dark:text-white/20 text-[0.625rem] font-bold tracking-[0.3em] uppercase">- Secure File Bridge Hub</span>
        </footer>
      </div>
    </BrowserRouter>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;

