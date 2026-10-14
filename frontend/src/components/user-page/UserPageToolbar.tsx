import React from 'react';
import { Cpu, Zap, LayoutGrid, List, CheckSquare, Square } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BatchActionBar } from '../dashboard/BatchActionBar';
import type { SelectedItem, UserDashboardData } from '../../types/dashboard';

interface UserPageToolbarProps {
  activeTab: 'files' | 'urls';
  onTabChange: (tab: 'files' | 'urls') => void;
  
  viewMode: 'grid' | 'list';
  onViewModeChange: (mode: 'grid' | 'list') => void;

  selectedItems: SelectedItem[];
  isAuthenticated: boolean;
  isBatchSyncing: boolean;
  onBatchAction: (action: 'lock' | 'unlock' | 'delete' | 'download' | 'move', folderId?: string | null) => void;
  folders: UserDashboardData['folders'];
  
  // Selection
  itemCount: number;
  allItemsSelected: boolean;
  onSelectAll: () => void;
}

export const UserPageToolbar: React.FC<UserPageToolbarProps> = ({
  activeTab,
  onTabChange,
  viewMode,
  onViewModeChange,
  selectedItems,
  isAuthenticated,
  isBatchSyncing,
  onBatchAction,
  folders,
  itemCount,
  allItemsSelected,
  onSelectAll
}) => {
  return (
    <div className="flex items-center justify-between gap-1 sm:gap-2 pb-1 lg:pb-0">
      <div className="flex items-center gap-1 sm:gap-2 flex-1">
        <button
          onClick={() => onTabChange('files')}
          className={cn(
            "flex-1 sm:flex-none min-h-11 lg:min-h-0 px-3 py-1.5 sm:px-6 sm:py-2.5 rounded-lg sm:rounded-xl font-black text-[10px] sm:text-xs transition-all duration-300 flex items-center justify-center gap-1.5 relative overflow-hidden",
            activeTab === 'files'
              ? "bg-cyan-500 text-white shadow-lg shadow-cyan-500/20"
              : "text-gray-500 dark:text-gray-400 hover:bg-white/40 dark:hover:bg-white/5"
          )}
        >
          <Cpu className="h-4 w-4" />
          檔案列表
        </button>
        <button
          onClick={() => onTabChange('urls')}
          className={cn(
            "flex-1 sm:flex-none min-h-11 lg:min-h-0 px-3 py-1.5 sm:px-6 sm:py-2.5 rounded-lg sm:rounded-xl font-black text-[10px] sm:text-xs transition-all duration-300 flex items-center justify-center gap-1.5 relative overflow-hidden",
            activeTab === 'urls'
              ? "bg-violet-500 text-white shadow-lg shadow-violet-500/20"
              : "text-gray-500 dark:text-gray-400 hover:bg-white/40 dark:hover:bg-white/5"
          )}
        >
          <Zap className="h-4 w-4" />
          筆記 / 連結
        </button>
      </div>

      {/* Desktop Toolbar - Connected with Tabs */}
      <div className="hidden lg:flex items-center gap-3 bg-white/40 dark:bg-white/5 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 ml-4">
         
         {/* Batch Actions */}
         {selectedItems.length > 0 && isAuthenticated && (
           <div className="border-r border-gray-200 dark:border-white/10 pr-3 mr-1">
             <BatchActionBar
               selectedCount={selectedItems.length}
               isBatchSyncing={isBatchSyncing}
               onAction={onBatchAction}
               folders={(folders || []).filter(f => f.type === (activeTab === 'files' ? 'file' : 'url'))}
               allowedActions={activeTab === 'files' ? ['lock', 'unlock', 'download', 'delete', 'move'] : ['lock', 'unlock', 'delete', 'move']}
               mode="desktop"
             />
           </div>
         )}

         {/* Select All */}
         <div className="flex items-center gap-2 border-r border-gray-200 dark:border-white/10 pr-3">
            <button
              onClick={onSelectAll}
              className="p-1.5 rounded-lg hover:bg-white/20 transition-colors group"
              title="全選"
            >
              {allItemsSelected 
                  ? <CheckSquare className="w-4 h-4 text-cyan-600 dark:text-cyan-400" /> 
                  : <Square className="w-4 h-4 text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300" />}
            </button>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-gray-500 dark:text-gray-400 uppercase tracking-widest leading-none">
                {itemCount} ITEMS
              </span>
            </div>
         </div>

         {/* View Mode */}
         <div className="flex items-center bg-gray-100 dark:bg-black/20 p-1 rounded-lg">
            <button
              onClick={() => onViewModeChange('grid')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === 'grid' ? "bg-white dark:bg-white/10 text-cyan-600 dark:text-cyan-400 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              )}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={cn(
                "p-1.5 rounded-md transition-all",
                viewMode === 'list' ? "bg-white dark:bg-white/10 text-cyan-600 dark:text-cyan-400 shadow-sm" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              )}
            >
              <List className="w-3.5 h-3.5" />
            </button>
         </div>
      </div>
    </div>
  );
};
