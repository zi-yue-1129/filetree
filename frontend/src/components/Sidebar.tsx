import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { m } from 'framer-motion';
import { FileUp, ShieldCheck, HelpCircle, Sun, Moon, Smartphone, Settings } from 'lucide-react';
import { cn } from '../lib/utils';
import { isMobileNative } from '../native';
import { useTheme } from '../hooks/useTheme';
import { EffectsToggle } from './EffectsToggle';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  path: string;
}

const navItems: NavItem[] = [
  { id: 'upload', label: '資料上傳中心', icon: FileUp, path: '/' },
  { id: 'help', label: '使用說明', icon: HelpCircle, path: '/help' },
  { id: 'shortcut', label: 'iPhone 捷徑', icon: Smartphone, path: '/shortcut' },
  // Native-only: device login, backup, upload queue and updates.
  ...(isMobileNative() ? [{ id: 'settings', label: 'App 設定', icon: Settings, path: '/settings' }] : []),
];

export const Sidebar: React.FC<SidebarProps> = ({ isOpen, onToggle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();
  const [isDesktop, setIsDesktop] = useState(false);
  const [isLocalhost] = useState(() => {
    // The Capacitor WebView is served from https://localhost; that is not a LAN admin context.
    if (isMobileNative()) return false;
    const hostname = window.location.hostname;
    return hostname === 'localhost' || 
           hostname === '127.0.0.1' || 
           hostname.startsWith('192.168.') ||
           hostname.startsWith('10.') ||
           hostname.endsWith('.local');
  });

  // Track viewport size for responsive behavior
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 1024);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(path);
  };

  const handleNavClick = (path: string) => {
    navigate(path);
    // Close drawer on mobile after navigation
    if (!isDesktop) {
      onToggle();
    }
  };

  return (
    <>

      {/* Mobile Overlay */}
      {isOpen && !isDesktop && (
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onToggle}
          className="fixed inset-0 bg-black/50 dark:bg-space-black/80 backdrop-blur-sm z-40"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={cn(
          "fixed left-0 top-0 h-full w-64 z-45 bg-white/95 dark:bg-space-deep/95 backdrop-blur-xl border-r border-gray-200 dark:border-white/5",
          "lg:relative lg:w-48 xl:w-56 lg:bg-transparent lg:border-0 lg:block lg:backdrop-blur-none",
          "flex flex-col py-6 px-4 lg:py-4 lg:px-2 h-full",
          "transition-transform duration-300 ease-in-out",
          // Mobile: slide in/out based on isOpen
          !isDesktop && (isOpen ? "translate-x-0" : "-translate-x-full"),
          // Desktop: always visible
          isDesktop && "translate-x-0"
        )}
      >
        {/* Logo / Header */}
        <div className="px-3 mb-8 lg:mb-6 cursor-pointer" onClick={() => handleNavClick('/')}>
          <span className="filenexus-brand text-sm! tracking-tight hidden sm:block">FileNexus</span>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 space-y-2">
          <div className="px-3 mb-3">
            <span className="text-[0.5625rem] font-black text-gray-400 dark:text-white/30 uppercase tracking-[0.3em]">功能選單</span>
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.path)}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 cursor-pointer group",
                  "text-left text-sm font-medium tracking-tight",
                  active
                    ? "bg-quantum-cyan/10 text-quantum-cyan border border-quantum-cyan/30 shadow-[0_0_15px_rgba(34,211,238,0.1)]"
                    : "text-gray-600 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/5 border border-transparent"
                )}
              >
                <Icon className={cn(
                  "w-4 h-4 shrink-0 transition-colors",
                  active ? "text-quantum-cyan" : "text-gray-400 dark:text-white/20 group-hover:text-gray-600 dark:group-hover:text-white/40"
                )} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Theme Toggle */}
        <div className="pt-4 border-t border-gray-200 dark:border-white/5">
          <button
            onClick={toggleTheme}
            className={cn(
              // min-h-11: 44px touch target on phones (text-xs rows are 42px).
              "w-full flex items-center gap-3 px-4 py-3 min-h-11 lg:min-h-0 rounded-xl transition-all cursor-pointer group",
              "text-left text-xs font-medium tracking-wide",
              "text-gray-600 dark:text-white/40 hover:text-gray-900 dark:hover:text-white/70 hover:bg-gray-100 dark:hover:bg-white/5 border border-transparent"
            )}
            aria-label={theme === 'dark' ? '切換至淺色模式' : '切換至深色模式'}
          >
            {theme === 'dark' ? (
              <Sun className="w-4 h-4 shrink-0 text-yellow-500" />
            ) : (
              <Moon className="w-4 h-4 shrink-0 text-indigo-500" />
            )}
            <span>{theme === 'dark' ? '淺色模式' : '深色模式'}</span>
          </button>
          <EffectsToggle />
        </div>

        {/* Admin Link - Only show on localhost/internal network */}
        {isLocalhost && (
          <div className="pt-4 border-t border-gray-200 dark:border-white/5">
            <button
              onClick={() => handleNavClick('/admin')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 min-h-11 lg:min-h-0 rounded-xl transition-all cursor-pointer group",
                "text-left text-xs font-medium tracking-wide",
                location.pathname === '/admin'
                  ? "bg-neural-violet/10 text-neural-violet border border-neural-violet/30"
                  : "text-gray-500 dark:text-white/20 hover:text-neural-violet/80 dark:hover:text-neural-violet/60 hover:bg-neural-violet/5 border border-transparent"
              )}
            >
              <ShieldCheck className="w-4 h-4 shrink-0" />
              <span>管理員</span>
            </button>
          </div>
        )}
      </aside>
    </>
  );
};
