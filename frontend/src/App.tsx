import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, useParams, useLocation, Link } from 'react-router-dom';
import { Menu, Users } from 'lucide-react';
const LandingPage = React.lazy(() => import('./pages/LandingPage').then(module => ({ default: module.LandingPage })));
const UserPage = React.lazy(() => import('./pages/UserPage').then(module => ({ default: module.UserPage })));
const AdminPage = React.lazy(() => import('./pages/AdminPage').then(module => ({ default: module.AdminPage })));
const HelpPage = React.lazy(() => import('./pages/HelpPage').then(module => ({ default: module.HelpPage })));
const ShortcutPage = React.lazy(() => import('./pages/ShortcutPage').then(module => ({ default: module.ShortcutPage })));
const NotFoundPage = React.lazy(() => import('./pages/NotFoundPage').then(module => ({ default: module.NotFoundPage })));
const SharePage = React.lazy(() => import('./pages/SharePage').then(module => ({ default: module.SharePage })));
const SettingsPage = React.lazy(() => import('./native/settings/SettingsPage').then(module => ({ default: module.SettingsPage })));
// Canvas backgrounds are split so only the active theme's one is downloaded
// (and plain mode downloads neither); the CSS body background shows until it loads.
const Starfield = React.lazy(() => import('./components/Starfield').then(module => ({ default: module.Starfield })));
const AuraField = React.lazy(() => import('./components/AuraField').then(module => ({ default: module.AuraField })));
// Native-only startup tasks (update checks, Capgo updater) are never needed on the web.
const NativeBootstrap = React.lazy(() => import('./native/NativeBootstrap').then(module => ({ default: module.NativeBootstrap })));
import { Sidebar } from './components/Sidebar';
import { PublicDirectory } from './components/PublicDirectory';
import { ThemeProvider } from './contexts/ThemeContext';
import { useTheme } from './hooks/useTheme';
import { EffectsProvider } from './contexts/EffectsContext';
import { useEffects } from './hooks/useEffects';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { apiRequest, wsUrl as buildWsUrl } from './services/api';
import { cn } from './lib/utils';
import { isMobileNative } from './native';
import { AppLinkNavigator } from './native/AppLinkNavigator';
import { MobileTopRow } from './components/user-page/MobileTopRow';

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

/**
 * Placeholder shown in the main pane while page data or a page chunk loads.
 *
 * @returns The loading indicator.
 */
const PageLoadingIndicator: React.FC = () => (
  <div className="flex-1 flex items-center justify-center">
    <div className="text-quantum-cyan animate-pulse tracking-[0.4em] font-bold text-xs uppercase">
      正在載入系統...
    </div>
  </div>
);

/** Props of {@link MainContent}. */
interface MainContentProps {
  users: Array<{ username: string; folder: string }>;
  config: { allowed_extensions?: string[] };
  loading: boolean;
  onOpenDirectory?: () => void;
  /** Toggle the left navigation drawer (phone user-page top row). */
  onToggleSidebar: () => void;
  /** Toggle the right directory drawer (phone user-page top row). */
  onToggleDirectory: () => void;
}

/**
 * Main content wrapper that handles data fetching based on route.
 *
 * @param props - Component props.
 * @returns The page for the current route.
 */
const MainContent: React.FC<MainContentProps> = ({ users, config, loading, onOpenDirectory, onToggleSidebar, onToggleDirectory }) => {
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

  // Phones: user-page routes have no app header bar; while such a route
  // loads or shows "not found", the floating menu/directory buttons stand in.
  const dashboardTopRow = username ? (
    <MobileTopRow onToggleSidebar={onToggleSidebar} onToggleDirectory={onToggleDirectory} className="absolute inset-x-0 top-0 z-20" />
  ) : null;

  if (loading || userLoading) {
    return (
      <>
        {dashboardTopRow}
        <PageLoadingIndicator />
      </>
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

  // Native app settings (Android/iOS only)
  if (location.pathname === '/settings') {
    return <SettingsPage />;
  }

  // User page - check if user exists
  if (username) {
    // If user not found, show 404
    if (userData?.error) {
      return (
        <>
          {dashboardTopRow}
          <NotFoundPage />
        </>
      );
    }
    return (
      <UserPage
        data={userData || { user: { username }, usage: 0, files: [], urls: [] }}
        onToggleSidebar={onToggleSidebar}
        onToggleDirectory={onToggleDirectory}
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
  // One state for both mobile drawers so the menu and the directory can never
  // be open at the same time: opening one closes the other.
  const [openDrawer, setOpenDrawer] = useState<'sidebar' | 'directory' | null>(null);
  const sidebarOpen = openDrawer === 'sidebar';
  const directoryOpen = openDrawer === 'directory';
  // Stable: they are passed to the memoized UserPage.
  const toggleSidebar = useCallback((): void => setOpenDrawer((current) => (current === 'sidebar' ? null : 'sidebar')), []);
  const toggleDirectory = useCallback((): void => setOpenDrawer((current) => (current === 'directory' ? null : 'directory')), []);
  const location = useLocation();

  // Determine if we constitute a "dashboard" view (UserPage) that needs independent scrolling panes
  const isDashboard = !['/', '/help', '/shortcut', '/settings'].includes(location.pathname);

  // Close mobile drawers on window resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        setOpenDrawer(null);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="h-dvh flex flex-col relative overflow-hidden bg-transparent">
      {/* Phones: user pages replace this bar with floating buttons (UserPage). */}
      {!isDashboard && <header className="glass-header-premium lg:hidden">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={toggleSidebar}
              className="lg:hidden p-2.5 -ml-0.5 hover:bg-white/10 rounded-lg transition-colors"
              aria-label="功能選單"
            >
              <Menu className="w-6 h-6" />
            </button>
            <Link to="/" className="flex items-center gap-2 group min-h-11">
              <span className="filenexus-brand">
                FileNexus
              </span>
            </Link>
          </div>
          <button
            onClick={toggleDirectory}
            className="min-w-11 min-h-11 flex items-center justify-center rounded-xl bg-white/60 dark:bg-white/5 text-gray-600 dark:text-neural-violet hover:bg-purple-500/10 transition-colors border border-white/20"
            aria-label="目錄"
          >
            <Users className="w-5 h-5" />
          </button>
        </div>
      </header>}

      <div className="flex-1 flex relative overflow-hidden">
        {/* Left Sidebar - Navigation */}
        <Sidebar 
          isOpen={sidebarOpen}
          onToggle={toggleSidebar}
        />

        {/* Center Content */}
        <main className={cn(
          "flex-1 min-w-0 flex flex-col transition-all duration-300 relative",
          location.pathname !== '/' && (isDashboard ? "p-0 lg:p-6 xl:p-8" : "p-4 lg:p-6 xl:p-8"),
          (isDashboard || location.pathname === '/') 
            ? "overflow-hidden" 
            : "custom-scrollbar overflow-y-auto"
        )}>
          {/* Lazy pages suspend only this boundary. With the outer boundary in
              AppContent the first visit to a page chunk hid the whole layout,
              including the drawers mid-exit-animation: their framer-motion
              backdrop never finished exiting and fogged the page. */}
          <React.Suspense fallback={<PageLoadingIndicator />}>
            <MainContent
              users={users}
              config={config}
              loading={loading}
              onOpenDirectory={() => setOpenDrawer('directory')}
              onToggleSidebar={toggleSidebar}
              onToggleDirectory={toggleDirectory}
            />
          </React.Suspense>
        </main>

        {/* Right Sidebar - Public Directory */}
        <PublicDirectory
          users={users}
          isOpen={directoryOpen}
          onToggle={toggleDirectory}
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
  const { level: effectsLevel } = useEffects();
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
      {isMobileNative() && (
        <>
          {/* Eager: App Links must be routed even before lazy chunks load. */}
          <AppLinkNavigator />
          <React.Suspense fallback={null}>
            <NativeBootstrap />
          </React.Suspense>
        </>
      )}
      <div className="min-h-screen relative text-gray-900 dark:text-white/90 selection:bg-quantum-cyan/30">
        {/* Background Layer - Dynamic based on theme */}
        {effectsLevel !== 'plain' && (
          <React.Suspense fallback={null}>
            {theme === 'dark' ? <Starfield animated={effectsLevel === 'full'} /> : <AuraField animated={effectsLevel === 'full'} />}
          </React.Suspense>
        )}

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

            {isMobileNative() && (
              <Route path="/settings" element={
                <MainLayout users={users} config={config} loading={loading} />
              } />
            )}

            <Route path="/share/:token" element={<SharePage />} />

            {/* Catch-all 404 route */}
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </React.Suspense>
      </div>
    </BrowserRouter>
  );
};

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <EffectsProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </EffectsProvider>
    </ThemeProvider>
  );
};

export default App;

