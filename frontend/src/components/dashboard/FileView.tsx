import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSelectionBox } from '../../hooks/useSelectionBox';

import type { Folder } from './FolderSidebar';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { FileItem, type FileItemData } from './FileItem';
import { FolderItem } from './FolderItem';

// Stable Virtuoso List components to prevent remounting on re-render
const GridListContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={style}
      className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] lg:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2 sm:gap-4 pb-24 sm:pb-32 pt-2 sm:pt-6"
    >
      {children}
    </div>
  )
);
GridListContainer.displayName = 'GridListContainer';


const ListContainer = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={style}
      className="flex flex-col gap-1.5 sm:gap-2 pb-24 sm:pb-32 pt-2 sm:pt-6"
    >
      {children}
    </div>
  )
);
ListContainer.displayName = 'ListContainer';

// Custom Scroller to apply project scrollbar styling
const CustomScroller = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      {...props}
      style={style}
      className="custom-scrollbar"
    >
      {children}
    </div>
  )
);
CustomScroller.displayName = 'CustomScroller';

interface FileViewProps {
  files: FileItemData[];
  username: string;
  token: string | null;
  selectedItems: { type: 'file' | 'url' | 'folder'; id: string }[];
  isAuthenticated: boolean;
  onToggleSelect: (type: 'file' | 'url' | 'folder', id: string) => void;
  onBatchSelect: (items: { type: 'file' | 'url' | 'folder'; id: string }[], action: 'add' | 'remove' | 'set') => void;

  onToggleLock: (type: 'file' | 'url', id: string, currentStatus: boolean) => void;
  onPreview: (file: { name: string; size: string; url: string }) => void;
  onShare: (filename: string) => void;
  onQrCode: (filename: string) => void;
  onDelete: (filename: string) => void;
  onRename?: (oldName: string, newName: string) => Promise<boolean>;
  folders: Folder[];
  activeFolderId: string | null;
  onMoveItem: (type: 'file' | 'url' | 'folder', id: string, folderId: string | null) => void;
  onFolderClick: (folderId: string) => void;
  onUpdateFolder?: (id: string, name: string) => Promise<void>;
  onDeleteFolder?: (id: string) => Promise<void>;

  viewMode: 'grid' | 'list';

  isSelectionMode: boolean;
  onSelectionModeChange: (active: boolean) => void;
  onShareFolder?: (folderId: string) => void;
  onQrCodeFolder?: (folderId: string) => void;
  onDownloadFolder?: (folderId: string) => void;
  onToggleFolderLock?: (type: 'folder', id: string, currentStatus: boolean) => void;
  isDesktop?: boolean;
}

export const FileView: React.FC<FileViewProps> = ({
  files,
  username,
  token,
  selectedItems,
  isAuthenticated,
  onToggleSelect,
  onBatchSelect,

  onToggleLock,
  onPreview,
  onShare,
  onQrCode,
  onDelete,
  onRename,
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
  onToggleFolderLock,
  isDesktop = true
}) => {
  const [renamingFile, setRenamingFile] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState<string>('');
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleRename = async (oldName: string) => {
    if (!onRename || !newName.trim() || newName === oldName) {
      setRenamingFile(null);
      return;
    }
    setIsRenaming(true);
    try {
      const ok = await onRename(oldName, newName.trim());
      if (ok) setRenamingFile(null);
    } finally {
      setIsRenaming(false);
    }
  };

  // Filter folders for current view
  const currentSubfolders = useMemo(() => 
    folders.filter(f => f.parent_id === activeFolderId && f.type === 'file'), // 'file' type in Folder structure means general folder
  [folders, activeFolderId]);

  // Stable component references for Virtuoso to prevent remounting
  const gridComponents = useMemo(() => ({
    List: GridListContainer,
    Scroller: CustomScroller,
  }), []);

  const listComponents = useMemo(() => ({
    List: ListContainer,
    Scroller: CustomScroller,
  }), []);

  // Combine folders and files for selection logic if needed, but virtualization handles them separately usually.
  // We'll keep folders separate at top for now, non-virtualized if few, or virtualized if many.
  // Given folders are usually few, we can render them standard map, and virtualize files below.
  
  const { selectionBox, handlePointerDown, handlePointerMove, handlePointerUp, handleTouchStart, handleTouchMove } = useSelectionBox(
    containerRef,
    ".folder-card, .file-item",
    React.useCallback(({ visibleIds, intersectingIds }: { visibleIds: string[], intersectingIds: string[] }) => {
      onBatchSelect([], 'set'); // Clear previous selection first? No, we are setting new state.

      // Delta Update Logic:
      // 1. Identify items that are currently selected AND NOT visible. Keep them.
      // 2. Identify items that are intersecting. Add them.
      // 3. Items that are visible but not intersecting will be implicitly removed (by not adding them).

      const visibleSet = new Set(visibleIds);
      
      // Filter out items that are visible from the previous selection
      // (If they are visible and still selected, they will be re-added by intersectingIds)
      // (If they are visible and NOT selected anymore, they won't be in intersectingIds)
      const preservedSelection = selectedItems.filter(item => {
        // Construct the data-id for this item to check visibility
        const dataId = item.type === 'folder' ? `folder:${item.id}` : `file:${item.id}`;
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
        } else if (type === 'file') {
           if (!newSelection.some(i => i.type === 'file' && i.id === id)) {
             newSelection.push({ type: 'file', id });
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

      {/* Scrollable File Area */}
      <div 
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="flex-1 min-h-0 min-w-0 flex flex-col p-2 sm:p-4 custom-scrollbar touch-pan-y relative overflow-hidden"
      >
        {selectionBox && createPortal(
          <div
            className="fixed bg-cyan-500/20 border border-cyan-500/50 z-9999 pointer-events-none rounded"
            style={{
              left: selectionBox.x1,
              top: selectionBox.y1,
              width: selectionBox.x2 - selectionBox.x1,
              height: selectionBox.y2 - selectionBox.y1,
            }}
          />,
          document.body
        )}
        
        {/* Render Folders (Non-virtualized for simplicity as usually few) */}
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
                    onToggleLock={onToggleFolderLock}
                    viewMode={viewMode}
                    isDesktop={isDesktop}
                  />
                );
              })}
            </div>
          </div>
        )}

        {(!files || files.length === 0) && currentSubfolders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-white/20">
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 opacity-50" />
            </div>
            <p className="text-sm font-medium">尚無檔案</p>
          </div>
        ) : (!files || files.length === 0) ? null : (
          <div className="flex-1 min-h-0 flex flex-col">
            {viewMode === 'grid' ? (
              <VirtuosoGrid
                style={{ flex: 1, minHeight: 0 }}
                data={files}
                totalCount={files.length}
                overscan={200}
                components={gridComponents}
                itemContent={(_index, file) => {
                   const isSelected = !!selectedItems.find(i => i.type === 'file' && i.id === file.name);
                   return (
                      <FileItem
                        key={file.name}
                        file={file}
                        username={username}
                        token={token}
                        isSelected={isSelected}
                        isSelectionMode={isSelectionMode}
                        isAuthenticated={isAuthenticated}
                        folders={folders}
                        viewMode={viewMode}
                        onToggleSelect={onToggleSelect}
                        onSelectionModeChange={onSelectionModeChange}
                        onPreview={onPreview}
                        onBatchSelect={onBatchSelect}
                        onShare={onShare}
                        onQrCode={onQrCode}
                        onDelete={onDelete}
                        onRename={onRename}
                        onToggleLock={onToggleLock}
                        onMoveItem={onMoveItem}
                        renamingFile={renamingFile}
                        setRenamingFile={setRenamingFile}
                        setNewName={setNewName}
                        newName={newName}
                        isRenaming={isRenaming}
                        handleRename={handleRename}
                        selectedItems={selectedItems}
                        isDesktop={isDesktop}
                      />
                   );
                }}
              />
            ) : (
                <Virtuoso
                style={{ flex: 1, minHeight: 0 }}
                data={files}
                totalCount={files.length}
                overscan={200}
                components={listComponents}
                itemContent={(_index, file) => {
                   const isSelected = !!selectedItems.find(i => i.type === 'file' && i.id === file.name);
                   return (
                      <FileItem
                        key={file.name}
                        file={file}
                        username={username}
                        token={token}
                        isSelected={isSelected}
                        isSelectionMode={isSelectionMode}
                        isAuthenticated={isAuthenticated}
                        folders={folders}
                        viewMode={viewMode}
                        onToggleSelect={onToggleSelect}
                        onSelectionModeChange={onSelectionModeChange}
                        onPreview={onPreview}
                        onBatchSelect={onBatchSelect}
                        onShare={onShare}
                        onQrCode={onQrCode}
                        onDelete={onDelete}
                        onRename={onRename}
                        onToggleLock={onToggleLock}
                        onMoveItem={onMoveItem}
                        renamingFile={renamingFile}
                        setRenamingFile={setRenamingFile}
                        setNewName={setNewName}
                        newName={newName}
                        isRenaming={isRenaming}
                        handleRename={handleRename}
                        selectedItems={selectedItems}
                        isDesktop={isDesktop}
                      />
                   );
                }}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
};
