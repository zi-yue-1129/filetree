import React from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { 
  Folder as FolderIcon, 
  FolderPlus, 
  Edit3, 
  Trash2,
  ChevronRight,
  ChevronDown,
  Plus,
  X,
  MoreVertical
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { DropdownMenu } from '../ui/DropdownMenu';

export type Folder = {
  id: string;
  name: string;
  type: 'file' | 'url';
  parent_id?: string | null;
  is_locked?: boolean;
};

interface FolderSidebarProps {
  folders: Folder[];
  activeFolderId: string | null;
  activeType: 'file' | 'url';
  isAuthenticated: boolean;
  onSelectFolder: (id: string | null) => void;
  onCreateFolder: (name: string, type: 'file' | 'url', parentId?: string | null) => void;
  onUpdateFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveItem: (type: 'file' | 'url' | 'folder', id: string, folderId: string | null) => void;
  onClose?: () => void;
  isDesktop?: boolean;
}

const FolderTreeItem: React.FC<{
  folder: Folder;
  allFolders: Folder[];
  depth: number;
  activeFolderId: string | null;
  isAuthenticated: boolean;
  isDesktop?: boolean;
  onSelectFolder: (id: string | null) => void;
  onUpdateFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onCreateSubfolder: (parentId: string) => void;
  onMoveItem: (type: 'file' | 'url' | 'folder', id: string, folderId: string | null) => void;
}> = ({ 
  folder, 
  allFolders, 
  depth, 
  activeFolderId, 
  isAuthenticated,
  isDesktop = true,
  onSelectFolder, 
  onUpdateFolder, 
  onDeleteFolder,
  onCreateSubfolder,
  onMoveItem
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editName, setEditName] = React.useState('');
  const [isDragOver, setIsDragOver] = React.useState(false);
  
  const subfolders = allFolders.filter(f => f.parent_id === folder.id);
  const hasSubfolders = subfolders.length > 0;
  const isActive = activeFolderId === folder.id;

  // Defense in depth: limit rendering depth to prevent browser crash
  if (depth > 50) return null;

  const handleUpdate = () => {
    if (editName.trim()) {
      onUpdateFolder(folder.id, editName.trim());
      setEditingId(null);
    }
  };

  /** Open the "new subfolder" form under this folder and expand it. */
  const createSubfolder = (): void => {
    onCreateSubfolder(folder.id);
    setIsExpanded(true);
  };

  /** Switch this row to the inline rename input. */
  const startRename = (): void => {
    setEditingId(folder.id);
    setEditName(folder.name);
  };

  /** Delete this folder (and its content) after confirmation. */
  const confirmDelete = (): void => {
    if (confirm(`確定刪除資料夾「${folder.name}」及其所有內容？`)) onDeleteFolder(folder.id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;

    try {
      const parsed = JSON.parse(data);
      
      // Handle batch items
      if (parsed.items && Array.isArray(parsed.items)) {
        parsed.items.forEach((item: { type: 'file' | 'url' | 'folder', id: string }) => {
          if (item.type === 'folder' && item.id === folder.id) return; // Prevent self-drop
          onMoveItem(item.type, item.id, folder.id);
        });
        setIsExpanded(true);
        return;
      }

      // Handle single item (backward compatibility)
      const { type, id } = parsed;
      if (type && id) {
        if (type === 'folder' && id === folder.id) return; // Prevent self-drop
        onMoveItem(type, id, folder.id);
        setIsExpanded(true); // Open folder on drop
      }
    } catch (err) {
      console.error("Drop error:", err);
    }
  };

  return (
    <div className="space-y-1">
      <div 
        className={cn(
          "group flex items-center gap-2 px-3 py-3 lg:py-1.5 rounded-xl text-sm font-medium transition-all relative cursor-pointer border border-transparent",
          isActive 
            ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400" 
            : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5",
          isDragOver && "bg-cyan-100 dark:bg-cyan-500/20 border-cyan-500 ring-2 ring-cyan-500/30"
        )}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => {
          if (isDesktop) {
            setIsExpanded(!isExpanded);
          } else {
            onSelectFolder(folder.id);
          }
        }}
        onDoubleClick={() => {
          if (isDesktop) {
            onSelectFolder(folder.id);
          }
        }}
        draggable={isDesktop}
        onDragStart={(e) => {
            e.stopPropagation();
            e.dataTransfer.setData('application/json', JSON.stringify({ type: 'folder', id: folder.id }));
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {hasSubfolders ? (
          // tap-target: invisible 44px touch area around the small chevron.
          <div
            role="button"
            aria-label={isExpanded ? `收合 ${folder.name}` : `展開 ${folder.name}`}
            aria-expanded={isExpanded}
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="relative tap-target p-0.5 hover:bg-white/20 rounded-md transition-colors"
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </div>
        ) : (
          <div className="p-0.5">
            <div className="w-3.5" />
          </div>
        )}
        
        <FolderIcon className="w-4 h-4 shrink-0" />
        
        {editingId === folder.id ? (
          <input
            autoFocus
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleUpdate();
              if (e.key === 'Escape') setEditingId(null);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 min-h-11 -my-3 lg:min-h-0 lg:my-0 text-xs p-1 rounded bg-white dark:bg-black/20 border border-cyan-500 outline-none"
          />
        ) : (
          <span className="flex-1 truncate">{folder.name}</span>
        )}

        {isAuthenticated && isDesktop && (
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                createSubfolder();
              }}
              className="p-1 hover:bg-cyan-500/20 text-cyan-500 rounded-md"
              title="新增子資料夾"
            >
              <Plus className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                startRename();
              }}
              className="p-1 hover:bg-white/20 rounded-md"
              title="重新命名"
            >
              <Edit3 className="w-3 h-3" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                confirmDelete();
              }}
              className="p-1 hover:bg-red-500/20 text-red-500 rounded-md"
              title="刪除"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
        {/* Touch screens have no hover: the hover-revealed buttons above were
            invisible yet tappable (a tap near the row's right edge could hit
            rename or delete). Phones get one visible 44px menu button. */}
        {isAuthenticated && !isDesktop && editingId !== folder.id && (
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label={`${folder.name} 的操作`}
                className="min-w-11 min-h-11 -my-3 -mr-2 flex items-center justify-center text-gray-400 hover:text-cyan-600 rounded-lg transition-colors"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            }
            items={[
              { label: '新增子資料夾', icon: <Plus className="w-4 h-4 text-cyan-500" />, onClick: createSubfolder },
              { label: '重新命名', icon: <Edit3 className="w-4 h-4 text-cyan-500" />, onClick: startRename },
              { label: '刪除', icon: <Trash2 className="w-4 h-4" />, onClick: confirmDelete, variant: 'danger' },
            ]}
          />
        )}
      </div>

      <AnimatePresence>
        {isExpanded && hasSubfolders && (
          <m.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            {subfolders.map(sub => (
              <FolderTreeItem 
                key={sub.id}
                folder={sub}
                allFolders={allFolders}
                depth={depth + 1}
                activeFolderId={activeFolderId}
                isAuthenticated={isAuthenticated}
                onSelectFolder={onSelectFolder}
                onUpdateFolder={onUpdateFolder}
                onDeleteFolder={onDeleteFolder}
                onCreateSubfolder={onCreateSubfolder}
                onMoveItem={onMoveItem}
                isDesktop={isDesktop}
              />
            ))}
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const FolderSidebar: React.FC<FolderSidebarProps> = ({
  folders,
  activeFolderId,
  activeType,
  isAuthenticated,
  onSelectFolder,
  onCreateFolder,
  onUpdateFolder,
  onDeleteFolder,
  onMoveItem,
  onClose,
  isDesktop
}) => {
  const [isAdding, setIsAdding] = React.useState<{ active: boolean; parentId: string | null }>({
    active: false,
    parentId: null
  });
  const [newName, setNewName] = React.useState('');
  const [expanded, setExpanded] = React.useState(true);

  const rootFolders = folders.filter(f => f.type === activeType && !f.parent_id);

  const handleCreate = () => {
    if (newName.trim()) {
      onCreateFolder(newName.trim(), activeType, isAdding.parentId);
      setNewName('');
      setIsAdding({ active: false, parentId: null });
    }
  };

  return (
    <div className="w-64 lg:w-48 xl:w-56 flex flex-col h-full bg-white/40 dark:bg-white/5 backdrop-blur-xl border-r border-gray-100 dark:border-white/5 transition-all">
      <div className="p-4 border-b border-gray-100 dark:border-white/5 flex items-center justify-between">
        <button 
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 font-bold text-gray-800 dark:text-gray-200 p-2.5 -ml-2.5 lg:p-2 lg:-ml-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          資料夾
        </button>
        <div className="flex items-center gap-1">
          {isAuthenticated && (
            <button 
              onClick={() => setIsAdding({ active: true, parentId: null })}
              className="min-w-11 min-h-11 lg:min-w-0 lg:min-h-0 flex items-center justify-center p-1.5 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg text-cyan-600 dark:text-cyan-400 transition-colors"
              title="新增根資料夾"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          )}
          {onClose && (
            <button 
              onClick={onClose}
              aria-label="關閉資料夾面板"
              className="min-w-11 min-h-11 flex items-center justify-center p-1.5 lg:hidden hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg text-gray-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
        {/* All Items (Default) */}
        <button
          onClick={() => onSelectFolder(null)}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-3 lg:py-2 rounded-xl text-sm font-medium transition-all mb-2",
            activeFolderId === null 
              ? "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400" 
              : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5"
          )}
        >
          <FolderIcon className="w-4 h-4" />
          <span>所有項目</span>
        </button>

        <AnimatePresence>
          {expanded && rootFolders.map((folder) => (
            <FolderTreeItem 
              key={folder.id}
              folder={folder}
              allFolders={folders}
              depth={0}
              activeFolderId={activeFolderId}
              isAuthenticated={isAuthenticated}
              onSelectFolder={onSelectFolder}
              onUpdateFolder={onUpdateFolder}
              onDeleteFolder={onDeleteFolder}
              onCreateSubfolder={(parentId) => setIsAdding({ active: true, parentId })}
              onMoveItem={onMoveItem}
              isDesktop={isDesktop}
            />
          ))}
        </AnimatePresence>

        {isAdding.active && (
          <m.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-2 space-y-2 border border-cyan-500/30 rounded-xl bg-cyan-500/5 mt-2"
          >
            <div className="text-[10px] text-cyan-600 dark:text-cyan-400 px-1 font-medium">
              {isAdding.parentId ? "新增子資料夾" : "新增根資料夾"}
            </div>
            <input
              autoFocus
              placeholder="名稱..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              className="w-full min-h-11 lg:min-h-0 text-xs p-2 rounded-lg bg-white dark:bg-black/20 border-none outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <div className="flex gap-1">
              <button 
                onClick={handleCreate}
                className="flex-1 min-h-11 lg:min-h-0 py-1 text-[10px] font-bold bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors"
              >
                新增
              </button>
              <button 
                onClick={() => setIsAdding({ active: false, parentId: null })}
                className="min-w-11 min-h-11 lg:min-w-0 lg:min-h-0 px-2 py-1 text-[10px] font-bold bg-gray-200 dark:bg-white/10 rounded-lg"
              >
                取消
              </button>
            </div>
          </m.div>
        )}
      </div>
    </div>
  );
};
