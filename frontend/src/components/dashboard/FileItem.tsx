import React from 'react';
import { 
  FileText, 
  Image as ImageIcon, 
  Music, 
  Video, 
  File as FileIcon, 
  MoreVertical, 
  Download, 
  Trash2, 
  Edit3, 
  Share2, 
  Lock, 
  Unlock, 
  QrCode,
  CheckSquare,
  Square,
  Folder as FolderIcon,
  Clock,
  AlertCircle,
  Check,
  Loader2,
  X
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLongPress } from '../../hooks/useLongPress';
import { setDragPreview, type DragItem } from '../../utils/dragUtils';
import type { Folder } from './FolderSidebar';
import { CascadingMenu } from '../ui/CascadingMenu';
import { DropdownMenu } from '../ui/DropdownMenu';
import { API_ORIGIN } from '../../services/api';

export interface FileItemData {
  name: string;
  size?: number;
  size_bytes: number;
  created?: string;
  expired?: boolean;
  remaining_days: number;
  remaining_hours?: number;
  is_locked?: boolean;
  folder_id?: string | null;
  uploaded_at?: number;
  timetolive?: number;
}

const getFileIcon = (filename: string): React.ElementType => {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext!)) return ImageIcon;
  if (['mp4', 'webm', 'mov'].includes(ext!)) return Video;
  if (['mp3', 'wav', 'ogg'].includes(ext!)) return Music;
  if (['pdf', 'doc', 'docx', 'txt'].includes(ext!)) return FileText;
  return FileIcon;
};

/** Renders the file icon inline to avoid creating a component during render. */
const renderFileIcon = (filename: string, className: string) => {
  const IconComp = getFileIcon(filename);
  return <IconComp className={className} />;
};

const formatSize = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const getLifecycleColor = (file: FileItemData) => {
  if (file.expired) return 'text-red-400';
  if (file.remaining_days < 5) return 'text-neural-violet';
  return 'text-quantum-cyan';
};

// ItemWrapper with long-press and drag support
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

interface FileItemProps {
  file: FileItemData;
  username: string;
  token: string | null;
  isSelected: boolean;
  isSelectionMode: boolean;
  isAuthenticated: boolean;
  folders: Folder[];
  viewMode: 'grid' | 'list';
  /** Current selection, read lazily (drag start) so selection changes do not re-render every row. */
  getSelectedItems: () => { type: 'file' | 'url' | 'folder'; id: string }[];
  
  onToggleSelect: (type: 'file', id: string) => void;
  onSelectionModeChange: (active: boolean) => void;
  onPreview: (file: { name: string; size: string; url: string }) => void;
  
  // Actions
  onShare: (filename: string) => void;
  /** Show a QR code for a share link to this file (receives the filename). */
  onQrCode: (filename: string) => void;
  onDelete: (filename: string) => void;
  onRename?: (oldName: string, newName: string) => Promise<boolean>;
  onToggleLock: (type: 'file', id: string, currentStatus: boolean) => void;
  onMoveItem: (type: 'file' | 'url' | 'folder', id: string, folderId: string | null) => void;
  
  renamingFile: string | null;
  setRenamingFile: (name: string | null) => void;
  setNewName: (name: string) => void;
  newName: string;
  isRenaming: boolean;
  handleRename: (oldName: string) => void;
  isDesktop?: boolean;
}

/** File fields that FileItem renders or passes to its handlers. */
const RENDERED_FILE_FIELDS = ['name', 'size_bytes', 'expired', 'remaining_days', 'is_locked', 'folder_id'] as const;

/**
 * Memo comparator: every WebSocket REFRESH refetches the dashboard and creates
 * new file objects (and `remaining_hours`/`remaining_minutes` tick every
 * minute), so comparing `file` by identity re-rendered every visible row.
 * Compare the rendered file fields instead; all other props by identity.
 *
 * @param previous - Previous props.
 * @param next - Next props.
 * @returns Whether the row can skip re-rendering.
 */
function areFileItemPropsEqual(previous: FileItemProps, next: FileItemProps): boolean {
  for (const key of Object.keys(next) as Array<keyof FileItemProps>) {
    if (key === 'file') continue;
    if (!Object.is(previous[key], next[key])) return false;
  }
  if (Object.keys(previous).length !== Object.keys(next).length) return false;
  return RENDERED_FILE_FIELDS.every((field) => Object.is(previous.file[field], next.file[field]));
}

export const FileItem: React.FC<FileItemProps> = React.memo(({
  file,
  username,
  token,
  isSelected,
  isSelectionMode,
  isAuthenticated,
  folders,
  viewMode,
  getSelectedItems,
  onToggleSelect,
  onSelectionModeChange,
  onPreview,
  onShare,
  onQrCode,
  onDelete,
  onRename,
  onToggleLock,
  onMoveItem,
  renamingFile,
  setRenamingFile,
  setNewName,
  newName,
  isRenaming,
  handleRename,
  isDesktop: propIsDesktop
}) => {
  const isDesktop = propIsDesktop ?? (typeof window !== 'undefined' && window.innerWidth >= 1024);
  const isLocked = file.is_locked && !isAuthenticated;
  const isDisplayable = !isLocked && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov'].includes(file.name.split('.').pop()?.toLowerCase() || '');

  const handleClick = () => {
    if (isSelectionMode) {
      onToggleSelect('file', file.name);
      return;
    }
    
    if (isDesktop) {
      // Desktop: Single click selects in normal mode
      onToggleSelect('file', file.name);
    } else {
      // Mobile: Single click enters (preview)
      if (!isLocked) {
        onPreview({
          name: file.name,
          size: formatSize(file.size_bytes),
          url: `${API_ORIGIN}/api/download/${username}/${encodeURIComponent(file.name)}${token ? `?token=${token}` : ''}`
        });
      }
    }
  };

  const handleDragStart = (event: React.DragEvent<HTMLDivElement>) => {
    const selectedItems = getSelectedItems();
    const isFileSelected = selectedItems.some(i => i.type === 'file' && i.id === file.name);
    const itemsToDrag: DragItem[] = isFileSelected 
      ? selectedItems.map(i => ({ type: i.type, id: i.id }))
      : [{ type: 'file', id: file.name }];
    
    event.dataTransfer.setData('application/json', JSON.stringify({ 
      items: itemsToDrag,
      type: 'file',
      id: file.name
    }));
    event.dataTransfer.effectAllowed = 'move';
    setDragPreview(event, itemsToDrag);
  };

  // Common dropdown items for mobile menus (grid + list)
  const mobileDropdownItems = [
    { label: '分享', icon: <Share2 className="w-4 h-4 text-blue-500" />, onClick: () => onShare(file.name), hidden: isLocked },
    {
      label: 'QR Code',
      icon: <QrCode className="w-4 h-4 text-violet-500" />,
      onClick: () => {
        onQrCode(file.name);
      },
      hidden: isLocked
    },
    {
      label: '下載',
      icon: <Download className="w-4 h-4 text-green-500" />,
      onClick: () => {
        const a = document.createElement('a');
        a.href = `${API_ORIGIN}/api/download/${username}/${file.name}${token ? `?token=${token}` : ''}`;
        a.click();
      },
      hidden: isLocked
    },
    {
      label: '重命名',
      icon: <Edit3 className="w-4 h-4 text-cyan-500" />,
      onClick: () => { setRenamingFile(file.name); setNewName(file.name); },
      hidden: !onRename || isLocked || !isAuthenticated
    },
    {
      label: file.is_locked ? '解除鎖定' : '鎖定檔案',
      icon: file.is_locked ? <Unlock className="w-4 h-4 text-violet-500" /> : <Lock className="w-4 h-4 text-gray-400" />,
      onClick: () => onToggleLock('file', file.name, !!file.is_locked),
      hidden: !isAuthenticated
    },
    { label: 'separator', icon: null, onClick: () => {}, hidden: !isAuthenticated },
    {
      label: '刪除',
      icon: <Trash2 className="w-4 h-4" />,
      onClick: () => onDelete(file.name),
      variant: 'danger' as const,
      hidden: !isAuthenticated
    }
  ];

  // ─── LIST VIEW ───
  if (viewMode === 'list') {
    return (
      <ItemWrapper
        isDesktop={isDesktop}
        onClick={handleClick}
        onDoubleClick={() => {
          if (!isSelectionMode && isDesktop && !isLocked) {
            onPreview({
              name: file.name,
              size: formatSize(file.size_bytes),
              url: `${API_ORIGIN}/api/download/${username}/${encodeURIComponent(file.name)}${token ? `?token=${token}` : ''}`
            });
          }
        }}
        onLongPress={() => onSelectionModeChange(true)}
        className={cn(
          "relative group flex items-center gap-2 sm:gap-4 p-1.5 sm:p-3 bg-white/40 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 border border-transparent hover:border-cyan-500/30 rounded-xl transition-all duration-300 cursor-pointer shadow-sm file-item",
          isSelected && "ring-2 ring-cyan-500 bg-cyan-50 dark:bg-cyan-900/10",
          file.is_locked && "opacity-60 grayscale-[0.8] contrast-75 brightness-95"
        )}
        draggable={!isSelectionMode}
        onDragStart={(event) => handleDragStart(event as unknown as React.DragEvent<HTMLDivElement>)}
        data-id={`file:${file.name}`}
      >
        {/* Selection Checkbox + Icon */}
        <div className="flex items-center gap-3 shrink-0">
          {!isLocked && (
            <div className={cn(
              "transition-opacity relative",
              (isSelected || isSelectionMode) 
                ? "opacity-100" 
                : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto"
            )}>
              {file.is_locked && (
                <div className="absolute -top-1.5 -left-1.5 bg-violet-600 text-white p-1 rounded-lg shadow-xl z-20 ring-2 ring-white dark:ring-black">
                  <Lock className="w-3.5 h-3.5" />
                </div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect('file', file.name); }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
              >
                {isSelected ? <CheckSquare className="w-4 h-4 text-cyan-600" /> : <Square className="w-4 h-4 text-gray-400" />}
              </button>
            </div>
          )}

          <div className={cn(
            "p-2 rounded-xl transition-all",
            file.expired ? "bg-red-500/10 text-red-500" : "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400"
          )}>
            {renderFileIcon(file.name, "w-5 h-5")}
          </div>
        </div>

        {/* File Info */}
        <div className="flex-1 min-w-0">
          {renamingFile === file.name ? (
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(file.name);
                  if (e.key === 'Escape') setRenamingFile(null);
                }}
                className="w-full text-sm p-1.5 rounded-lg border border-cyan-500/50 bg-white dark:bg-black/20 outline-none"
              />
              <button
                onClick={() => handleRename(file.name)}
                disabled={isRenaming}
                className="p-1.5 text-green-500 hover:bg-green-50 dark:hover:bg-green-500/10 rounded-lg"
              >
                <Check className="w-4 h-4" />
              </button>
              <button
                onClick={() => setRenamingFile(null)}
                disabled={isRenaming}
                className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <h3 className={cn("flex-1 font-bold text-sm text-gray-700 dark:text-gray-200 truncate", isLocked && "blur-[3px]")}>
                {file.name}
              </h3>
              {file.is_locked && (
                <div className={cn(
                  "p-1 rounded-md",
                  isLocked ? "bg-black/40 text-white/70" : "bg-violet-500/10 text-violet-500"
                )}>
                  <Lock className="w-3 h-3" />
                </div>
              )}
            </div>
          )}
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[10px] font-bold text-gray-400 dark:text-white/20 uppercase tracking-widest leading-none">
              {formatSize(file.size_bytes)}
            </span>
            <div className="w-1 h-1 rounded-full bg-gray-300 dark:bg-white/10" />
            <span className={cn("text-[10px] font-bold uppercase tracking-widest leading-none", getLifecycleColor(file))}>
              {file.expired ? '已過期' : file.remaining_days < 0 ? '永久保留' : `剩餘 ${file.remaining_days} 天`}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity pr-2">
          {!isLocked && (
            <div className="flex items-center gap-1">
              {/* Desktop Actions (not rendered on phones, where they are hidden) */}
              {isDesktop && (
              <div className="hidden lg:flex items-center gap-1">
                {isAuthenticated && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onToggleLock('file', file.name, !!file.is_locked); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    className={cn(
                      "p-2 rounded-lg transition-all duration-300",
                      file.is_locked 
                        ? "text-violet-600 bg-violet-600/10 hover:bg-violet-600/20 shadow-md" 
                        : "text-cyan-600 bg-cyan-600/10 hover:bg-cyan-600/20 shadow-sm"
                    )}
                  >
                    {file.is_locked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onShare(file.name); }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                >
                  <Share2 className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onQrCode(file.name);
                  }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="p-2 text-gray-400 hover:text-violet-600 hover:bg-violet-500/5 rounded-lg transition-colors"
                  title="QR Code"
                >
                  <QrCode className="w-4 h-4" />
                </button>
                <a
                  href={`${API_ORIGIN}/api/download/${username}/${file.name}${token ? `?token=${token}` : ''}`}
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onMouseUp={(e) => e.stopPropagation()}
                  onTouchStart={(e) => e.stopPropagation()}
                  onTouchEnd={(e) => e.stopPropagation()}
                  className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                >
                  <Download className="w-4 h-4" />
                </a>
                {isAuthenticated && (
                  <CascadingMenu
                    folders={folders}
                    onSelect={(folderId) => onMoveItem('file', file.name, folderId)}
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
                {isAuthenticated && onRename && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenamingFile(file.name); setNewName(file.name); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    className="p-2 text-gray-400 hover:text-cyan-600 hover:bg-cyan-500/5 rounded-lg transition-colors"
                    title="重命名"
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                )}
                {isAuthenticated && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(file.name); }}
                    onMouseDown={(e) => e.stopPropagation()}
                    onMouseUp={(e) => e.stopPropagation()}
                    onTouchStart={(e) => e.stopPropagation()}
                    onTouchEnd={(e) => e.stopPropagation()}
                    className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-500/5 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              )}

              {/* Mobile Actions Menu */}
              <div className="lg:hidden">
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
      </ItemWrapper>
    );
  }

  // ─── GRID VIEW ───
  return (
    <ItemWrapper
      isDesktop={isDesktop}
      onClick={handleClick}
      onDoubleClick={() => {
        if (!isSelectionMode && isDesktop && !isLocked) {
          onPreview({
            name: file.name,
            size: formatSize(file.size_bytes),
            url: `${API_ORIGIN}/api/download/${username}/${encodeURIComponent(file.name)}${token ? `?token=${token}` : ''}`
          });
        }
      }}
      onLongPress={() => onSelectionModeChange(true)}
      className={cn(
        "relative group flex flex-col bg-white/40 dark:bg-white/5 hover:bg-white/80 dark:hover:bg-white/10 border border-transparent hover:border-cyan-500/30 rounded-2xl transition-all duration-300 cursor-pointer shadow-sm hover:shadow-xl hover:-translate-y-1 file-item h-full",
        isSelected && "ring-2 ring-cyan-500 bg-cyan-50 dark:bg-cyan-900/10",
        isLocked && "opacity-75"
      )}
      draggable={!isSelectionMode}
      onDragStart={(event) => handleDragStart(event as unknown as React.DragEvent<HTMLDivElement>)}
      data-id={`file:${file.name}`}
    >
      {/* Selection Checkbox (top-left) */}
      {!isLocked && (
        <div className={cn(
          "absolute top-2 left-2 z-30 transition-opacity",
          (isSelected || isSelectionMode) 
            ? "opacity-100 pointer-events-auto" 
            : "opacity-0 pointer-events-none lg:group-hover:opacity-100 lg:group-hover:pointer-events-auto"
        )}>
          {/* The button handles its own press: without stopping mouseup/touchend
              the card's long-press handler toggled the selection as well (and
              its touchend preventDefault swallowed the button's click). */}
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect('file', file.name); }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            aria-label={isSelected ? `取消選取 ${file.name}` : `選取 ${file.name}`}
            className="relative tap-target p-1.5 bg-white/90 dark:bg-black/80 rounded-lg shadow-sm flex items-center justify-center"
          >
            {isSelected ? <CheckSquare className="w-4 h-4 text-cyan-600" /> : <Square className="w-4 h-4 text-gray-400" />}
          </button>
        </div>
      )}

      {/* Mobile Action Menu (top-right, lg:hidden) */}
      {!isSelectionMode && (
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
                aria-label={`${file.name} 的操作`}
                // A small translucent circle keeps the thumbnail visible;
                // tap-target adds an invisible 44px touch area around it.
                className="relative tap-target w-8 h-8 rounded-full transition-colors bg-black/35 text-white hover:text-cyan-300 flex items-center justify-center"
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            }
            items={mobileDropdownItems}
          />
        </div>
      )}

      {/* Thumbnail / Icon Area */}
      <div className="relative w-full aspect-4/3 bg-gray-100/50 dark:bg-black/20 flex items-center justify-center overflow-hidden">
        {isDisplayable ? (
          <img
            src={`${API_ORIGIN}/api/thumbnail/${username}/${encodeURIComponent(file.name)}?v=2${token ? `&token=${token}` : ''}`}
            alt={file.name}
            loading="lazy"
            decoding="async"
            width={300}
            height={225}
            className="w-full h-full object-cover"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextElementSibling?.classList.remove('hidden');
            }}
          />
        ) : null}

        <div className={cn(
          "flex items-center justify-center w-full h-full absolute inset-0",
          isDisplayable ? "hidden" : "",
        )}>
          {renderFileIcon(file.name, cn(
            "w-12 h-12",
            isLocked ? "text-gray-300 dark:text-gray-600 blur-sm" : "text-gray-400 dark:text-gray-500"
          ))}
        </div>
        
        {/* Desktop Hover Overlay Actions (not rendered on phones, where it is hidden) */}
        {isDesktop && (
        <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 transition-opacity hidden lg:flex flex-wrap items-end content-end justify-center gap-1.5 pt-10 p-3 z-20 pointer-events-none">
          <button
            onClick={(e) => { e.stopPropagation(); onShare(file.name); }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="p-2 bg-white rounded-full text-gray-700 hover:text-cyan-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
            title="分享"
          >
            <Share2 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onQrCode(file.name);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="p-2 bg-white rounded-full text-gray-700 hover:text-violet-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
            title="QR Code"
          >
            <QrCode className="w-4 h-4" />
          </button>
          <a
            href={`${API_ORIGIN}/api/download/${username}/${file.name}${token ? `?token=${token}` : ''}`}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => e.stopPropagation()}
            className="p-2 bg-white rounded-full text-gray-700 hover:text-green-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
            title="下載"
            download
          >
            <Download className="w-4 h-4" />
          </a>
          {isAuthenticated && (
            <CascadingMenu
              folders={folders}
              onSelect={(folderId) => onMoveItem('file', file.name, folderId)}
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
          {isAuthenticated && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingFile(file.name);
                  setNewName(file.name);
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className="p-2 bg-white rounded-full text-gray-700 hover:text-cyan-600 shadow-lg transition-transform hover:scale-110 pointer-events-auto"
                title="重命名項目"
              >
                <Edit3 className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onToggleLock('file', file.name, !!file.is_locked); }}
                onMouseDown={(e) => e.stopPropagation()}
                onMouseUp={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onTouchEnd={(e) => e.stopPropagation()}
                className={cn(
                  "p-2 bg-white rounded-full shadow-lg transition-transform hover:scale-110 pointer-events-auto",
                  file.is_locked ? "text-violet-600" : "text-gray-700 hover:text-violet-600"
                )}
                title={file.is_locked ? "解除鎖定" : "鎖定項目"}
              >
                {file.is_locked ? <Unlock className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(file.name); }}
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

      {/* File Info for Grid */}
      <div className="p-2 sm:p-3 bg-white/50 dark:bg-white/5 flex-1 flex flex-col justify-between border-t border-white/20 dark:border-white/5">
        <div className="mb-2">
          {renamingFile === file.name ? (
            <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename(file.name);
                  if (e.key === 'Escape') setRenamingFile(null);
                }}
                className="w-full min-h-11 lg:min-h-0 text-sm p-2 rounded-lg border border-cyan-500/50 bg-white dark:bg-black/20 outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => handleRename(file.name)}
                  disabled={isRenaming}
                  className="flex-1 min-h-11 lg:min-h-0 py-1.5 px-3 text-xs font-medium bg-cyan-500 text-white rounded-lg"
                >
                  {isRenaming ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  確認
                </button>
                <button
                  onClick={() => setRenamingFile(null)}
                  disabled={isRenaming}
                  className="flex-1 min-h-11 lg:min-h-0 py-1.5 px-3 text-xs font-medium bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-gray-300 rounded-lg"
                >
                  <X className="w-3 h-3" />
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-xs font-bold text-gray-900 dark:text-white truncate">
                  {file.name}
                </div>
                {file.is_locked && (
                  <Lock className="w-3 h-3 text-violet-500 shrink-0" />
                )}
              </div>
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {formatSize(file.size_bytes)}
              </div>
            </div>
          )}
        </div>
        <div className={cn("text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5", getLifecycleColor(file))}>
          {file.expired ? (
            <><AlertCircle className="w-3 h-3" /> 已過期</>
          ) : file.remaining_days < 0 ? (
            <><Clock className="w-3 h-3" /> 永久保留</>
          ) : (
            <><Clock className="w-3 h-3" /> 剩餘 {file.remaining_days} 天</>
          )}
        </div>
      </div>
    </ItemWrapper>
  );
}, areFileItemPropsEqual);
