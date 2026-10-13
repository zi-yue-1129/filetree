import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { SecurityInitializationModal } from '../components/SecurityInitializationModal';
import { X } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '../lib/utils';
import { apiRequest, apiPostForm, apiUrl, API_ORIGIN } from '../services/api';
import { FilePreviewModal } from '../components/FilePreviewModal';
import { FileView } from '../components/dashboard/FileView';
import { UrlView } from '../components/dashboard/UrlView';
import { FolderSidebar } from '../components/dashboard/FolderSidebar';
import { BatchActionBar } from '../components/dashboard/BatchActionBar';
import { useUserDashboard } from '../hooks/useUserDashboard';
import { useSelection } from '../hooks/useSelection';
import { UserPageHeader } from '../components/user-page/UserPageHeader';
import { UserPageToolbar } from '../components/user-page/UserPageToolbar';
import { BreadcrumbsBar } from '../components/user-page/BreadcrumbsBar';
import type { Folder, UserDashboardData } from '../types/dashboard';

interface UserPageProps {
  data: UserDashboardData;
}

export const UserPage: React.FC<UserPageProps> = ({ 
  data: initialData 
}) => {
  const {
    dashboardData,
    setDashboardData,
    isAuthenticated,
    setIsAuthenticated,
    refreshDashboard,
    isBatchSyncing,
    setIsBatchSyncing,
    password,
    setPassword,
    token, // from auth context
    login,
    logout
  } = useUserDashboard(initialData);

  const {
    selectedItems,
    setSelectedItems,
    isSelectionMode,
    setIsSelectionMode,
    toggleSelectItem,
    handleSelectAll,
    handleBatchSelect
  } = useSelection();

  // Local UI State
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<{ name: string, size: string, url: string } | null>(null);
  const [showForcedPasswordChange, setShowForcedPasswordChange] = useState(false);
  const [isPacking, setIsPacking] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeTab, setActiveTab] = useState<'files' | 'urls'>('files');
  const [activeFileFolderId, setActiveFileFolderId] = useState<string | null>(null);
  const [activeUrlFolderId, setActiveUrlFolderId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);

  // Responsive check
  useEffect(() => {
    const checkDesktop = () => {
      const isLg = window.matchMedia('(min-width: 1024px)').matches;
      setIsDesktop(isLg);
      if (!isLg) setIsSidebarOpen(false);
    };
    checkDesktop();
    window.addEventListener('resize', checkDesktop);
    return () => window.removeEventListener('resize', checkDesktop);
  }, []);

  const filteredFiles = useMemo(() => {
    if (activeFileFolderId === null) return dashboardData.files || [];
    return (dashboardData.files || []).filter(f => f.folder_id === activeFileFolderId);
  }, [dashboardData.files, activeFileFolderId]);

  const filteredUrls = useMemo(() => {
    if (activeUrlFolderId === null) return dashboardData.urls || [];
    return (dashboardData.urls || []).filter(u => u.folder_id === activeUrlFolderId);
  }, [dashboardData.urls, activeUrlFolderId]);

  const getBreadcrumbs = React.useCallback((folderId: string | null) => {
    if (!folderId) return [];
    const crumbs: Folder[] = [];
    let currentId: string | null = folderId;
    while (currentId) {
      const folder = dashboardData.folders?.find(f => f.id === currentId);
      if (folder) {
        crumbs.unshift(folder);
        currentId = folder.parent_id || null;
      } else {
        currentId = null;
      }
    }
    return crumbs;
  }, [dashboardData.folders]);

  // Sync state with URL query parameters
  useEffect(() => {
    const tab = searchParams.get('tab');
    if (tab === 'file') setActiveTab('files');
    else if (tab === 'url') setActiveTab('urls');

    const folderId = searchParams.get('folder');
    if (activeTab === 'files') {
      setActiveFileFolderId(folderId);
    } else {
      setActiveUrlFolderId(folderId);
    }
  }, [searchParams, activeTab]);

  const updateUrl = (tab: 'files' | 'urls', folderId: string | null) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('tab', tab === 'files' ? 'file' : 'url');
    if (folderId) {
      newParams.set('folder', folderId);
    } else {
      newParams.delete('folder');
    }
    setSearchParams(newParams);
  };

  const handleTabChange = (tab: 'files' | 'urls') => {
    setActiveTab(tab);
    const folderId = tab === 'files' ? activeFileFolderId : activeUrlFolderId;
    updateUrl(tab, folderId);
  };

  const handleFolderNavigation = (type: 'file' | 'url', folderId: string | null) => {
    if (type === 'file') {
      setActiveFileFolderId(folderId);
      updateUrl('files', folderId);
    } else {
      setActiveUrlFolderId(folderId);
      updateUrl('urls', folderId);
    }
  };

  // --- Actions ---

  const handleUnlock = async (pwd: string) => {
    try {
      const formData = new FormData();
      formData.append('password', pwd);
      
      const result = await apiPostForm(`/user/${dashboardData.user?.username}/unlock`, formData);
      if (result.token) {
        setIsAuthenticated(true);
        if (dashboardData.user?.username) {
          sessionStorage.setItem(`unlocked_${dashboardData.user.username}`, 'true');
        }
        setPassword(pwd);
        login(result, result.token);
        await refreshDashboard(result.token);
        setShowAuthModal(false);
      } else {
        alert("密碼錯誤");
      }
    } catch (err: unknown) {
      const error = err as Error;
      console.error(error);
      alert(error.message || "驗證失敗");
    }
  };

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    handleUnlock(password);
  };

  const handleMoveItem = async (type: 'file' | 'url' | 'folder', id: string, folderId: string | null) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    try {
      const formData = new FormData();
      formData.append('item_type', type);
      formData.append('item_id', id);
      if (folderId) formData.append('folder_id', folderId);
      if (token) formData.append('token', token);
      else formData.append('password', password);

      await apiPostForm(`/user/${dashboardData.user?.username}/move-item`, formData, token);
      
      // Optimistic update
      setDashboardData(prev => {
        if (type === 'file') {
          return {
            ...prev,
            files: prev.files?.map(f => f.name === id ? { ...f, folder_id: folderId } : f)
          };
        } else if (type === 'url') {
          return {
            ...prev,
            urls: prev.urls?.map(u => u.url === id ? { ...u, folder_id: folderId } : u)
          };
        } else if (type === 'folder') {
          return {
            ...prev,
            folders: prev.folders?.map(f => f.id === id ? { ...f, parent_id: folderId } : f)
          };
        }
        return prev;
      });
    } catch (err: unknown) {
        const error = err as Error;
        console.error(error);
        alert(error.message || "移動失敗");
        await refreshDashboard();
    }
  };

  const handleBatchAction = async (action: 'lock' | 'unlock' | 'delete' | 'download' | 'move', folderId?: string | null) => {
    if (selectedItems.length === 0) return;

    if (action === 'move') {
      if (folderId === undefined) return;
      setIsBatchSyncing(true);
      try {
        await Promise.all(selectedItems.map(item => handleMoveItem(item.type, item.id, folderId)));
        setSelectedItems([]);
      } finally {
        setIsBatchSyncing(false);
      }
      return;
    }

    if (action !== 'download' && !isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    if (action === 'delete' && !confirm(`確定要批次刪除選中的 ${selectedItems.length} 個項目嗎？此操作不可恢復！`)) {
      return;
    }

    setIsBatchSyncing(true);
    try {
      const files = selectedItems.filter(i => i.type === 'file').map(i => i.id);
      const urls = selectedItems.filter(i => i.type === 'url').map(i => i.id);

      if (action === 'download') {
        if (files.length === 0) {
          alert("請選擇要下載的檔案（連結不支援打包下載）");
          setIsBatchSyncing(false);
          return;
        }

        const formData = new FormData();
        if (isAuthenticated) {
            if (token) formData.append('token', token);
            else if (password) formData.append('password', password);
        }
        files.forEach(f => formData.append('filenames', f));

        setIsPacking(true);
        try {
          const res = await fetch(apiUrl(`${API_ORIGIN}/api/user/${dashboardData.user?.username}/batch-download`), {
            method: 'POST',
            body: formData
          });

          if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            a.download = `${dashboardData.user?.username}_files_${timestamp}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            setSelectedItems([]);
          } else {
            const err = await res.json();
            alert(err.detail || "打包下載失敗");
          }
        } catch (downloadErr) {
            console.error("Batch download failed:", downloadErr);
            alert("網路錯誤或下載失敗");
        }
        setIsPacking(false);
        setIsBatchSyncing(false);
        return;
      }

      const perform = async (type: 'file' | 'url', ids: string[]) => {
        if (ids.length === 0) return;
        return apiRequest(`/user/${dashboardData.user?.username}/batch-action`, {
          method: 'POST',
          token,
          body: JSON.stringify({
            password: !token ? password : undefined,
            token,
            item_type: type,
            item_ids: ids,
            action
          })
        });
      };

      const performFolders = async (ids: string[]) => {
        if (ids.length === 0) return;
        await Promise.all(ids.map(id => {
          const formData = new FormData();
          if (token) formData.append('token', token);
          else formData.append('password', password);
          return apiPostForm(`/user/${dashboardData.user?.username}/folders/${id}/delete`, formData);
        }));
      };

      // Optimistic UI Update for delete
      if (action === 'delete') {
        const folders = selectedItems.filter(i => i.type === 'folder').map(i => i.id);
        const folderSet = new Set(folders);

        setDashboardData(prev => ({
          ...prev,
          files: prev.files?.filter(f => !files.includes(f.name)),
          urls: prev.urls?.filter(u => !urls.includes(u.url)),
          folders: prev.folders?.filter(f => !folderSet.has(f.id))
        }));
      }
      setSelectedItems([]);

      await Promise.all([
        perform('file', files), 
        perform('url', urls),
        action === 'delete' ? performFolders(selectedItems.filter(i => i.type === 'folder').map(i => i.id)) : Promise.resolve()
      ]);
      await refreshDashboard();
    } catch (err: unknown) {
        const error = err as Error;
        console.error(error);
        alert("批次操作失敗，正在重新載入資料。");
    } finally {
      setIsBatchSyncing(false);
    }
  };

  const toggleItemLock = async (type: 'file' | 'url' | 'folder', itemId: string, currentStatus: boolean) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    const newLockStatus = !currentStatus;
    if (type === 'file') {
      setDashboardData(prev => ({
        ...prev,
        files: prev.files?.map(f => f.name === itemId ? { ...f, is_locked: newLockStatus } : f)
      }));
    } else if (type === 'url') {
      setDashboardData(prev => ({
        ...prev,
        urls: prev.urls?.map(u => u.url === itemId ? { ...u, is_locked: newLockStatus } : u)
      }));
    } else if (type === 'folder') {
      setDashboardData(prev => ({
        ...prev,
        folders: prev.folders?.map(f => f.id === itemId ? { ...f, is_locked: newLockStatus } : f)
      }));
    }

    try {
      const formData = new FormData();
      formData.append('item_type', type);
      formData.append('item_id', itemId);
      formData.append('is_locked', String(newLockStatus));
      if (token) formData.append('token', token);
      else if (password) formData.append('password', password);

      await apiPostForm(`/user/${dashboardData.user?.username}/toggle-lock`, formData, token);
    } catch (err: unknown) {
        const error = err as Error;
        console.error(error);
        alert("更新鎖定狀態失敗。");
        await refreshDashboard();
    }
  };

  const handleDelete = async (filename: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!confirm(`確定要移除「${filename}」嗎？`)) return;

    setDashboardData(prev => ({
      ...prev,
      files: prev.files?.filter(f => f.name !== filename)
    }));

    try {
      await apiRequest(`/user/${dashboardData.user?.username}/batch-action`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          password: !token ? password : undefined,
          token,
          item_type: 'file',
          item_ids: [filename],
          action: 'delete'
        })
      });
    } catch (err) {
      console.error(err);
      alert('移除失敗，正在重新載入資料');
      await refreshDashboard();
    }
  };

  const handleUrlDelete = async (url: string) => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }
    if (!confirm(`確定要移除「${url}」嗎？`)) return;

    setDashboardData(prev => ({
      ...prev,
      urls: prev.urls?.filter(u => u.url !== url)
    }));

    try {
      await apiRequest(`/user/${dashboardData.user?.username}/batch-action`, {
        method: 'POST',
        token,
        body: JSON.stringify({
          password: !token ? password : undefined,
          token,
          item_type: 'url',
          item_ids: [url],
          action: 'delete'
        })
      });
    } catch (err) {
      console.error(err);
      alert('移除失敗，正在重新載入資料');
      await refreshDashboard();
    }
  };

  const handleRename = async (oldName: string, newName: string): Promise<boolean> => {
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return false;
    }

    try {
      const formData = new FormData();
      if (token) formData.append('token', token);
      else formData.append('password', password);
      formData.append('old_name', oldName);
      formData.append('new_name', newName);

      await apiPostForm(`/user/${dashboardData.user?.username}/rename-file`, formData);
      
      setDashboardData(prev => ({
        ...prev,
        files: prev.files?.map(f => f.name === oldName ? { ...f, name: newName } : f)
      }));
      return true;
    } catch (e: unknown) {
        const error = e as Error;
        console.error(error);
        alert(error.message || "重新命名失敗");
        return false;
    }
  };

  const handleCreateFolder = async (name: string, type: 'file' | 'url', parentId?: string | null) => {
    if (!isAuthenticated) return;
    try {
      const formData = new FormData();
      formData.append('name', name);
      formData.append('folder_type', type);
      if (token) formData.append('token', token);
      else formData.append('password', password);
      if (parentId) formData.append('parent_id', parentId);

      await apiPostForm(`/user/${dashboardData.user?.username}/folders`, formData, token);
      await refreshDashboard();
    } catch (err: unknown) {
        const error = err as Error;
        console.error(error);
        alert(error.message || "建立資料夾失敗");
    }
  };

  const handleUpdateFolder = async (id: string, name: string) => {
    if (!isAuthenticated) return;
    try {
      const formData = new FormData();
      formData.append('name', name);
      if (token) formData.append('token', token);
      else formData.append('password', password);

      await apiPostForm(`/user/${dashboardData.user?.username}/folders/${id}/update`, formData, token);
      await refreshDashboard();
    } catch (err: unknown) {
        const error = err as Error;
        console.error(error);
        alert(error.message || "更新資料夾失敗");
    }
  };

  const handleDeleteFolder = async (id: string) => {
    if (!isAuthenticated) return;
    try {
      const formData = new FormData();
      if (token) formData.append('token', token);
      else formData.append('password', password);

      await apiPostForm(`/user/${dashboardData.user?.username}/folders/${id}/delete`, formData, token);
      if (activeFileFolderId === id) setActiveFileFolderId(null);
      if (activeUrlFolderId === id) setActiveUrlFolderId(null);
      await refreshDashboard();
    } catch (err: unknown) {
        const error = err as Error;
        console.error(error);
        alert(error.message || "刪除資料夾失敗");
    }
  };

  const handleUpdateProfile = async (showInList: boolean) => {
    if (!isAuthenticated) return;
    try {
      const formData = new FormData();
      formData.append('username', dashboardData.user?.username || '');
      if (token) formData.append('token', token);
      else formData.append('password', password);
      formData.append('show_in_list', String(showInList));

      await apiPostForm(`/user/update-profile`, formData, token);

      setDashboardData(prev => ({
        ...prev,
        user: { ...prev.user!, show_in_list: showInList }
      }));
    } catch (err: unknown) {
        const error = err as Error;
        alert(error.message || '更新失敗');
    }
  };

  const handleShare = async (filename: string) => {
    try {
      const formData = new FormData();
      if (token) formData.append('token', token);
      else if (password) formData.append('password', password);

      const supportsClipboardItem = typeof ClipboardItem !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function';

      let copySuccess = false;
      let shareUrlResult: string | null = null;

      if (supportsClipboardItem) {
        const textPromise = (async () => {
          const result = await apiPostForm(`/share/${dashboardData.user?.username}/${encodeURIComponent(filename)}`, formData);
          shareUrlResult = `${window.location.origin}/share/${result.token}`;
          return new Blob([shareUrlResult], { type: 'text/plain' });
        })();

        try {
          await navigator.clipboard.write([
            new ClipboardItem({ 'text/plain': textPromise })
          ]);
          copySuccess = true;
        } catch (clipboardErr) {
            console.log('ClipboardItem write failed:', clipboardErr);
            if (shareUrlResult) {
                copySuccess = false;
            } else {
                const result = await apiPostForm(`/share/${dashboardData.user?.username}/${encodeURIComponent(filename)}`, formData);
                shareUrlResult = `${window.location.origin}/share/${result.token}`;
            }
        }
      } else {
        const result = await apiPostForm(`/share/${dashboardData.user?.username}/${encodeURIComponent(filename)}`, formData);
        shareUrlResult = `${window.location.origin}/share/${result.token}`;

        if (navigator.clipboard && navigator.clipboard.writeText) {
          try {
            await navigator.clipboard.writeText(shareUrlResult);
            copySuccess = true;
          } catch {
            console.log('Async clipboard failed, trying fallback');
          }
        }
      }

      if (!copySuccess && shareUrlResult) {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = shareUrlResult;
          textarea.style.position = 'fixed';
          textarea.style.left = '0';
          textarea.style.top = '0';
          textarea.style.opacity = '0';
          textarea.setAttribute('readonly', '');
          document.body.appendChild(textarea);
          textarea.focus();
          textarea.select();
          copySuccess = document.execCommand('copy');
          document.body.removeChild(textarea);
        } catch {
          console.log('Fallback clipboard also failed');
        }
      }

      if (copySuccess) {
        alert('分享連結已複製到剪貼簿！');
      } else if (shareUrlResult) {
        setShareUrl(shareUrlResult);
      } else {
        alert('分享功能發生錯誤，請稍後再試。');
      }
    } catch (err) {
      console.error(err);
      alert('分享功能發生錯誤，請稍後再試。');
    }
  };

  const handleSelectAllAction = () => {
    const isAll = activeTab === 'files' 
        ? (filteredFiles.length > 0 && selectedItems.filter(i => i.type === 'file').length === filteredFiles.length)
        : (filteredUrls.length > 0 && selectedItems.filter(i => i.type === 'url').length === filteredUrls.length);
    
    if (activeTab === 'files') {
        const selectableFiles = dashboardData.files
          ?.filter(f => !f.is_locked || isAuthenticated)
          .map(f => ({ type: 'file' as const, id: f.name })) || [];
        
        const currentFolders = dashboardData.folders
          ?.filter(f => f.parent_id === activeFileFolderId && f.type === 'file')
          .map(f => ({ type: 'folder' as const, id: f.id })) || [];
        
        handleSelectAll([...selectableFiles, ...currentFolders], !isAll);
    } else {
        const selectableUrls = dashboardData.urls
          ?.filter(u => !u.is_locked || isAuthenticated)
          .map(u => ({ type: 'url' as const, id: u.url })) || [];

        const currentFolders = dashboardData.folders
            ?.filter(f => f.parent_id === activeUrlFolderId && f.type === 'url')
            .map(f => ({ type: 'folder' as const, id: f.id })) || [];
            
        handleSelectAll([...selectableUrls, ...currentFolders], !isAll);
    }
  };

  const isAllSelected = activeTab === 'files' 
    ? (filteredFiles.length > 0 && selectedItems.filter(i => i.type === 'file').length === filteredFiles.length)
    : (filteredUrls.length > 0 && selectedItems.filter(i => i.type === 'url').length === filteredUrls.length);

  return (
    <div className="h-full flex flex-col relative text-gray-900 dark:text-gray-100 font-sans selection:bg-cyan-500/30">
      
      <div className="absolute inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute -top-[20%] -right-[10%] w-[70vw] h-[70vw] bg-radial-gradient from-quantum-cyan/10 to-transparent blur-[5rem] opacity-60 dark:opacity-40 animate-pulse-slow" />
        <div className="absolute -bottom-[20%] -left-[10%] w-[60vw] h-[60vw] bg-radial-gradient from-neural-violet/10 to-transparent blur-[5rem] opacity-60 dark:opacity-40 animate-pulse-slow delay-1000" />
        <div className="absolute inset-0 bg-linear-to-br from-indigo-500/5 via-purple-500/5 to-pink-500/5 pointer-events-none" />
      </div>

      <UserPageHeader
        user={dashboardData.user}
        usage={dashboardData.usage}
        isAuthenticated={isAuthenticated}
        onLogout={() => {
            logout();
            setIsAuthenticated(false);
            refreshDashboard(null);
        }}
        onShowAuth={() => setShowAuthModal(true)}
        onShowSettings={() => setShowSettingsModal(true)}
      />

      <UserPageToolbar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        selectedItems={selectedItems}
        isAuthenticated={isAuthenticated}
        isBatchSyncing={isBatchSyncing}
        onBatchAction={handleBatchAction}
        folders={dashboardData.folders}
        itemCount={activeTab === 'files' ? filteredFiles.length : filteredUrls.length}
        allItemsSelected={isAllSelected}
        onSelectAll={handleSelectAllAction}
      />

      <main className="flex-1 min-h-0 px-1 pb-1 lg:px-6 lg:pb-6 relative z-10 overflow-hidden flex gap-1 lg:gap-4">
        <div className="relative flex">
          <AnimatePresence mode="wait">
            {isSidebarOpen && (
              <>
                {!isDesktop && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 bg-black/50 z-30 lg:hidden"
                  />
                )}
                <motion.div
                  initial={{ width: 0, opacity: 0, x: -20 }}
                  animate={{ width: "auto", opacity: 1, x: 0 }}
                  exit={{ width: 0, opacity: 0, x: -20 }}
                  className={cn(
                    "overflow-hidden bg-white/80 dark:bg-space-deep/90 backdrop-blur-xl border-r border-white/10 h-full",
                    "lg:relative",
                    "absolute top-0 left-0 z-40 h-full shadow-2xl"
                  )}
                >
                  <FolderSidebar
                    folders={dashboardData.folders || []}
                    activeFolderId={activeTab === 'files' ? activeFileFolderId : activeUrlFolderId}
                    activeType={activeTab === 'files' ? 'file' : 'url'}
                    isAuthenticated={isAuthenticated}
                    isDesktop={isDesktop}
                    onSelectFolder={(id) => {
                       handleFolderNavigation(activeTab === 'files' ? 'file' : 'url', id);
                       if (!isDesktop) setIsSidebarOpen(false);
                    }}
                    onCreateFolder={handleCreateFolder}
                    onUpdateFolder={handleUpdateFolder}
                    onDeleteFolder={handleDeleteFolder}
                    onMoveItem={handleMoveItem}
                    onClose={() => setIsSidebarOpen(false)}
                  />
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence mode="wait">
          {activeTab === 'files' ? (
            <motion.div
              key="files"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="flex-1 min-w-0 h-full flex flex-col gap-2 sm:gap-4"
            >
              <BreadcrumbsBar
                breadcrumbs={getBreadcrumbs(activeFileFolderId)}
                activeFolderId={activeFileFolderId}
                onNavigate={(id) => handleFolderNavigation('file', id)}
                onSidebarToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                isSelectionMode={isSelectionMode}
                onSelectionModeChange={setIsSelectionMode}
                selectedItems={selectedItems}
                itemCount={filteredFiles.length}
                filteredCount={filteredFiles.length}
                onSelectAll={handleSelectAllAction}
                onClearSelection={() => { setIsSelectionMode(false); setSelectedItems([]); }}
                activeTab="files"
              />

              <FileView
                files={filteredFiles}
                isAuthenticated={isAuthenticated}
                selectedItems={selectedItems.filter(i => i.type === 'file' || i.type === 'folder')}
                onToggleSelect={(type, id) => toggleSelectItem(type, id)}
                onBatchSelect={handleBatchSelect}
                onToggleLock={(type, id, status) => toggleItemLock(type, id, !!status)}
                onRename={handleRename}
                onDelete={handleDelete}
                onShare={handleShare}
                onQrCode={(filename) => {
                  const url = `${window.location.origin}/${dashboardData.user?.username}/file/${encodeURIComponent(filename)}`;
                  setQrUrl(url);
                }}
                onPreview={(file) => setPreviewFile(file)}
                username={dashboardData.user?.username || ""}
                token={token}
                folders={dashboardData.folders?.filter(f => f.type === 'file') || []}
                activeFolderId={activeFileFolderId}
                onMoveItem={handleMoveItem}
                onFolderClick={(id) => handleFolderNavigation('file', id)}
                onUpdateFolder={handleUpdateFolder}
                onDeleteFolder={handleDeleteFolder}
                viewMode={viewMode}
                isSelectionMode={isSelectionMode}
                onSelectionModeChange={setIsSelectionMode}
                onShareFolder={(folderId) => {
                  const url = `${window.location.origin}/${dashboardData.user?.username}?tab=file&folder=${folderId}`;
                  navigator.clipboard?.writeText(url).then(() => alert('資料夾連結已複製！'));
                }}
                onQrCodeFolder={(folderId) => {
                  const url = `${window.location.origin}/${dashboardData.user?.username}?tab=file&folder=${folderId}`;
                  setQrUrl(url);
                }}
                onDownloadFolder={(folderId) => {
                  const hasFiles = (fId: string): boolean => {
                     const directFiles = dashboardData.files?.some(f => f.folder_id === fId);
                     if (directFiles) return true;
                     const subfolders = dashboardData.folders?.filter(f => f.parent_id === fId) || [];
                     return subfolders.some(sub => hasFiles(sub.id));
                  };
                  if (!hasFiles(folderId)) {
                    alert('資料夾內無檔案可下載');
                    return;
                  }
                  const downloadUrl = `${API_ORIGIN}/api/user/${dashboardData.user?.username}/folders/${folderId}/download?token=${token || ''}`;
                  window.open(downloadUrl, '_blank');
                }}
                onToggleFolderLock={(type, id, status) => toggleItemLock(type, id, !!status)}
                isDesktop={isDesktop}
              />
            </motion.div>
          ) : (
            <motion.div
              key="urls"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex-1 min-w-0 h-full flex flex-col gap-4"
            >
              <BreadcrumbsBar
                breadcrumbs={getBreadcrumbs(activeUrlFolderId)}
                activeFolderId={activeUrlFolderId}
                onNavigate={(id) => handleFolderNavigation('url', id)}
                onSidebarToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                isSelectionMode={isSelectionMode}
                onSelectionModeChange={setIsSelectionMode}
                selectedItems={selectedItems}
                itemCount={filteredUrls.length}
                filteredCount={filteredUrls.length}
                onSelectAll={handleSelectAllAction}
                onClearSelection={() => { setIsSelectionMode(false); setSelectedItems([]); }}
                activeTab="urls"
              />

              <UrlView
                urls={filteredUrls}
                isAuthenticated={isAuthenticated}
                selectedItems={selectedItems.filter(i => i.type === 'url' || i.type === 'folder')}
                onToggleSelect={(type, id) => toggleSelectItem(type, id as string)}
                onBatchSelect={(items, action) => handleBatchSelect(items, action)}
                onToggleLock={(type, id, status) => toggleItemLock(type, id, !!status)}
                onQrCode={setQrUrl}
                onDelete={handleUrlDelete}
                onCopy={(url) => { navigator.clipboard?.writeText(url).then(() => alert("已複製！")); }}
                folders={dashboardData.folders?.filter(f => f.type === 'url') || []}
                activeFolderId={activeUrlFolderId}
                onMoveItem={handleMoveItem}
                onFolderClick={(id) => handleFolderNavigation('url', id)}
                onUpdateFolder={handleUpdateFolder}
                onDeleteFolder={handleDeleteFolder}
                viewMode={viewMode}
                isSelectionMode={isSelectionMode}
                onSelectionModeChange={setIsSelectionMode}
                onShareFolder={(folderId) => {
                  const url = `${window.location.origin}/${dashboardData.user?.username}?tab=url&folder=${folderId}`;
                  navigator.clipboard?.writeText(url).then(() => alert('資料夾連結已複製！'));
                }}
                onQrCodeFolder={(folderId: string) => {
                  const url = `${window.location.origin}/${dashboardData.user?.username}?tab=url&folder=${folderId}`;
                  setQrUrl(url);
                }}
                onPreview={(note) => setPreviewFile(note)}
                isDesktop={isDesktop}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <AnimatePresence>
        {isPacking && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-100 flex items-center justify-center bg-black/60 backdrop-blur-md"
          >
            <div className="bg-white dark:bg-space-black p-8 rounded-3xl shadow-2xl border border-white/10 flex flex-col items-center gap-6">
              <div className="relative">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  className="w-16 h-16 border-4 border-violet-500/20 border-t-violet-500 rounded-full"
                />
              </div>
              <div className="text-center">
                <h3 className="text-xl font-bold dark:text-white mb-2">壓縮檔案中...</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">請稍候，我們正在為您打包選中的資源</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAuthModal && (
          <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
             <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                className="w-full max-w-md bg-white dark:bg-space-black border border-gray-200 dark:border-white/10 rounded-3xl p-8 shadow-2xl relative overflow-hidden"
             >
                <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-cyan-500 to-violet-500" />
                <div className="text-center mb-8">
                   <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">身分驗證</h2>
                   <p className="text-gray-500 dark:text-gray-400">請輸入密碼以解鎖隱私內容</p>
                </div>
                <form onSubmit={handleAuth} className="space-y-4">
                   <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="輸入密碼..."
                      className="w-full px-4 py-3 bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-cyan-500 outline-hidden transition-all text-center text-lg tracking-widest"
                      autoFocus
                   />
                   <div className="grid grid-cols-2 gap-3">
                      <button
                         type="button"
                         onClick={() => setShowAuthModal(false)}
                         className="px-4 py-3 bg-gray-100 dark:bg-white/5 text-gray-700 dark:text-gray-300 rounded-xl font-bold hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
                      >
                         取消
                      </button>
                      <button
                         type="submit"
                         className="px-4 py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl font-bold shadow-lg shadow-cyan-500/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
                      >
                         解鎖
                      </button>
                   </div>
                </form>
             </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {qrUrl && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
            onClick={() => setQrUrl(null)}
          >
            <motion.div
              initial={{ scale: 0.5, rotateY: 90 }}
              animate={{ scale: 1, rotateY: 0 }}
              exit={{ scale: 0.5, rotateY: 90 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white p-8 rounded-3xl shadow-2xl relative max-w-sm w-full text-center"
            >
              <div className="mb-6">
                <h3 className="text-xl font-bold text-gray-900 mb-1">掃描 QR Code</h3>
                <p className="text-sm text-gray-500 break-all line-clamp-2">{qrUrl}</p>
              </div>
              <div className="bg-white p-2 rounded-xl border-2 border-dashed border-gray-200 inline-block mb-6">
                <QRCodeSVG value={qrUrl} size={200} />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setQrUrl(null)}
                  className="flex-1 py-3 bg-gray-100 text-gray-700 font-bold rounded-xl hover:bg-gray-200 transition-colors"
                >
                  關閉
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(qrUrl); alert("連結已複製"); setQrUrl(null); }}
                  className="flex-1 py-3 bg-cyan-600 text-white font-bold rounded-xl hover:bg-cyan-500 shadow-lg shadow-cyan-500/30 transition-colors"
                >
                  複製連結
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {shareUrl && (
             <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
               <motion.div
                   initial={{ opacity: 0 }}
                   animate={{ opacity: 1 }}
                   exit={{ opacity: 0 }}
                   onClick={() => setShareUrl(null)}
                   className="absolute inset-0 bg-white/80 dark:bg-space-black/80 backdrop-blur-md"
               />
               <motion.div
                   initial={{ opacity: 0, scale: 0.9, y: 20 }}
                   animate={{ opacity: 1, scale: 1, y: 0 }}
                   exit={{ opacity: 0, scale: 0.9, y: 20 }}
                   className="glass-card p-6 w-full max-w-md relative z-10 text-center space-y-4 border-cyan-200 dark:border-quantum-cyan/20 shadow-2xl"
               >
                   <div className="flex items-center justify-between mb-2">
                       <span className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-600 dark:text-quantum-cyan">分享連結</span>
                       <button onClick={() => setShareUrl(null)} className="text-gray-400 dark:text-white/40 hover:text-gray-900 dark:hover:text-white transition-colors">
                           <X className="w-5 h-5" />
                       </button>
                   </div>
                   <p className="text-gray-500 dark:text-white/40 text-xs">自動複製失敗，請長按下方連結手動複製</p>
                   <div className="p-4 bg-gray-50 dark:bg-white/5 rounded-xl border border-gray-200 dark:border-white/10">
                       <p className="text-gray-900 dark:text-white font-mono text-xs break-all select-all leading-relaxed">
                           {shareUrl}
                       </p>
                   </div>
                   <div className="flex gap-2">
                       <button
                           onClick={() => {
                               navigator.clipboard?.writeText(shareUrl).then(() => {
                                   alert('已複製！');
                                   setShareUrl(null);
                               }).catch(() => {
                                   alert('請長按上方連結手動複製');
                               });
                           }}
                           className="btn-stellar flex-1 py-3 bg-cyan-50 dark:bg-quantum-cyan/10 border-cyan-200 dark:border-quantum-cyan/30 text-cyan-600 dark:text-quantum-cyan uppercase text-xs font-black tracking-widest hover:bg-cyan-100 dark:hover:bg-quantum-cyan/20 transition-colors"
                       >
                           再試一次
                       </button>
                       <button
                           onClick={() => setShareUrl(null)}
                           className="btn-stellar flex-1 py-3 bg-gray-50 dark:bg-white/5 border-gray-200 dark:border-white/10 text-gray-600 dark:text-white/60 uppercase text-xs font-black tracking-widest hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                       >
                           關閉
                       </button>
                   </div>
               </motion.div>
             </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showSettingsModal && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
                onClick={() => setShowSettingsModal(false)}
            >
                <div className="w-full max-w-md bg-white dark:bg-space-black border border-gray-200 dark:border-white/10 rounded-3xl p-6 shadow-2xl relative overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-6">使用者設定</h2>
                    <div className="space-y-6">
                        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-xl">
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white text-sm">公開目錄索引</h3>
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">允許您的個人頁面顯示在首頁的公開列表中。</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleUpdateProfile(true)}
                                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", dashboardData.user?.show_in_list !== false ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500")}
                                >顯示</button>
                                <button
                                    onClick={() => handleUpdateProfile(false)}
                                    className={cn("px-3 py-1.5 rounded-lg text-xs font-bold transition-all", dashboardData.user?.show_in_list === false ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-500")}
                                >隱藏</button>
                            </div>
                        </div>
                        <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-white/5 rounded-xl">
                            <div>
                                <h3 className="font-bold text-gray-900 dark:text-white text-sm">操作</h3>
                            </div>
                            <button
                                onClick={() => { setIsSelectionMode(true); setShowSettingsModal(false); }}
                                className="px-4 py-2 bg-cyan-600 text-white font-bold rounded-xl text-xs"
                            >
                                選擇檔案
                            </button>
                        </div>
                    </div>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

      <SecurityInitializationModal
        isOpen={showForcedPasswordChange}
        username={dashboardData.user?.username || ""}
        oldPassword={password}
        onSuccess={async (newKey) => {
          alert("密碼更新成功！系統已進入高度安全模式。");
          setPassword(newKey);
          setShowForcedPasswordChange(false);
          await refreshDashboard(token || "");
        }}
      />

      <FilePreviewModal
        isOpen={!!previewFile}
        onClose={() => setPreviewFile(null)}
        file={previewFile}
      />

      {selectedItems.length > 0 && isAuthenticated && (
        <BatchActionBar
          selectedCount={selectedItems.length}
          isBatchSyncing={isBatchSyncing}
          onAction={handleBatchAction}
          folders={(dashboardData.folders || []).filter(f => f.type === (activeTab === 'files' ? 'file' : 'url'))}
          allowedActions={activeTab === 'files' ? ['lock', 'unlock', 'download', 'delete', 'move'] : ['lock', 'unlock', 'delete', 'move']}
          mode="mobile"
        />
      )}
    </div>
  );
};
