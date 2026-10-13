import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { m, AnimatePresence } from 'framer-motion';
import { Users, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';


interface PublicDirectoryProps {
  users: Array<{ username: string; folder: string }>;
  isOpen: boolean;
  onToggle: () => void;
}

export const PublicDirectory: React.FC<PublicDirectoryProps> = ({ 
  users, 
  isOpen, 
  onToggle
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(false);

  // Track viewport size for responsive behavior
  useEffect(() => {
    const checkDesktop = () => setIsDesktop(window.innerWidth >= 1024);
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  // Extract current username from path (e.g., /starpig -> starpig)
  const currentUsername = location.pathname === '/' || location.pathname === '/admin' 
    ? null 
    : location.pathname.slice(1);

  const handleUserClick = (username: string) => {
    navigate(`/${username}`);
    // Close drawer on mobile after navigation
    if (!isDesktop) {
      onToggle();
    }
  };

  return (
    <>

      {/* Mobile Overlay */}
      <AnimatePresence>
        {isOpen && !isDesktop && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onToggle}
            className="fixed inset-0 bg-black/50 dark:bg-space-black/80 backdrop-blur-sm z-40"
          />
        )}
      </AnimatePresence>

      {/* Directory Container */}
      <aside
        className={cn(
          "fixed right-0 top-0 h-full w-72 z-45 bg-white/95 dark:bg-space-deep/95 backdrop-blur-xl border-l border-gray-200 dark:border-white/5",
          "lg:relative lg:w-56 xl:w-64 lg:bg-transparent lg:border-0 lg:block lg:backdrop-blur-none",
          "flex flex-col py-6 px-4 lg:py-4 lg:px-2",
          "transition-transform duration-300 ease-in-out",
          // Mobile: slide in/out based on isOpen
          !isDesktop && (isOpen ? "translate-x-0" : "translate-x-full"),
          // Desktop: always visible
          isDesktop && "translate-x-0"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-gray-200 dark:border-white/5">
          <h3 className="text-sm font-black text-gray-700 dark:text-white/40 uppercase tracking-[0.3em]">公開目錄</h3>
          <div className="px-2 py-0.5 bg-cyan-50 dark:bg-quantum-cyan/10 rounded-full border border-cyan-200 dark:border-quantum-cyan/20 text-xs font-black text-cyan-700 dark:text-quantum-cyan tracking-widest shrink-0">
            {users.length} ACTIVE
          </div>
        </div>

        {/* User List */}
        <div className="flex-1 space-y-2 overflow-y-auto custom-scrollbar pr-1">
          <AnimatePresence>
            {users.length > 0 ? (
              users.map((user, idx) => {
                const isSelected = currentUsername === user.username;
                return (
                  <m.button
                    key={user.username}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    onClick={() => handleUserClick(user.username)}
                    className={cn(
                      "w-full glass-card p-4 flex items-center justify-between transition-all group/item cursor-pointer text-left",
                      "border-gray-200 dark:border-white/5 hover:border-cyan-300 dark:hover:border-quantum-cyan/20 bg-white dark:bg-space-deep/40 backdrop-blur-md shadow-sm dark:shadow-none",
                      isSelected && "border-cyan-500 dark:border-quantum-cyan/50 bg-cyan-50 dark:bg-quantum-cyan/10 shadow-[0_0_20px_rgba(34,211,238,0.1)]"
                    )}
                  >
                    <div className="flex items-center gap-3 overflow-hidden">
                      <Users className={cn(
                        "w-4 h-4 shrink-0 transition-colors",
                        isSelected ? "text-cyan-600 dark:text-quantum-cyan" : "text-gray-400 dark:text-quantum-cyan/30 group-hover/item:text-cyan-600 dark:group-hover/item:text-quantum-cyan"
                      )} />
                      <div className="flex flex-col overflow-hidden">
                        <span className={cn(
                          "text-base font-bold tracking-tight truncate transition-colors",
                          isSelected ? "text-cyan-700 dark:text-quantum-cyan" : "text-gray-700 dark:text-white/60 group-hover/item:text-gray-900 dark:group-hover/item:text-white"
                        )}>
                          {user.username}
                        </span>
                        <span className="text-xs text-gray-400 dark:text-white/20 uppercase tracking-widest">
                          Index {idx.toString().padStart(3, '0')}
                        </span>
                      </div>
                    </div>
                    <Sparkles className={cn(
                      "w-4 h-4 shrink-0 transition-all",
                      isSelected ? "text-cyan-400 dark:text-quantum-cyan/50" : "text-gray-300 dark:text-white/5 group-hover/item:text-cyan-300 dark:group-hover/item:text-quantum-cyan/30"
                    )} />
                  </m.button>
                );
              })
            ) : (
              <div className="text-center py-6 border border-dashed border-gray-300 dark:border-white/5 rounded-2xl opacity-50">
                <p className="text-[0.625rem] font-black uppercase tracking-[0.2em] text-gray-500 dark:text-white/50">無活躍節點</p>
              </div>
            )}
          </AnimatePresence>
        </div>
      </aside>
    </>
  );
};

