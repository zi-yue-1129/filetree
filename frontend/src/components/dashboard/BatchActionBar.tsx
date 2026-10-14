import React from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Lock, Unlock, Download, Trash2 } from 'lucide-react';
import { CascadingMenu } from '../ui/CascadingMenu';
import { cn } from '../../lib/utils';
import type { Folder } from '../dashboard/FolderSidebar';

interface BatchActionBarProps {
  selectedCount: number;
  isBatchSyncing: boolean;
  onAction: (action: 'lock' | 'unlock' | 'download' | 'delete' | 'move', folderId?: string | null) => void;
  folders: Folder[];
  allowedActions?: ('lock' | 'unlock' | 'download' | 'delete' | 'move')[];
  mode?: 'mobile' | 'desktop' | 'both';
}

export const BatchActionBar: React.FC<BatchActionBarProps> = ({
  selectedCount,
  isBatchSyncing,
  onAction,
  folders,
  allowedActions = ['lock', 'unlock', 'download', 'delete', 'move'],
  mode = 'both'
}) => {
  const showAction = (action: 'lock' | 'unlock' | 'download' | 'delete' | 'move') => allowedActions.includes(action);

  if (selectedCount === 0) return null;

  return (
    <>
      {(mode === 'both' || mode === 'desktop') && (
        /* Desktop View (md+) - Inline */
        <div className="hidden md:flex items-center bg-white dark:bg-white/10 rounded-lg border border-gray-200 dark:border-white/10 p-1 shadow-sm">
        {showAction('lock') && (
          <ActionButton
            icon={<Lock className="w-4 h-4" />}
            onClick={() => onAction('lock')}
            disabled={isBatchSyncing}
            color="violet"
          />
        )}
        {showAction('unlock') && (
          <ActionButton
            icon={<Unlock className="w-4 h-4" />}
            onClick={() => onAction('unlock')}
            disabled={isBatchSyncing}
            color="cyan"
          />
        )}
        {(showAction('lock') || showAction('unlock')) && <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-1" />}
        
        {showAction('download') && (
          <ActionButton
            icon={<Download className="w-4 h-4" />}
            onClick={() => onAction('download')}
            disabled={isBatchSyncing}
            color="green"
          />
        )}
        {showAction('delete') && (
          <ActionButton
            icon={<Trash2 className="w-4 h-4" />}
            onClick={() => onAction('delete')}
            disabled={isBatchSyncing}
            color="red"
          />
        )}
        {(showAction('download') || showAction('delete')) && <div className="w-px h-4 bg-gray-200 dark:bg-white/10 mx-1" />}
        
        {showAction('move') && (
          <CascadingMenu
            folders={folders}
            placement="top"
            disabled={isBatchSyncing}
            onSelect={(folderId) => onAction('move', folderId)}
          />
        )}
        </div>
      )}

      {(mode === 'both' || mode === 'mobile') && (
        /* Mobile View (< md) - Bottom Floating Bar */
        <AnimatePresence>
        <m.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          className={cn(
            // 95% opaque: a backdrop blur here was invisible but re-filtered the
            // scrolling list behind the bar on every frame.
            "fixed bottom-0 left-0 right-0 z-9999 bg-white/95 dark:bg-gray-900/95 border-t border-white/20 dark:border-white/10 p-3 sm:p-4 flex items-center justify-between shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.3)]",
            "pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-[calc(1rem+env(safe-area-inset-bottom))]",
            "lg:hidden"
          )}
        >
          <div className="flex items-center justify-around w-full gap-2">
            {showAction('lock') && (
              <MobileActionButton
                icon={<Lock className="w-5 h-5" />}
                label="鎖定"
                onClick={() => onAction('lock')}
                disabled={isBatchSyncing}
                color="text-violet-500"
              />
            )}
            {showAction('unlock') && (
              <MobileActionButton
                icon={<Unlock className="w-5 h-5" />}
                label="解鎖"
                onClick={() => onAction('unlock')}
                disabled={isBatchSyncing}
                color="text-cyan-500"
              />
            )}
            {showAction('download') && (
              <MobileActionButton
                icon={<Download className="w-5 h-5" />}
                label="下載"
                onClick={() => onAction('download')}
                disabled={isBatchSyncing}
                color="text-green-500"
              />
            )}
            {showAction('delete') && (
              <MobileActionButton
                icon={<Trash2 className="w-5 h-5" />}
                label="刪除"
                onClick={() => onAction('delete')}
                disabled={isBatchSyncing}
                color="text-red-500"
              />
            )}
             <div className="w-px h-8 bg-gray-200 dark:bg-white/10 mx-1" />
            {showAction('move') && (
              <CascadingMenu
                key="move-menu-mobile"
                folders={folders}
                placement="top"
                disabled={isBatchSyncing}
                onSelect={(folderId) => onAction('move', folderId)}
                trigger={
                   <div 
                    role="button"
                    tabIndex={0}
                    className={cn(
                        "flex flex-col items-center justify-center gap-1 min-w-[3rem] min-h-11 text-gray-600 dark:text-gray-400 transition-opacity",
                        isBatchSyncing ? "opacity-50 cursor-not-allowed" : "opacity-100 cursor-pointer"
                    )}
                   >
                      <div className="p-2 bg-gray-100 dark:bg-white/10 rounded-full hover:bg-gray-200 dark:hover:bg-white/20 active:scale-95 transition-all">
                           <span className="text-xs font-bold">移動</span>
                      </div>
                   </div>
                }
              />
            )}
          </div>
        </m.div>
      </AnimatePresence>
    )}
  </>
  );
};

const ActionButton = ({ icon, onClick, disabled, color }: { icon: React.ReactNode, onClick: () => void, disabled: boolean, color: string }) => {
  const colorClasses: Record<string, string> = {
    violet: "text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10",
    cyan: "text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-500/10",
    green: "text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10",
    red: "text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`p-2 rounded-md transition-colors ${colorClasses[color] || ""}`}
    >
      {icon}
    </button>
  );
};

const MobileActionButton = ({ icon, label, onClick, disabled, color }: { icon: React.ReactNode, label: string, onClick: () => void, disabled: boolean, color: string }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`flex flex-col items-center gap-1 min-w-[3rem] ${color}`}
  >
    <div className="p-2 rounded-full active:bg-gray-100 dark:active:bg-white/10 transition-colors">
      {icon}
    </div>
    <span className="text-[10px] font-medium opacity-80">{label}</span>
  </button>
);
