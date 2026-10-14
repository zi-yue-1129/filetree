import React, { useState } from 'react';
import {
  Folder as FolderIcon, CheckSquare, Square, Edit3, Trash2, Check, X,
  MoreVertical, Share2, QrCode, Download, Lock, Unlock
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLongPress } from '../../hooks/useLongPress';
import { setDragPreview, type DragItem } from '../../utils/dragUtils';
import type { Folder } from './FolderSidebar';
import { DropdownMenu } from '../ui/DropdownMenu';
import { CascadingMenu } from '../ui/CascadingMenu';

// ItemWrapper with long-press and drag support 
interface ItemWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  onLongPress: (e: React.MouseEvent | React.TouchEvent) => void;
  onClick: (e: React.MouseEvent | React.TouchEvent) => void;
  onDoubleClick?: (e: React.MouseEvent | React.TouchEvent) => void;
  draggable?: boolean;
  isDesktop?: boolean;
}

const ItemWrapper: React.FC<ItemWrapperProps> = ({ 
  onClick, onLongPress, onDoubleClick, draggable, isDesktop: propIsDesktop, children, ...props 
}) => {
  const isDesktop = propIsDesktop ?? (typeof window !== 'undefined' && window.innerWidth >= 1024);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlers = useLongPress(onLongPress as any, onClick as any, { delay: 600 });
  
  if (isDesktop) {
    return (
      <div 
        {...props} 
        draggable={draggable}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
      >
        {children}
      </div>
    );
  }

  // Mobile behavior: Use long-press synthesis for better touch control
  return (
    <div 
      {...props} 
      {...handlers}
      draggable={false}
      onDoubleClick={onDoubleClick}
    >
      {children}
    </div>
  );
};


interface FolderItemProps {
  folder: Folder;
  isSelected: boolean;
  isSelectionMode: boolean;
  isAuthenticated: boolean;
  onToggleSelect: (type: 'folder', id: string) => void;
  onFolderClick: (id: string) => void;
  onSelectionModeChange: (active: boolean) => void;
  onUpdateFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;
  onMoveItem: (type: 'file' | 'url' | 'folder', id: string, folderId: string | null) => void;
  dragOverFolderId: string | null;
  setDragOverFolderId: (id: string | null) => void;
  renamingFolderId: string | null;
  setRenamingFolderId: (id: string | null) => void;
  folders?: Folder[];
  onShare?: (folderId: string) => void;
  onQrCode?: (folderId: string) => void;
  onDownloadFolder?: (folderId: string) => void;
  onToggleLock?: (type: 'folder', id: string, currentStatus: boolean) => void;
  viewMode: 'grid' | 'list';
  isDesktop?: boolean;
}

export const FolderItem: React.FC<FolderItemProps> = React.memo(({
  folder,
  isSelected,
  isSelectionMode,
  isAuthenticated,
  onToggleSelect,
  onFolderClick,
  onSelectionModeChange,
  onUpdateFolder,
  onDeleteFolder,
  onMoveItem,
  dragOverFolderId,
  setDragOverFolderId,
  renamingFolderId,
  setRenamingFolderId,
  folders = [],
  onShare,
  onQrCode,
  onDownloadFolder,
  onToggleLock,
  viewMode,
  isDesktop: propIsDesktop
}) => {
  const isDesktop = propIsDesktop ?? (typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [newName, setNewName] = useState(folder.name);
  const [isRenaming, setIsRenaming] = useState(false);

  const handleRenameFolder = async () => {
    if (!newName || !onUpdateFolder) {
      setRenamingFolderId(null);
      return;
    }

    setIsRenaming(true);
    try {
      await onUpdateFolder(folder.id, newName);
      setRenamingFolderId(null);
    } catch (e) {
      console.error(e);
    } finally {
      setIsRenaming(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnterFolder = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverFolderId(folder.id);
  };

  const handleDragLeaveFolder = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverFolderId(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOverFolderId(null);
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    
    try {
      const parsed = JSON.parse(data);
      if (parsed.items && Array.isArray(parsed.items)) {
        parsed.items.forEach((item: { type: 'file' | 'url' | 'folder', id: string }) => {
          if (item.type === 'folder' && item.id === folder.id) return;
          onMoveItem(item.type, item.id, folder.id);
        });
        return;
      }
      const { type, id } = parsed;
      if (type && id) {
        if (type === 'folder' && id === folder.id) return;
        onMoveItem(type, id, folder.id);
      }
    } catch (err) {
      console.error("Drop error:", err);
    }
  };

  // Common dropdown items for mobile menus
  const mobileDropdownItems = [
    { 
      label: '分享', 
      icon: <Share2 className="w-4 h-4 text-blue-500" />, 
      onClick: () => onShare?.(folder.id),
      hidden: !onShare
    },
    {
      label: 'QR Code',
      icon: <QrCode className="w-4 h-4 text-violet-500" />,
      onClick: () => onQrCode?.(folder.id),
      hidden: !onQrCode
    },
    {
      label: '下載',
      icon: <Download className="w-4 h-4 text-green-500" />,
      onClick: () => onDownloadFolder?.(folder.id),
      hidden: !onDownloadFolder
    },
    {
      label: '重命名',
      icon: <Edit3 className="w-4 h-4 text-cyan-500" />,
      onClick: () => { setRenamingFolderId(folder.id); setNewName(folder.name); },
      hidden: !isAuthenticated
    },
    {
      label: folder.is_locked ? '解除鎖定' : '鎖定資料夾',
      icon: folder.is_locked ? <Unlock className="w-4 h-4 text-violet-500" /> : <Lock className="w-4 h-4 text-gray-400" />,
      onClick: () => onToggleLock?.('folder', folder.id, !!folder.is_locked),
      hidden: !onToggleLock || !isAuthenticated
    },
    {
      label: '移動',
      icon: <FolderIcon className="w-4 h-4 text-orange-500" />,
      onClick: () => {}, // Triggered via cascading menu
      isCascading: true,
      hidden: !onMoveItem || !isAuthenticated
    },
    { label: 'separator', icon: null, onClick: () => {}, hidden: !isAuthenticated },
    {
      label: '刪除',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => {
        if (window.confirm(`確定要刪除資料夾 "${folder.name}" 嗎？`)) {
          onDeleteFolder?.(folder.id);
        }
      },
      variant: 'danger' as const,
      hidden: !onDeleteFolder || !isAuthenticated
    }
  ];

  if (viewMode === 'list') {
    return (
      <ItemWrapper
        isDesktop={isDesktop}
        onClick={() => {
          if (isSelectionMode) {
            onToggleSelect('folder', folder.id);
          } else if (isDesktop) {
            // Desktop: Select on single click in normal mode
            onToggleSelect('folder', folder.id);
          } else {
            // Mobile: Enter on single click in normal mode
            onFolderClick(folder.id);
          }
        }}
        onDoubleClick={() => {
          if (!isSelectionMode && isDesktop) {
            onFolderClick(folder.id);
          }
        }}
        onLongPress={() => onSelectionModeChange(true)}
        className={cn(
          "relative group flex items-center gap-2 sm:gap-4 p-1.5 sm:p-3 bg-white/40 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 border border-transparent rounded-xl transition-all duration-300 cursor-pointer shadow-sm folder-card",
          isSelected 
            ? "bg-cyan-500/10 dark:bg-cyan-500/20 ring-1 ring-cyan-500/50 shadow-md"
            : "hover:border-cyan-500/30",
          folder.is_locked && "opacity-60 grayscale-[0.8] contrast-75 brightness-95",
          folder.id === dragOverFolderId && "ring-2 ring-cyan-500 bg-cyan-100 dark:bg-cyan-900/30 scale-105 z-10"
        )}
        draggable={!isSelectionMode}
        onDragStart={(event) => {
          const e = event as unknown as React.DragEvent<HTMLDivElement>;
          const itemsToDrag: DragItem[] = [{ type: 'folder', id: folder.id }];
          e.dataTransfer.setData('application/json', JSON.stringify({ type: 'folder', id: folder.id }));
          e.dataTransfer.effectAllowed = 'move';
          setDragPreview(e, itemsToDrag);
        }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnterFolder}
        onDragLeave={handleDragLeaveFolder}
        onDrop={handleDrop}
        data-id={`folder:${folder.id}`}
      >
        {/* Selection Checkbox + Icon */}
        <div className="flex items-center gap-3 shrink-0">
          <div className={cn(
            "transition-opacity relative",
            (isSelected || isSelectionMode) 
              ? "opacity-100" 
              : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
          )}>
             {folder.is_locked && (
                <div className="absolute -top-1.5 -left-1.5 bg-violet-600 text-white p-1 rounded-lg shadow-xl z-20 ring-2 ring-white dark:ring-black">
                  <Lock className="w-3.5 h-3.5" />
                </div>
              )}
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect('folder', folder.id); }}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
            >
               {isSelected ? <CheckSquare className="w-4 h-4 text-cyan-600" /> : <Square className="w-4 h-4 text-gray-400" />}
            </button>
          </div>

          <div className="p-2 bg-cyan-100 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 rounded-xl">
            <FolderIcon className="w-5 h-5" />
          </div>
        </div>

        {/* Folder Info */}
        <div className="flex-1 min-w-0">
          {renamingFolderId === folder.id ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameFolder();
                  if (e.key === 'Escape') setRenamingFolderId(null);
                }}
                className="w-full text-sm p-1.5 rounded-lg border border-cyan-500/50 bg-white dark:bg-black/20 outline-none"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              />
              <button
                onClick={(e) => { e.stopPropagation(); handleRenameFolder(); }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                disabled={isRenaming}
                className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-lg"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setRenamingFolderId(null); }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                disabled={isRenaming}
                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h3 className="flex-1 font-bold text-sm text-gray-700 dark:text-gray-200 truncate">
                {folder.name}
              </h3>
              {folder.is_locked && (
                 <div className={cn(
                  "p-1 rounded-md",
                  "bg-violet-500/10 text-violet-500"
                )}>
                  <Lock className="w-3 h-3" />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        {!isSelectionMode && (
          <div className="shrink-0 flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity pr-2">
            {!renamingFolderId && (
              <div className="flex items-center gap-1">
                 {/* Desktop Actions */}
                 <div className="hidden lg:flex items-center gap-1">
                    {isAuthenticated && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleLock?.('folder', folder.id, !!folder.is_locked); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => e.stopPropagation()}
                        className={cn(
                          "p-2 rounded-lg transition-all duration-300",
                          folder.is_locked 
                            ? "text-violet-600 bg-violet-600/10 hover:bg-violet-600/20 shadow-md" 
                            : "text-cyan-600 bg-cyan-600/10 hover:bg-cyan-600/20 shadow-sm"
                        )}
                      >
                         {folder.is_locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      </button>
                    )}
                    {onShare && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onShare(folder.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => e.stopPropagation()}
                        className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                    )}
                    {onQrCode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onQrCode(folder.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => e.stopPropagation()}
                        className="p-2 text-gray-400 hover:text-violet-600 hover:bg-violet-500/5 rounded-lg transition-colors"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                    )}
                    {onDownloadFolder && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onDownloadFolder(folder.id); }}
                        onMouseDown={(e) => e.stopPropagation()}
                        onMouseUp={(e) => e.stopPropagation()}
                        className="p-2 text-gray-400 hover:text-green-600 hover:bg-green-500/5 rounded-lg transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )}
                     {folders.length > 0 && isAuthenticated && (
                      <CascadingMenu
                        folders={folders}
                        onSelect={(folderId) => onMoveItem?.('folder', folder.id, folderId)}
                        trigger={
                          <button
                            className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                             onMouseDown={(e) => e.stopPropagation()}
                             onMouseUp={(e) => e.stopPropagation()}
                             onTouchStart={(e) => e.stopPropagation()}
                             onTouchEnd={(e) => e.stopPropagation()}
                          >
                            <FolderIcon className="w-4 h-4" />
                          </button>
                        }
                      />
                    )}
                    {isAuthenticated && (
                       <>
                         <button
                           onClick={(e) => { e.stopPropagation(); setRenamingFolderId(folder.id); setNewName(folder.name); }}
                           onMouseDown={(e) => e.stopPropagation()}
                           onMouseUp={(e) => e.stopPropagation()}
                           className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                         >
                           <Edit3 className="w-4 h-4" />
                         </button>
                         {onDeleteFolder && (
                           <button
                             onClick={(e) => {
                               e.stopPropagation();
                               if (window.confirm(`確定要刪除資料夾 "${folder.name}" 嗎？`)) {
                                 onDeleteFolder(folder.id);
                               }
                             }}
                             onMouseDown={(e) => e.stopPropagation()}
                             onMouseUp={(e) => e.stopPropagation()}
                             className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/5 rounded-lg transition-colors"
                           >
                             <Trash2 className="w-4 h-4" />
                           </button>
                         )}
                       </>
                    )}
                 </div>

                 {/* Mobile Actions Menu */}
                 <div 
                   className="lg:hidden"
                   onClick={(e) => e.stopPropagation()}
                   onMouseDown={(e) => e.stopPropagation()}
                   onMouseUp={(e) => e.stopPropagation()}
                   onTouchStart={(e) => e.stopPropagation()}
                   onTouchEnd={(e) => e.stopPropagation()}
                 >
                    <DropdownMenu
                      trigger={
                        <button 
                          className="min-w-11 min-h-11 flex items-center justify-center p-2 text-gray-400 hover:text-cyan-600 rounded-lg transition-colors"
                          onMouseDown={(e) => e.stopPropagation()}
                          onMouseUp={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          onTouchEnd={(e) => e.stopPropagation()}
                        >
                          <MoreVertical className="w-5 h-5" />
                        </button>
                      }
                      items={mobileDropdownItems}
                    />
                 </div>
              </div>
            )}
          </div>
        )}
      </ItemWrapper>
    );
  }

  // ─── GRID VIEW ───
  return (
    <ItemWrapper
      isDesktop={isDesktop}
      className={cn(
        "group relative flex flex-col items-center justify-center p-4 rounded-2xl transition-all duration-500 overflow-hidden cursor-pointer folder-card",
        isSelected 
          ? "bg-cyan-500/10 dark:bg-cyan-500/20 ring-1 ring-cyan-500/50 shadow-lg scale-[1.02]" 
          : "bg-white/40 dark:bg-white/2 hover:bg-white/60 dark:hover:bg-white/5 border border-white/20 shadow-sm hover:shadow-xl hover:-translate-y-1",
        dragOverFolderId === folder.id && "ring-2 ring-cyan-500 bg-cyan-500/10 scale-[1.05]",
        "lg:min-h-35"
      )}
      draggable={!isSelectionMode}
      onDragStart={(event) => {
        const e = event as unknown as React.DragEvent<HTMLDivElement>;
        const itemsToDrag: DragItem[] = [{ type: 'folder', id: folder.id }];
        e.dataTransfer.setData('application/json', JSON.stringify({ type: 'folder', id: folder.id }));
        e.dataTransfer.effectAllowed = 'move';
        setDragPreview(e, itemsToDrag);
      }}
      onClick={() => {
        if (isSelectionMode) {
          onToggleSelect('folder', folder.id);
        } else if (isDesktop) {
          // Desktop: Select on single click in normal mode
          onToggleSelect('folder', folder.id);
        } else {
          // Mobile: Enter on single click
          onFolderClick(folder.id);
        }
      }} 
      onDoubleClick={() => {
        if (!isSelectionMode && isDesktop) {
          onFolderClick(folder.id);
        }
      }}
      onLongPress={() => onSelectionModeChange(true)}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnterFolder}
      onDragLeave={handleDragLeaveFolder}
      onDrop={handleDrop}
      data-id={`folder:${folder.id}`}
    >
      {/* Selection Checkbox */}
      <div className={cn(
        "absolute top-2 left-2 z-30 transition-opacity",
        (isSelected || isSelectionMode) 
          ? "opacity-100 pointer-events-auto" 
          : "opacity-0 pointer-events-none lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto"
      )}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect('folder', folder.id); }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className="relative tap-target p-1.5 rounded-lg bg-white/90 dark:bg-black/80 shadow-sm hover:bg-white dark:hover:bg-black flex items-center justify-center"
        >
           {isSelected ? <CheckSquare className="w-4 h-4 text-cyan-600" /> : <Square className="w-4 h-4 text-gray-400" />}
        </button>
      </div>

      {folder.is_locked && (
        <div className={cn(
          "absolute top-2 z-20 pointer-events-none",
          (isSelected || isSelectionMode) ? "left-10" : "left-2"
        )}>
          <div className="p-1 rounded bg-white/90 dark:bg-black/80 shadow-sm text-violet-600">
            <Lock className="w-3.5 h-3.5" />
          </div>
        </div>
      )}

      {/* Mobile Action Menu (top-right) */}
      {!isSelectionMode && renamingFolderId !== folder.id && (
        <div 
          className="absolute top-1.5 right-1.5 z-30 lg:hidden"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
        >
          <DropdownMenu
            trigger={
              // Visual stays 32px (a bigger box covered the folder name);
              // tap-target gives it an invisible 44px touch area.
              <button
                aria-label={`${folder.name} 的操作`}
                className="relative tap-target p-1.5 rounded-lg backdrop-blur-sm transition-all shadow-sm bg-white/80 dark:bg-black/50 text-gray-500 hover:text-cyan-500 min-w-8 min-h-8 flex items-center justify-center"
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-3.5 h-3.5" />
              </button>
            }
            items={mobileDropdownItems}
          />
        </div>
      )}

      {/* pr-6 on phones keeps the name clear of the absolute ⋮ button. */}
      <div className={cn("flex items-center gap-3 w-full", renamingFolderId !== folder.id && "pr-6 lg:pr-0")}>
        {/* Phones hide the icon while renaming so the input and two 44px
            buttons fit the narrow card. */}
        <div className={cn(
          "p-2 bg-cyan-100 dark:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 rounded-xl shrink-0",
          renamingFolderId === folder.id && "hidden lg:block"
        )}>
          <FolderIcon className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          {renamingFolderId === folder.id ? (
            // Phones: input on its own row and 44px confirm/cancel buttons below it.
            <div className="flex flex-wrap lg:flex-nowrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameFolder();
                  if (e.key === 'Escape') setRenamingFolderId(null);
                }}
                className="w-full min-h-11 lg:min-h-0 text-xs p-1 rounded border border-cyan-500/50 bg-white dark:bg-black/20 outline-none"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              />
              <button
                onClick={(e) => { e.stopPropagation(); handleRenameFolder(); }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                disabled={isRenaming}
                aria-label="確認重新命名"
                className="flex-1 lg:flex-none min-w-11 min-h-11 lg:min-w-0 lg:min-h-0 flex items-center justify-center p-1 text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 rounded"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setRenamingFolderId(null); }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                disabled={isRenaming}
                aria-label="取消重新命名"
                className="flex-1 lg:flex-none min-w-11 min-h-11 lg:min-w-0 lg:min-h-0 flex items-center justify-center p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <h4 data-folder-name className="text-xs font-bold text-gray-700 dark:text-gray-200 truncate group-hover:text-cyan-600 transition-colors">
              {folder.name}
            </h4>
          )}
        </div>

        {/* Desktop hover actions */}
            {/* Desktop Hover Actions (Overlay) */}
            {!renamingFolderId && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity hidden lg:flex flex-wrap items-end content-end justify-center gap-1 p-3 z-20 pointer-events-none">
              {onShare && (
                <button
                  onClick={(e) => { e.stopPropagation(); onShare(folder.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  className="p-1.5 bg-white rounded-full text-blue-500 hover:text-blue-600 shadow-md transition-transform hover:scale-110 pointer-events-auto"
                  title="分享"
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>
              )}
              {onQrCode && (
                <button
                  onClick={(e) => { e.stopPropagation(); onQrCode(folder.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  className="p-1.5 bg-white rounded-full text-violet-500 hover:text-violet-600 shadow-md transition-transform hover:scale-110 pointer-events-auto"
                  title="QR Code"
                >
                  <QrCode className="w-3.5 h-3.5" />
                </button>
              )}
              {onDownloadFolder && (
                 <button
                  onClick={(e) => { e.stopPropagation(); onDownloadFolder(folder.id); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  className="p-1.5 bg-white rounded-full text-green-500 hover:text-green-600 shadow-md transition-transform hover:scale-110 pointer-events-auto"
                  title="下載資料夾"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>
              )}
              
              {isAuthenticated && (
                <>
                  <button
                    onClick={(e) => { 
                      e.stopPropagation(); 
                      setRenamingFolderId(folder.id); 
                      setNewName(folder.name); 
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    className="p-1.5 bg-white rounded-full text-cyan-500 hover:text-cyan-600 shadow-md transition-transform hover:scale-110 pointer-events-auto"
                    title="重命名"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  {folders.length > 0 && (
                      <CascadingMenu
                        folders={folders}
                        onSelect={(folderId) => onMoveItem?.('folder', folder.id, folderId)}
                        trigger={
                          <button
                            className="p-1.5 bg-white rounded-full text-orange-500 hover:text-orange-600 shadow-md transition-transform hover:scale-110 pointer-events-auto"
                            title="移動到..."
                            onMouseDown={(e) => e.stopPropagation()}
                            onMouseUp={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onTouchEnd={(e) => e.stopPropagation()}
                          >
                            <FolderIcon className="w-3.5 h-3.5" />
                          </button>
                        }
                      />
                    )}
                </>
              )}

              {onToggleLock && isAuthenticated && (
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleLock('folder', folder.id, !!folder.is_locked); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  className={cn(
                    "p-1.5 rounded-full shadow-md transition-transform hover:scale-110 pointer-events-auto",
                    folder.is_locked 
                      ? "bg-white text-violet-600 hover:text-violet-700" 
                      : "bg-white text-gray-400 hover:text-violet-600"
                  )}
                  title={folder.is_locked ? '解除鎖定' : '鎖定'}
                >
                  {folder.is_locked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                </button>
              )}

              {onDeleteFolder && isAuthenticated && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`確定要刪除資料夾 "${folder.name}" 嗎？`)) {
                      onDeleteFolder(folder.id);
                    }
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  className="p-1.5 bg-white rounded-full text-gray-400 hover:text-red-500 shadow-md transition-transform hover:scale-110 pointer-events-auto"
                  title="刪除"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            )}
      </div>
    </ItemWrapper>
  );
});
