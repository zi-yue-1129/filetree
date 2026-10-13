import React from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { Folder as FolderIcon, ChevronRight, CheckSquare, Square, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Folder, SelectedItem } from '../../types/dashboard';

interface BreadcrumbsBarProps {
  breadcrumbs: Folder[];
  activeFolderId: string | null;
  onNavigate: (id: string | null) => void;
  onSidebarToggle: () => void;
  
  isSelectionMode: boolean;
  onSelectionModeChange: (active: boolean) => void;
  
  selectedItems: SelectedItem[];
  itemCount: number;
  filteredCount: number;
  onSelectAll: () => void;
  onClearSelection: () => void;
  
  activeTab: 'files' | 'urls';
}

export const BreadcrumbsBar: React.FC<BreadcrumbsBarProps> = ({
  breadcrumbs,
  activeFolderId,
  onNavigate,
  onSidebarToggle,
  isSelectionMode,
  onSelectionModeChange,
  selectedItems,
  filteredCount,
  onSelectAll,
  onClearSelection,
  activeTab
}) => {
  const currentTypeSelectedCount = selectedItems.filter(i => i.type === (activeTab === 'files' ? 'file' : 'url')).length;
  const isAllCurrentTypeSelected = currentTypeSelectedCount === filteredCount && filteredCount > 0;

  return (
    <div className="grid grid-cols-[1fr_auto] items-center w-full h-9 overflow-hidden pr-1">
      <div className="flex items-center gap-2 overflow-x-auto overflow-y-hidden no-scrollbar py-1 min-w-0 transition-all duration-300">
        <button
          onClick={onSidebarToggle}
          className={cn(
            "p-1.5 rounded-lg bg-white/40 dark:bg-white/5 bg-white/40 dark:bg-white/5 hover:bg-white/60 dark:hover:bg-white/10 transition-colors border border-white/20 shrink-0",
             activeTab === 'files' ? "text-gray-600 dark:text-cyan-500 hover:bg-cyan-500/10" : "text-gray-600 dark:text-violet-500 hover:bg-violet-500/10"
          )}
          aria-label="資料夾"
        >
          <FolderIcon className="w-4 h-4" />
        </button>
        <div className="w-px h-4 bg-gray-300 dark:bg-white/10 mx-1 lg:hidden shrink-0" />
        <button
          onClick={() => onNavigate(null)}
          className={cn(
            "px-2 py-1 rounded-lg text-xs font-bold transition-all shrink-0",
            activeFolderId === null
              ? activeTab === 'files' 
                  ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/20" 
                  : "bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              : "bg-white/40 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-white/10"
          )}
        >
          {activeTab === 'files' ? '所有檔案' : '所有連結'}
        </button>
        {breadcrumbs.map((crumb, idx, arr) => (
          <React.Fragment key={crumb.id}>
            <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
            <button
              onClick={() => onNavigate(crumb.id)}
              className={cn(
                "px-2 py-1 rounded-lg text-xs font-bold transition-all whitespace-nowrap shrink-0",
                idx === arr.length - 1
                  ? activeTab === 'files'
                      ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/20"
                      : "bg-violet-500 text-white shadow-lg shadow-violet-500/20"
                  : "bg-white/40 dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:bg-white/60 dark:hover:bg-white/10"
              )}
            >
              <FolderIcon className="w-3.5 h-3.5 inline mr-1" />
              {crumb.name}
            </button>
          </React.Fragment>
        ))}
      </div>
      
      <AnimatePresence>
        {isSelectionMode && (
          <m.div 
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            className="flex items-center gap-1.5 flex-nowrap shrink-0 bg-white/60 dark:bg-white/10 backdrop-blur-md px-2 py-1 rounded-xl border border-white/20 shadow-sm ml-2"
          >
            <button
              onClick={onSelectAll}
              className={cn(
                "p-1.5 rounded-lg border flex items-center gap-1.5 shrink-0 whitespace-nowrap shadow-sm",
                 activeTab === 'files' 
                    ? "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/10" 
                    : "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/10"
              )}
            >
              {isAllCurrentTypeSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              <span className="text-[10px] font-bold">全選</span>
            </button>
            <button
              onClick={() => { onSelectionModeChange(false); onClearSelection(); }}
              className="p-1.5 rounded-lg bg-gray-500/10 text-gray-600 dark:text-gray-400 border border-gray-500/10 shrink-0 shadow-sm"
            >
              <X className="w-4 h-4" />
            </button>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};
