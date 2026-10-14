import React from 'react';
import { Lock, Unlock, Activity, Settings } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { UserDashboardData } from '../../types/dashboard';

interface UserPageHeaderProps {
  user: UserDashboardData['user'];
  usage?: number;
  isAuthenticated: boolean;
  onLogout: () => void;
  onShowAuth: () => void;
  onShowSettings: () => void;
}

export const UserPageHeader: React.FC<UserPageHeaderProps> = ({
  user,
  usage,
  isAuthenticated,
  onLogout,
  onShowAuth,
  onShowSettings
}) => {
  return (
    <header className="flex flex-col gap-1 sm:gap-3 px-2 pt-2 pb-1 sm:px-4 sm:pt-4 lg:pt-0 lg:pb-0 lg:px-4 relative z-10 lg:pl-4 bg-white/40 dark:bg-black/20 backdrop-blur-xl border-b border-white/10 lg:bg-transparent lg:backdrop-blur-none lg:border-none">
      
      {/* Row 1: Profile & Actions */}
      <div className="flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="flex items-center gap-1.5 sm:gap-3 group cursor-default">
            <div className="p-1 bg-white/80 dark:bg-white/5 backdrop-blur-xl rounded-lg border border-white/20 shadow-sm">
              <div className="text-cyan-600 dark:text-quantum-cyan font-black text-xs">FN</div>
            </div>
            <h1 className="text-base sm:text-xl font-black tracking-tighter text-gray-900 dark:text-white truncate max-w-30 sm:max-w-none">
              {user?.username}
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {/* Usage Pill - Compact on mobile */}
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white/60 dark:bg-black/40 backdrop-blur-md rounded-lg border border-gray-200 dark:border-white/10 shadow-sm">
            <Activity className="w-3 h-3 text-cyan-500" />
            <span className="text-[10px] font-black text-gray-600 dark:text-gray-300 tracking-tighter">
              {usage}MB
            </span>
          </div>

          {/* Auth/Lock Button */}
          <button
            onClick={() => isAuthenticated ? onLogout() : onShowAuth()}
            className={cn(
              "p-1.5 sm:p-2 sm:px-4 sm:py-2 rounded-xl flex items-center gap-2 transition-all duration-300 font-bold text-xs shadow-lg backdrop-blur-md border min-w-11 min-h-11 lg:min-w-10 lg:min-h-10",
              isAuthenticated
                ? "bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-700 dark:text-cyan-400 border-cyan-500/20"
                : "bg-white/80 dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-white/10"
            )}
          >
            {isAuthenticated ? <Unlock className="w-4 h-4 text-cyan-500" /> : <Lock className="w-4 h-4" />}
            <span className="hidden sm:inline">{isAuthenticated ? "UNLOCKED" : "LOCKED"}</span>
          </button>

          {/* Settings */}
          <button
            onClick={onShowSettings}
            className="p-1.5 sm:p-2 rounded-xl bg-white/60 dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-600 dark:text-gray-300 transition-colors border border-white/20 min-w-11 min-h-11 lg:min-w-10 lg:min-h-10 flex items-center justify-center"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};
