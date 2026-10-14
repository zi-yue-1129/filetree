import React, { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { m, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, Folder as FolderIcon, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import type { Folder } from '../dashboard/FolderSidebar';

interface CascadingMenuProps {
  folders: Folder[];
  onSelect: (folderId: string | null) => void;
  trigger?: React.ReactNode;
  disabled?: boolean;
  placement?: 'top' | 'bottom';
}

interface FolderNode extends Folder {
  children: FolderNode[];
}

const buildFolderTree = (folders: Folder[]): FolderNode[] => {
  const folderMap = new Map<string, FolderNode>();
  const rootNodes: FolderNode[] = [];

  // Initialize nodes
  folders.forEach(f => {
    folderMap.set(f.id, { ...f, children: [] });
  });

  // Build tree
  folders.forEach(f => {
    const node = folderMap.get(f.id)!;
    if (f.parent_id && folderMap.has(f.parent_id)) {
      folderMap.get(f.parent_id)!.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  return rootNodes;
};

const MenuItem: React.FC<{
  node: FolderNode;
  onSelect: (id: string) => void;
  depth?: number;
}> = ({ node, onSelect, depth = 0 }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const itemRef = useRef<HTMLButtonElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hasChildren = node.children && node.children.length > 0;

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      const submenuWidth = 192; // w-48
      const windowWidth = window.innerWidth;
      
      // Check if there's enough space on the right
      const flushRight = rect.right + submenuWidth + 10 > windowWidth;

      setPosition({
        top: rect.top,
        left: flushRight ? rect.left - submenuWidth - 4 : rect.right + 4,
      });
    }
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsHovered(false);
    }, 150); // Grace period
  };

  return (
    <div
      className="relative px-1"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={itemRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
        className={cn(
          "w-full flex items-center justify-between px-3 py-2 text-sm rounded-lg transition-colors text-left",
          isHovered ? "bg-cyan-500 text-white" : "text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10"
        )}
      >
        <div className="flex items-center gap-2 truncate">
          <FolderIcon className={cn("w-4 h-4", isHovered ? "text-white" : "text-cyan-500")} />
          <span className="truncate">{node.name}</span>
        </div>
        {hasChildren && <ChevronRight className={cn("w-3 h-3", isHovered ? "text-white" : "text-gray-400")} />}
      </button>

      {/* Submenu Portal */}
      {hasChildren && isHovered && createPortal(
        <AnimatePresence>
          <m.div
            initial={{ opacity: 0, x: -5, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -5, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="fixed w-48 bg-white/95 dark:bg-space-black/95 backdrop-blur-xl border border-white/20 dark:border-white/10 rounded-xl shadow-xl py-1 z-[10002] max-h-64 overflow-y-auto custom-scrollbar"
            style={{
              top: position.top,
              left: position.left,
            }}
            onMouseEnter={() => {
              if (timeoutRef.current) clearTimeout(timeoutRef.current);
            }}
            onMouseLeave={handleMouseLeave}
          >
            {node.children.map(child => (
              <MenuItem key={child.id} node={child} onSelect={onSelect} depth={depth + 1} />
            ))}
          </m.div>
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

const MobileDrillDownMenu: React.FC<CascadingMenuProps> = ({ folders, onSelect, trigger, disabled }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [history, setHistory] = useState<FolderNode[]>([]);
  const rootNodes = useMemo(() => buildFolderTree(folders), [folders]);

  const currentFolder = history.length > 0 ? history[history.length - 1] : null;
  const currentNodes = currentFolder ? currentFolder.children : rootNodes;

  const handleBack = () => {
    setHistory(prev => prev.slice(0, -1));
  };

  const handleMoveHere = () => {
    onSelect(currentFolder ? currentFolder.id : null); // null = root
    setIsOpen(false);
  };

  return (
    <>
      <div 
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setIsOpen(true);
        }}
        className="cursor-pointer"
      >
        {trigger || (
          <button
            type="button"
            disabled={disabled}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-white/50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg hover:bg-white/80 dark:hover:bg-white/10 transition-colors"
          >
            <span>移動至...</span>
            <ChevronRight className="w-3 h-3 rotate-90" />
          </button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-10001 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
              onClick={() => {
                setIsOpen(false);
                setHistory([]);
              }}
            >
              <m.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", damping: 25, stiffness: 200 }}
                className="w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden h-[80vh] flex flex-col"
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-white/10 shrink-0">
                  <div className="flex items-center gap-2">
                    {history.length > 0 && (
                      <button
                        onClick={handleBack}
                        className="min-w-11 min-h-11 -my-2 -ml-3 flex items-center justify-center text-gray-500 rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                    )}
                    <h3 className="font-bold text-gray-800 dark:text-white truncate max-w-[200px]">
                      {currentFolder ? currentFolder.name : "移動至..."}
                    </h3>
                  </div>
                  <button
                    onClick={() => {
                        setIsOpen(false);
                        setHistory([]);
                    }}
                    className="min-w-11 min-h-11 -my-2 -mr-3 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-full hover:bg-gray-100 dark:hover:bg-white/10"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                  {currentNodes.length > 0 ? (
                    currentNodes.map(node => (
                      <button
                        key={node.id}
                        onClick={() => {
                          setHistory(prev => [...prev, node]);
                        }}
                        className="w-full flex items-center justify-between px-4 py-3 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/5 rounded-xl active:scale-[0.98] transition-all text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-cyan-500/10 rounded-lg text-cyan-500">
                            <FolderIcon className="w-5 h-5" />
                          </div>
                          <span className="font-medium text-gray-700 dark:text-gray-200 truncate">{node.name}</span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </button>
                    ))
                  ) : (
                    <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-2">
                        <FolderIcon className="w-8 h-8 opacity-20" />
                        <span className="text-sm">此資料夾為空</span>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 dark:border-white/10 bg-gray-50 dark:bg-white/5 shrink-0">
                  <button
                    onClick={handleMoveHere}
                    className="w-full py-3 bg-cyan-500 hover:bg-cyan-600 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                  >
                    <FolderIcon className="w-4 h-4" />
                    <span>移動至此 ({currentFolder ? currentFolder.name : "根目錄"})</span>
                  </button>
                </div>

              </m.div>
            </m.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
};

const DesktopCascadingMenu: React.FC<CascadingMenuProps> = ({ folders, onSelect, trigger, disabled, placement = 'bottom' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0, right: 0, isRight: false });
  const menuRef = useRef<HTMLDivElement>(null);
  const rootNodes = useMemo(() => buildFolderTree(folders), [folders]);

  useLayoutEffect(() => {
    if (isOpen && menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const isRight = rect.left > window.innerWidth / 2;
      setCoords({
        top: placement === 'top' ? rect.top : rect.bottom,
        left: rect.left,
        right: window.innerWidth - rect.right,
        isRight
      });
    }
  }, [isOpen, placement]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (id: string | null) => {
    onSelect(id);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      <div 
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setIsOpen(!isOpen);
        }}
        className="cursor-pointer"
      >
        {trigger || (
          <button
            type="button"
            disabled={disabled}
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium bg-white/50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg hover:bg-white/80 dark:hover:bg-white/10 transition-colors"
          >
            <span>移動至...</span>
            <ChevronRight className={cn("w-3 h-3 transition-transform", isOpen ? "rotate-90" : "")} />
          </button>
        )}
      </div>

      {createPortal(
        <AnimatePresence>
          {isOpen && (
            <m.div
              initial={{ 
                opacity: 0, 
                y: placement === 'top' ? -5 : 5, 
                scale: 0.95 
              }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ 
                opacity: 0, 
                y: placement === 'top' ? -5 : 5, 
                scale: 0.95 
              }}
              transition={{ duration: 0.15 }}
              className={cn(
                  "fixed w-56 bg-white/95 dark:bg-space-black/95 backdrop-blur-2xl border border-white/20 dark:border-white/10 rounded-xl shadow-2xl py-2 z-10001 ring-1 ring-black/5",
              )}
              style={{
                  top: placement === 'top' ? coords.top - 8 : coords.top + 8,
                  left: coords.isRight ? 'auto' : coords.left,
                  right: coords.isRight ? coords.right : 'auto',
                  transform: placement === 'top' ? 'translateY(-100%)' : 'none'
              }}
            >
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar p-1">
                <button
                  onClick={() => handleSelect(null)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-cyan-500 hover:text-white rounded-lg transition-colors text-left"
                >
                  <FolderIcon className="w-4 h-4" />
                  <span>根目錄</span>
                </button>
                
                <div className="my-1 h-px bg-gray-200 dark:bg-white/10 mx-2" />

                {rootNodes.length > 0 ? (
                  rootNodes.map(node => (
                    <MenuItem key={node.id} node={node} onSelect={handleSelect} />
                  ))
                ) : (
                  <div className="px-4 py-2 text-xs text-gray-400 text-center">
                    沒有其他資料夾
                  </div>
                )}
              </div>
            </m.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};

export const CascadingMenu: React.FC<CascadingMenuProps> = (props) => {
  const [isDesktop, setIsDesktop] = useState(true);

  useEffect(() => {
    const checkMedia = () => {
      setIsDesktop(window.matchMedia('(min-width: 768px)').matches);
    };
    
    checkMedia();
    window.addEventListener('resize', checkMedia);
    return () => window.removeEventListener('resize', checkMedia);
  }, []);

  if (!isDesktop) {
    return <MobileDrillDownMenu {...props} />;
  }

  return <DesktopCascadingMenu {...props} />;
};
