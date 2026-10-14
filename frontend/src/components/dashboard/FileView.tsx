import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  FileText,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSelectionBox } from '../../hooks/useSelectionBox';
import { useStableCallback } from '../../hooks/useStableCallback';

import type { Folder } from './FolderSidebar';
import { Virtuoso, VirtuosoGrid } from 'react-virtuoso';
import { FileItem, type FileItemData } from './FileItem';
import { FolderItem } from './FolderItem';
import { MobileTopSpacer } from '../user-page/MobileTopSpacer';
import { DASHBOARD_SCROLLER_ATTRIBUTE } from '../../hooks/useHideOnScroll';

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
      {...{ [DASHBOARD_SCROLLER_ATTRIBUTE]: '' }}
      style={style}
      className="custom-scrollbar"
    >
      {children}
    </div>
  )
);
CustomScroller.displayName = 'CustomScroller';

/**
 * Rows rendered on the first pass, before Virtuoso has measured the viewport
 * (saves a measure-then-render round trip on slow devices).
 */
const INITIAL_RENDERED_FILES = 12;

/** Data handed to the Virtuoso header through its `context` prop. */
interface FileListContext {
  folders: React.ReactNode;
  /** Phone: reserve room for the floating chrome above the first row. */
  topSpacer: boolean;
}

/**
 * Folder cards rendered as the virtual list's header, so they scroll together
 * with the files (a long folder grid used to push the list out of view).
 */
const FoldersHeader: React.FC<{ context?: FileListContext }> = ({ context }) => (
  <>
    {context?.topSpacer && <MobileTopSpacer />}
    {context?.folders}
  </>
);

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
  /** Phone: start the scroll content below the floating chrome. */
  mobileTopInset?: boolean;
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
  isDesktop = true,
  mobileTopInset = false
}) => {
  const [renamingFile, setRenamingFile] = React.useState<string | null>(null);
  const [newName, setNewName] = React.useState<string>('');
  const [isRenaming, setIsRenaming] = React.useState(false);
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  const [dragOverFolderId, setDragOverFolderId] = React.useState<string | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleRename = useStableCallback(async (oldName: string) => {
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
  });

  // O(1) selection lookups; rows get a boolean instead of the whole array.
  const selectedFileIds = useMemo(
    () => new Set(selectedItems.filter(i => i.type === 'file').map(i => i.id)),
    [selectedItems],
  );
  const selectedFolderIds = useMemo(
    () => new Set(selectedItems.filter(i => i.type === 'folder').map(i => i.id)),
    [selectedItems],
  );
  // Drag-and-drop needs the current selection only when a drag starts.
  const selectedItemsRef = useRef(selectedItems);
  useLayoutEffect(() => {
    selectedItemsRef.current = selectedItems;
  });
  const getSelectedItems = useCallback(() => selectedItemsRef.current, []);

  // Filter folders for current view
  const currentSubfolders = useMemo(() => 
    folders.filter(f => f.parent_id === activeFolderId && f.type === 'file'), // 'file' type in Folder structure means general folder
  [folders, activeFolderId]);

  // Stable component references for Virtuoso to prevent remounting
  const gridComponents = useMemo(() => ({
    List: GridListContainer,
    Scroller: CustomScroller,
    Header: FoldersHeader,
  }), []);

  const listComponents = useMemo(() => ({
    List: ListContainer,
    Scroller: CustomScroller,
    Header: FoldersHeader,
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




  // Folder cards (few) are not virtualized; they render as the list header.
  const foldersNode = currentSubfolders.length > 0 ? (
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
          const isSelected = selectedFolderIds.has(folder.id);
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
  ) : null;
  const listContext: FileListContext = { folders: foldersNode, topSpacer: mobileTopInset };

  const renderFileItem = (_index: number, file: FileItemData) => {
    const isRenamingThis = renamingFile === file.name;
    return (
      <FileItem
        key={file.name}
        file={file}
        username={username}
        token={token}
        isSelected={selectedFileIds.has(file.name)}
        isSelectionMode={isSelectionMode}
        isAuthenticated={isAuthenticated}
        folders={folders}
        viewMode={viewMode}
        onToggleSelect={onToggleSelect}
        onSelectionModeChange={onSelectionModeChange}
        onPreview={onPreview}
        onShare={onShare}
        onQrCode={onQrCode}
        onDelete={onDelete}
        onRename={onRename}
        onToggleLock={onToggleLock}
        onMoveItem={onMoveItem}
        renamingFile={isRenamingThis ? renamingFile : null}
        setRenamingFile={setRenamingFile}
        setNewName={setNewName}
        newName={isRenamingThis ? newName : ''}
        isRenaming={isRenamingThis && isRenaming}
        handleRename={handleRename}
        getSelectedItems={getSelectedItems}
        isDesktop={isDesktop}
      />
    );
  };

  return (
    // Phones: full-bleed pane (no card frame) under the floating chrome;
    // `isolate` keeps raised cards (z-index) below that chrome even when
    // low-power modes drop the backdrop-filter that used to isolate them.
    <section className="flex-1 min-h-0 flex flex-col bg-white/60 dark:bg-space-black/40 backdrop-blur-xl lg:rounded-4xl border-0 lg:border border-white/40 dark:border-white/5 lg:shadow-2xl overflow-hidden relative isolate">
      <div className="absolute inset-0 bg-linear-to-b from-white/20 to-transparent dark:from-white/5 dark:to-transparent pointer-events-none" />

      {/* Scrollable File Area */}
      <div 
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        className="flex-1 min-h-0 min-w-0 flex flex-col px-2 pb-2 sm:px-4 sm:pb-4 lg:pt-4 custom-scrollbar touch-pan-y relative overflow-hidden"
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
        
        {(!files || files.length === 0) && currentSubfolders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 dark:text-white/20">
            {mobileTopInset && <MobileTopSpacer />}
            <div className="w-16 h-16 rounded-full bg-gray-100 dark:bg-white/5 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 opacity-50" />
            </div>
            <p className="text-sm font-medium">尚無檔案</p>
          </div>
        ) : (!files || files.length === 0) ? (
          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar" {...{ [DASHBOARD_SCROLLER_ATTRIBUTE]: '' }}>
            {mobileTopInset && <MobileTopSpacer />}
            {foldersNode}
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col">
            {viewMode === 'grid' ? (
              <VirtuosoGrid
                style={{ flex: 1, minHeight: 0 }}
                data={files}
                totalCount={files.length}
                overscan={200}
                initialItemCount={Math.min(files.length, INITIAL_RENDERED_FILES)}
                components={gridComponents}
                context={listContext}
                itemContent={renderFileItem}
              />
            ) : (
                <Virtuoso
                style={{ flex: 1, minHeight: 0 }}
                data={files}
                totalCount={files.length}
                overscan={200}
                initialItemCount={Math.min(files.length, INITIAL_RENDERED_FILES)}
                components={listComponents}
                context={listContext}
                itemContent={renderFileItem}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
};
