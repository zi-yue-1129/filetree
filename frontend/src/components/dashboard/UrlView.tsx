import React, { useState, useMemo } from 'react';
import { 
  ExternalLink, 
  Lock, 
  Unlock, 
  Trash2, 
  CheckSquare, 
  Square,
  MoreVertical,
  QrCode,
  Copy, 

  FolderIcon,
  Link as LinkIcon,
  FileText
} from 'lucide-react';
import { useLongPress } from '../../hooks/useLongPress';
import { cn } from '../../lib/utils';
import { CascadingMenu } from '../ui/CascadingMenu';

import { DropdownMenu } from '../ui/DropdownMenu';
import { createPortal } from 'react-dom';
import { useSelectionBox } from '../../hooks/useSelectionBox';
import { FolderItem } from './FolderItem';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { setDragPreview, type DragItem } from '../../utils/dragUtils';
import type { Folder } from './FolderSidebar';

export interface UrlItem {
  url: string;
  created: string | number;
  is_locked?: boolean;
  folder_id?: string | null;
}

// Stable Virtuoso List components to prevent remounting on re-render
const GridListContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    className="pt-2 sm:pt-6 pb-24 sm:pb-32 grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 sm:gap-4"
    style={style}
  >
    {children}
  </div>
));
GridListContainer.displayName = 'GridListContainer';

const ListContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    className="pt-2 sm:pt-6 pb-24 sm:pb-32"
    style={{
      ...style,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.4rem',
    }}
  >
    {children}
  </div>
));
ListContainer.displayName = 'ListContainer';

// Custom Scroller to apply project scrollbar styling
const CustomScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ style, children, ...props }, ref) => (
  <div
    ref={ref}
    {...props}
    className="custom-scrollbar"
    style={{
      ...style,
      overflowY: 'auto',
      height: '100%',
    }}
  >
    {children}
  </div>
));
CustomScroller.displayName = 'CustomScroller';

interface UrlViewProps {
  urls: UrlItem[];
  selectedItems: { type: 'file' | 'url' | 'folder'; id: string }[];
  isAuthenticated: boolean;
  onToggleSelect: (type: 'url' | 'folder' | 'file', id: string) => void;
  onBatchSelect: (items: { type: 'file' | 'url' | 'folder'; id: string }[], mode: 'set' | 'add') => void;

  onToggleLock: (type: 'url' | 'folder' | 'file', id: string, isLocked: boolean) => void;
  onQrCode: (url: string) => void;
  onDelete: (id: string) => void;
  onCopy: (url: string) => void;
  folders: Folder[];
  activeFolderId: string | null;
  onMoveItem: (type: 'url' | 'file' | 'folder', id: string, folderId: string | null) => void;
  onFolderClick: (folderId: string) => void;
  onUpdateFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;

  viewMode: 'grid' | 'list';

  isSelectionMode: boolean;
  onSelectionModeChange: (active: boolean) => void;
  onShareFolder?: (folderId: string) => void;
  onQrCodeFolder?: (folderId: string) => void;
  onDownloadFolder?: (folderId: string) => void;
  onPreview: (note: { name: string; size: string; url: string }) => void;
  isDesktop?: boolean;
}

const isValidUrl = (url: string) => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

interface ItemWrapperProps extends React.HTMLAttributes<HTMLDivElement> {
  onClick: (e: React.MouseEvent | React.TouchEvent) => void;
  onLongPress: (e: React.MouseEvent | React.TouchEvent) => void;
  onDoubleClick?: (e: React.MouseEvent | React.TouchEvent) => void;
  draggable?: boolean;
  isDesktop?: boolean;
}

const ItemWrapper: React.FC<ItemWrapperProps> = ({ 
  onClick, onLongPress, onDoubleClick, draggable, isDesktop: propIsDesktop, children, ...props 
}) => {
  const isDesktop = propIsDesktop ?? (typeof window !== 'undefined' && window.innerWidth >= 1024);
  const handlers = useLongPress(onLongPress, onClick, { delay: 600 });
  
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

  // Mobile behavior
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

export const UrlView: React.FC<UrlViewProps> = ({
  urls,
  selectedItems,
  isAuthenticated,
  onToggleSelect,
  onBatchSelect,

  onToggleLock,
  onQrCode,
  onDelete,
  onCopy,
  folders,
  activeFolderId,
  onMoveItem,
  onFolderClick,
  onUpdateFolder,
  onDeleteFolder,

  viewMode,

  isSelectionMode,
  onSelectionModeChange,
  onShareFolder,
  onQrCodeFolder,
  onDownloadFolder,
  onPreview,
  isDesktop = true
}) => {
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const currentSubfolders = useMemo(() => 
    folders.filter(f => f.parent_id === activeFolderId && f.type === 'url'),
    [folders, activeFolderId]
  );
  const filteredUrls = useMemo(() => urls || [], [urls]);

  const gridComponents = useMemo(() => ({
    List: GridListContainer,
    Scroller: CustomScroller,
  }), []);

  const listComponents = useMemo(() => ({
    List: ListContainer,
    Scroller: CustomScroller,
  }), []);

  const { selectionBox, handlePointerDown, handlePointerMove, handlePointerUp, handleTouchStart, handleTouchMove } = useSelectionBox(
    containerRef,
    ".url-item, .folder-card",
    React.useCallback(({ visibleIds, intersectingIds }: { visibleIds: string[], intersectingIds: string[] }) => {
      
      const visibleSet = new Set(visibleIds);
      
      const preservedSelection = selectedItems.filter(item => {
        const dataId = item.type === 'folder' ? `folder:${item.id}` : `url:${item.id}`;
        return !visibleSet.has(dataId);
      });

      const newSelection = [...preservedSelection];

      intersectingIds.forEach(dataId => {
        const [type, ...rest] = dataId.split(':');
        const id = rest.join(':');

        if (type === 'folder') {
           if (!newSelection.some(i => i.type === 'folder' && i.id === id)) {
             newSelection.push({ type: 'folder', id });
           }
        } else if (type === 'url') {
           if (!newSelection.some(i => i.type === 'url' && i.id === id)) {
             newSelection.push({ type: 'url', id });
           }
        }
      });
      
      onBatchSelect(newSelection, 'set');
    }, [onBatchSelect, selectedItems]),
    React.useCallback(() => {
      onBatchSelect([], 'set');
    }, [onBatchSelect])
  , isDesktop);




  return (
    <section className="flex-1 min-h-0 flex flex-col bg-white/60 dark:bg-space-black/40 backdrop-blur-xl rounded-4xl border border-white/40 dark:border-white/5 shadow-2xl overflow-hidden relative">
      <div className="absolute inset-0 bg-linear-to-b from-white/20 to-transparent dark:from-white/5 dark:to-transparent pointer-events-none" />

      <div 
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="flex-1 min-w-0 overflow-hidden p-2 sm:p-4 custom-scrollbar touch-pan-y relative flex flex-col"
      >
        {selectionBox && createPortal(
          <div
            className="fixed bg-violet-500/20 border border-violet-500/50 z-9999 pointer-events-none rounded"
            style={{
              left: selectionBox.x1,
              top: selectionBox.y1,
              width: selectionBox.x2 - selectionBox.x1,
              height: selectionBox.y2 - selectionBox.y1,
            }}
          />,
          document.body
        )}

        {/* Render Folders */}
        {currentSubfolders.length > 0 && (
          <div className="mb-6">
            <h3 className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3 px-1">
              Folders
            </h3>
            <div className={cn(
              "grid gap-2 sm:gap-4",
              viewMode === 'grid' 
                ? "grid-cols-[repeat(auto-fill,minmax(120px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]" 
                : "grid-cols-1"
            )}>
              {currentSubfolders.map(folder => {
                const isSelected = !!selectedItems.find(i => i.type === 'folder' && i.id === folder.id);
                return (
                  <FolderItem
                    key={folder.id}
                    folder={folder}
                    isSelected={isSelected}
                    isSelectionMode={isSelectionMode}
                    isAuthenticated={isAuthenticated}
                    onToggleSelect={onToggleSelect}
                    onFolderClick={onFolderClick}
                    onSelectionModeChange={onSelectionModeChange}
                    onUpdateFolder={onUpdateFolder}
                    onDeleteFolder={onDeleteFolder}
                    onMoveItem={onMoveItem}
                    dragOverFolderId={dragOverFolderId}
                    setDragOverFolderId={setDragOverFolderId}
                    renamingFolderId={renamingFolderId}
                    setRenamingFolderId={setRenamingFolderId}
                    folders={folders}
                    onShare={onShareFolder}
                    onQrCode={onQrCodeFolder}
                    onDownloadFolder={onDownloadFolder}
                    onToggleLock={onToggleLock}
                    viewMode={viewMode}
                    isDesktop={isDesktop}
                  />
                );
              })}
            </div>
          </div>
        )}

        {(!urls || urls.length === 0) && currentSubfolders.length === 0 ? (
          <div className="h-64 flex flex-col items-center justify-center text-gray-400 dark:text-white/20">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <ExternalLink className="w-8 h-8 opacity-50" />
            </div>
            <p className="text-sm font-medium">尚無連結</p>
          </div>
        ) : (urls && urls.length > 0) ? (
          <div className="flex-1 min-h-0 flex flex-col">
            {viewMode === 'grid' ? (
              <VirtuosoGrid
                style={{ flex: 1, minHeight: 0 }}
                data={filteredUrls}
                totalCount={filteredUrls.length}
                overscan={200}
                components={gridComponents}
                itemContent={(_index, url) => {
                  const isSelected = !!selectedItems.find(i => i.type === 'url' && i.id === url.url);
                  const isLocked = url.is_locked && !isAuthenticated;
                  const isActuallyUrl = isValidUrl(url.url);

                  return (
                    <ItemWrapper
                      key={url.url}
                      isDesktop={isDesktop}
                      onClick={() => {
                        if (isSelectionMode) {
                          onToggleSelect('url', url.url);
                        } else if (isDesktop) {
                          // Desktop: Single click selects
                          onToggleSelect('url', url.url);
                        } else {
                          // Mobile: Open directly
                          if (!isLocked) {
                            if (isActuallyUrl) {
                               if (window.confirm('是否開啟外部連結？')) {
                                 window.open(url.url, '_blank', 'noopener,noreferrer');
                               }
                            } else {
                              onPreview({ name: '筆記預覽', size: 'Note', url: url.url });
                            }
                          }
                        }
                      }}
                      onDoubleClick={() => {
                        if (isDesktop && !isSelectionMode && !isLocked) {
                           if (isActuallyUrl) {
                              window.open(url.url, '_blank', 'noopener,noreferrer');
                           } else {
                              onPreview({ name: '筆記預覽', size: 'Note', url: url.url });
                           }
                        }
                      }}
                      onLongPress={() => onSelectionModeChange(true)}
                      className={cn(
                        "relative group bg-white/40 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 border border-transparent hover:border-violet-500/30 transition-all duration-300 shadow-sm hover:shadow-md url-item cursor-pointer overflow-hidden flex flex-col p-2.5 sm:p-4 space-y-2 rounded-2xl",
                        isSelected && "ring-2 ring-violet-500 bg-violet-50 dark:bg-violet-900/10",
                        url.is_locked && "opacity-60 grayscale-[0.8] contrast-75 brightness-95"
                      )}
                      draggable={!isSelectionMode}
                      onDragStart={(event) => {
                        const e = event as unknown as React.DragEvent<HTMLDivElement>;
                        const isUrlSelected = selectedItems.some((i: { type: string; id: string }) => i.type === 'url' && i.id === url.url);
                        const itemsToDrag: DragItem[] = isUrlSelected
                          ? (selectedItems.filter(i => (i.type === 'url' || i.type === 'folder' || i.type === 'file')) as DragItem[])
                          : [{ type: 'url', id: url.url }];
                        
                        e.dataTransfer.setData('application/json', JSON.stringify({ 
                          items: itemsToDrag,
                          type: 'url',
                          id: url.url
                        }));
                        e.dataTransfer.effectAllowed = 'move';
                        setDragPreview(e, itemsToDrag);
                      }}
                      data-id={`url:${url.url}`}
                    >
                       <div className="shrink-0 pt-1 pointer-events-none">
                        <div className={cn(
                          "w-10 h-10 rounded-xl flex items-center justify-center transition-colors mb-3",
                          isActuallyUrl 
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" 
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        )}>
                          {isActuallyUrl ? <LinkIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        </div>

                        {!isLocked && (
                          <div className={cn(
                            "transition-opacity z-30 absolute top-1.5 left-1.5",
                            // Hidden checkboxes must not catch taps: on touch screens
                            // (no hover) they were invisible yet selected the note.
                            (isSelected || isSelectionMode)
                              ? "opacity-100 pointer-events-auto"
                              : "opacity-0 pointer-events-none lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto"
                          )}>
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleSelect('url', url.url); }}
                              onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                              className="relative tap-target p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-colors bg-white/50 dark:bg-white/10 backdrop-blur-sm flex items-center justify-center"
                            >
                              {isSelected ? <CheckSquare className="w-5 h-5 text-violet-600" /> : <Square className="w-5 h-5 text-gray-400" />}
                            </button>
                          </div>
                        )}

                        {!isLocked && (
                          <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 lg:group-hover:opacity-100 transition-opacity z-20 hidden lg:flex flex-wrap items-end content-end justify-center gap-1.5 pt-10 p-3 pointer-events-none">
                            <button
                              onClick={(e) => { e.stopPropagation(); onQrCode(url.url); }}
                              onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                              className="p-2 bg-white rounded-full text-gray-700 hover:text-violet-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
                              title="QR Code"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onCopy(url.url); }}
                              onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                              className="p-2 bg-white rounded-full text-gray-700 hover:text-cyan-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
                              title="複製"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            {isAuthenticated && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onToggleLock('url', url.url, !!url.is_locked); }}
                                  onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                                  className={cn(
                                    "p-2 bg-white rounded-full shadow-lg transition-transform hover:scale-110 pointer-events-auto",
                                    url.is_locked ? "text-violet-600" : "text-gray-700 hover:text-violet-600"
                                  )}
                                  title={url.is_locked ? "解除鎖定" : "鎖定項目"}
                                >
                                  {url.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                                </button>
                                {isAuthenticated && (
                                  <CascadingMenu
                                    folders={folders}
                                    onSelect={(folderId: string | null) => onMoveItem('url', url.url, folderId)}
                                    trigger={
                                      <button 
                                        className="p-2 bg-white rounded-full text-gray-700 hover:text-cyan-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto" 
                                        title="移動到..."
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
                                <button
                                  onClick={(e) => { e.stopPropagation(); onDelete(url.url); }}
                                  onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                                  className="p-2 bg-white rounded-full text-gray-700 hover:text-red-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
                                  title="刪除項目"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>

                       <div className="flex-1 min-w-0 flex flex-col justify-center mt-1">
                        <div className="flex items-start gap-3 mb-1">
                          <p className={cn(
                            "flex-1 text-sm font-medium transition-all break-all overflow-hidden line-clamp-2",
                            isLocked 
                              ? "blur-[5px] select-none text-gray-300" 
                              : isActuallyUrl 
                                ? "text-blue-500 dark:text-blue-400 group-hover:underline" 
                                : "text-gray-900 dark:text-white"
                          )}>
                            {url.url}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-[10px] font-bold text-gray-400 dark:text-white/30 tracking-widest uppercase mt-auto">
                          <span>{new Date(url.created).toLocaleDateString()}</span>
                        </div>

                        {!isLocked && (
                           <div 
                             className="absolute top-2 right-2 z-30 lg:hidden" 
                             onClick={(e) => e.stopPropagation()}
                             onMouseDown={(e) => e.stopPropagation()}
                             onMouseUp={(e) => e.stopPropagation()}
                             onTouchStart={(e) => e.stopPropagation()}
                             onTouchEnd={(e) => e.stopPropagation()}
                           >
                               <DropdownMenu
                                 trigger={
                                   <button
                                     className="p-2 sm:p-1.5 rounded-lg backdrop-blur-sm transition-all shadow-sm bg-white/80 dark:bg-black/50 text-gray-500 hover:text-cyan-500 min-w-11 min-h-11 flex items-center justify-center"
                                     onMouseDown={(e) => e.stopPropagation()}
                                     onMouseUp={(e) => e.stopPropagation()}
                                     onTouchStart={(e) => e.stopPropagation()}
                                     onTouchEnd={(e) => e.stopPropagation()}
                                   >
                                     <MoreVertical className="w-4 h-4" />
                                   </button>
                                 }
                                 items={[
                                   { label: 'QR Code', icon: <QrCode className="w-4 h-4 text-violet-500" />, onClick: () => onQrCode(url.url) },
                                   { label: '複製', icon: <Copy className="w-4 h-4 text-cyan-500" />, onClick: () => onCopy(url.url) },
                                   { 
                                     label: url.is_locked ? '解除鎖定' : '鎖定項目', 
                                     icon: url.is_locked ? <Lock className="w-4 h-4 text-violet-600" /> : <Unlock className="w-4 h-4 text-cyan-600" />, 
                                     onClick: () => onToggleLock('url', url.url, !!url.is_locked),
                                     hidden: !isAuthenticated
                                   },
                                   { label: 'separator', icon: null, onClick: () => {}, hidden: !isAuthenticated },
                                   { label: '刪除項目', icon: <Trash2 className="w-4 h-4" />, onClick: () => onDelete(url.url), variant: 'danger', hidden: !isAuthenticated }
                                 ]}
                               />
                           </div>
                        )}
                      </div>
                    </ItemWrapper>
                  );
                }}
              />
            ) : (
                <Virtuoso
                style={{ flex: 1, minHeight: 0 }}
                data={filteredUrls}
                totalCount={filteredUrls.length}
                overscan={200}
                components={listComponents}
                itemContent={(_index, url) => {
                  const isSelected = !!selectedItems.find(i => i.type === 'url' && i.id === url.url);
                  const isLocked = url.is_locked && !isAuthenticated;
                  const isActuallyUrl = isValidUrl(url.url);

                  return (
                    <ItemWrapper
                      key={url.url}
                       isDesktop={isDesktop}
                      onClick={() => {
                        if (isSelectionMode) {
                          onToggleSelect('url', url.url);
                        } else if (isDesktop) {
                          onToggleSelect('url', url.url);
                        } else {
                          // Mobile: Open directly
                          if (!isLocked) {
                            if (isActuallyUrl) {
                              if (window.confirm('是否開啟外部連結？')) {
                                window.open(url.url, '_blank');
                              }
                            } else {
                              onPreview({ name: '筆記預覽', size: 'Note', url: url.url });
                            }
                          }
                        }
                      }}
                      onDoubleClick={() => {
                        if (isDesktop && !isSelectionMode && !isLocked) {
                           if (isActuallyUrl) {
                              window.open(url.url, '_blank');
                           } else {
                              onPreview({ name: '筆記預覽', size: 'Note', url: url.url });
                           }
                        }
                      }}
                      onLongPress={() => onSelectionModeChange(true)}
                      className={cn(
                        "relative group flex items-center gap-2 sm:gap-4 p-1.5 sm:p-3 bg-white/40 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 border border-transparent hover:border-violet-500/30 rounded-xl transition-all duration-300 shadow-sm cursor-pointer url-item",
                        isSelected && "ring-2 ring-violet-500 bg-violet-50 dark:bg-violet-900/10",
                        url.is_locked && "opacity-60 grayscale-[0.8] contrast-75 brightness-95"
                      )}
                      draggable={!isSelectionMode}
                      onDragStart={(event) => {
                        const e = event as unknown as React.DragEvent<HTMLDivElement>;
                        const isUrlSelected = selectedItems.some((i: { type: string; id: string }) => i.type === 'url' && i.id === url.url);
                        const itemsToDrag: DragItem[] = isUrlSelected
                          ? (selectedItems.filter(i => (i.type === 'url' || i.type === 'folder' || i.type === 'file')) as DragItem[])
                          : [{ type: 'url', id: url.url }];

                        e.dataTransfer.setData('application/json', JSON.stringify({ 
                          items: itemsToDrag,
                          type: 'url',
                          id: url.url
                        }));
                        e.dataTransfer.effectAllowed = 'move';
                        setDragPreview(e, itemsToDrag);
                      }}
                      data-id={`url:${url.url}`}
                    >
                      <div className="flex items-center gap-3 shrink-0 pointer-events-none">
                        {!isLocked && (
                          <div className={cn(
                            "transition-opacity z-30",
                            // Hidden checkboxes must not catch taps (no hover on touch screens).
                            (isSelected || isSelectionMode)
                              ? "opacity-100 pointer-events-auto"
                              : "opacity-0 pointer-events-none lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto"
                          )}>
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleSelect('url', url.url); }}
                              onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                              className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                            >
                              {isSelected ? <CheckSquare className="w-4 h-4 text-violet-600" /> : <Square className="w-4 h-4 text-gray-400" />}
                            </button>
                          </div>
                        )}

                        <div className={cn(
                          "p-2 rounded-xl transition-all",
                          isActuallyUrl 
                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400" 
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        )}>
                          {isActuallyUrl ? <LinkIcon className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className={cn(
                            "flex-1 text-sm font-bold transition-all truncate",
                            isLocked 
                              ? "blur-[5px] select-none text-gray-300" 
                              : isActuallyUrl 
                                ? "text-blue-500 dark:text-blue-400 group-hover:underline" 
                                : "text-gray-900 dark:text-white"
                          )}>
                            {url.url}
                          </p>
                          {url.is_locked && (
                            <div className={cn(
                              "p-1 rounded-md",
                              isLocked ? "bg-black/40 text-white/70" : "bg-violet-500/10 text-violet-500"
                            )}>
                              <Lock className="w-3 h-3" />
                            </div>
                          )}
                        </div>
                        <div className="text-[10px] font-bold text-gray-400 dark:text-white/20 uppercase tracking-widest mt-0.5">
                          {new Date(url.created).toLocaleDateString()}
                        </div>
                      </div>

                      {!isLocked && (
                        <div className="shrink-0 flex items-center gap-1 ml-auto" onClick={(e) => e.stopPropagation()}>
                          <div className="hidden lg:flex items-center gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); onQrCode(url.url); }}
                              onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                              className="p-2 text-gray-400 hover:text-violet-500 hover:bg-violet-500/5 rounded-lg transition-colors"
                              title="QR Code"
                            >
                              <QrCode className="w-4 h-4" />
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); onCopy(url.url); }}
                              onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                              className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                              title="複製"
                            >
                              <Copy className="w-4 h-4" />
                            </button>
                            {isAuthenticated && (
                              <>
                                <button
                                  onClick={(e) => { e.stopPropagation(); onToggleLock('url', url.url, !!url.is_locked); }}
                                  onMouseDown={(e) => e.stopPropagation()}
                               onMouseUp={(e) => e.stopPropagation()}
                               onTouchStart={(e) => e.stopPropagation()}
                               onTouchEnd={(e) => e.stopPropagation()}
                                   className={cn(
                                     "p-2 rounded-lg transition-all duration-300",
                                     url.is_locked 
                                       ? "text-violet-600 bg-violet-600/10 hover:bg-violet-600/20 shadow-md" 
                                       : "text-cyan-600 bg-cyan-600/10 hover:bg-cyan-600/20 shadow-sm"
                                   )}
                                 >
                                   {url.is_locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                                </button>
                                 {isAuthenticated && (
                                   <CascadingMenu
                                     folders={folders}
                                     onSelect={(folderId: string | null) => onMoveItem('url', url.url, folderId)}
                                     trigger={
                                       <button
                                         className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                                         title="移動到..."
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
                                 <button
                                   onClick={(e) => { e.stopPropagation(); onDelete(url.url); }}
                                   onMouseDown={(e) => e.stopPropagation()}
                                   onMouseUp={(e) => e.stopPropagation()}
                                   onTouchStart={(e) => e.stopPropagation()}
                                   onTouchEnd={(e) => e.stopPropagation()}
                                   className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/5 rounded-lg transition-colors"
                                 >
                                   <Trash2 className="w-4 h-4" />
                                 </button>
                               </>
                            )}
                          </div>

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
                                   className="min-w-11 min-h-11 flex items-center justify-center p-2 text-gray-400 hover:text-violet-500 rounded-lg transition-colors"
                                   onMouseDown={(e) => e.stopPropagation()}
                                   onMouseUp={(e) => e.stopPropagation()}
                                   onTouchStart={(e) => e.stopPropagation()}
                                   onTouchEnd={(e) => e.stopPropagation()}
                                 >
                                   <MoreVertical className="w-5 h-5" />
                                 </button>
                               }
                               items={[
                                 { label: 'QR Code', icon: <QrCode className="w-4 h-4 text-violet-500" />, onClick: () => onQrCode(url.url) },
                                 { label: '複製', icon: <Copy className="w-4 h-4 text-cyan-500" />, onClick: () => onCopy(url.url) },
                                 { 
                                   label: url.is_locked ? '解除鎖定' : '鎖定項目', 
                                   icon: url.is_locked ? <Unlock className="w-4 h-4 text-violet-500" /> : <Lock className="w-4 h-4 text-gray-400" />, 
                                   onClick: () => onToggleLock('url', url.url, !!url.is_locked),
                                   hidden: !isAuthenticated
                                 },
                                 { label: 'separator', icon: null, onClick: () => {}, hidden: !isAuthenticated },
                                 { label: '刪除項目', icon: <Trash2 className="w-4 h-4" />, onClick: () => onDelete(url.url), variant: 'danger', hidden: !isAuthenticated }
                               ]}
                             />
                          </div>
                        </div>
                      )}
                    </ItemWrapper>
                  );
                }}
              />
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
};
