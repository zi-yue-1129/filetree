import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { UploadCloud } from 'lucide-react';
import { SecurityInitializationModal } from '../components/SecurityInitializationModal';
import { PendingNotesPanel } from '../components/landing/PendingNotesPanel';
import { PendingFilesPanel } from '../components/landing/PendingFilesPanel';
import { CoreTransferUnit } from '../components/landing/CoreTransferUnit';
// Uppy itself is loaded lazily (see ../lib/createUploader); types only here.
import type Uppy from '@uppy/core';

// Uppy styles
import '@uppy/core/css/style.min.css';
import { apiUrl } from '../services/api';
import { getErrorMessage, isMobileNative, pickNativeFiles, pickNativeFolder } from '../native';
import type { NativeFile } from '../native';
import { NativePendingFilesPanel } from '../native/landing/NativePendingFilesPanel';
import { enqueueLandingFiles } from '../native/landing/landingUpload';

/** Minimum spacing of upload-progress re-renders (at most 4 per second). */
const PROGRESS_COMMIT_INTERVAL_MS = 250;

interface LandingPageProps {
  data: {
    users?: Array<{ username: string; folder: string }>;
    error?: string;
    config?: { 
      allowed_extensions?: string[];
    };
  };
}

export const LandingPage: React.FC<LandingPageProps> = ({ data }) => {
  const navigate = useNavigate();
  // State for the central input
  const [inputText, setInputText] = useState('');
  const [password, setPassword] = useState('');
  
  // Pending lists
  const [pendingNotes, setPendingNotes] = useState<string[]>([]);
  // eslint-disable-next-line
  const [pendingFiles, setPendingFiles] = useState<import('@uppy/core').UppyFile<any, any>[]>([]); 
  
  // Native apps: files come from the system picker and upload in the background.
  const nativeMode = isMobileNative();
  const [nativeFiles, setNativeFiles] = useState<NativeFile[]>([]);

  const [isSyncing, setIsSyncing] = useState(false);
  const [firstLoginUserInfo, setFirstLoginUserInfo] = useState<{ username: string, oldPwd: string } | null>(null);
  const [redirectPath, setRedirectPath] = useState<string | null>(null);
  
  // Drag drop
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const lastStatsRef = useRef<Record<string, { lastBytes: number; lastTime: number; speed: number; eta: number }>>({});

  // Dynamic Uppy Instance. Keyed on the allowed-extension list itself: the
  // global USER_LIST_UPDATE refetch hands us a new (equal) config object, which
  // used to destroy the uploader together with the files queued in it.
  const allowedExtensionsKey = JSON.stringify(data?.config?.allowed_extensions ?? null);
  const [uppy, setUppy] = useState<Uppy | null>(null);
  const [uploaderError, setUploaderError] = useState<string | null>(null);

  useEffect(() => {
    const allowed = JSON.parse(allowedExtensionsKey) as string[] | null;
    let cancelled = false;
    let instance: Uppy | null = null;
    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    let lastProgressCommit = 0;

    import('../lib/createUploader')
      .then(({ createUploader }) => {
        if (cancelled) return;
        const u = createUploader({ allowedFileTypes: allowed, endpoint: apiUrl('/api/upload/tus') });
        instance = u;

        // Progress ticks arrive many times per second per file; committing
        // each one to React re-rendered the whole pending list. Progress is
        // committed at most PROGRESS_COMMIT_INTERVAL_MS apart (trailing edge),
        // structural changes (add/remove/complete) immediately.
        const commitFiles = () => {
          if (progressTimer !== null) {
            clearTimeout(progressTimer);
            progressTimer = null;
          }
          lastProgressCommit = Date.now();
          setPendingFiles(u.getFiles());
        };
        const scheduleProgressCommit = () => {
          if (progressTimer !== null) return;
          const wait = Math.max(0, lastProgressCommit + PROGRESS_COMMIT_INTERVAL_MS - Date.now());
          progressTimer = setTimeout(commitFiles, wait);
        };

        u.on('file-added', commitFiles);
        u.on('file-removed', (file) => {
          if (file) delete lastStatsRef.current[file.id];
          commitFiles();
        });
        u.on('upload-progress', (file, progress) => {
          if (!file) return;
          const now = Date.now();

          if (!lastStatsRef.current[file.id]) {
            lastStatsRef.current[file.id] = {
              lastBytes: progress.bytesUploaded,
              lastTime: now,
              speed: 0,
              eta: 0
            };
            return;
          }

          const stats = lastStatsRef.current[file.id];
          const bytesUploaded = progress.bytesUploaded;
          const bytesTotal = progress.bytesTotal ?? file.size ?? 0;

          const timeDiff = (now - stats.lastTime) / 1000;
          if (timeDiff >= 0.2) { // Update faster for smoother UI
            const bytesDiff = bytesUploaded - stats.lastBytes;
            const currentSpeed = bytesDiff / timeDiff;

            // Smoothed speed (Moving Average)
            stats.speed = stats.speed === 0 ? currentSpeed : (stats.speed * 0.7 + currentSpeed * 0.3);
            stats.lastBytes = bytesUploaded;
            stats.lastTime = now;

            const remainingBytes = Number(bytesTotal) - bytesUploaded;
            stats.eta = stats.speed > 0 ? remainingBytes / stats.speed : 0;

            u.setFileMeta(file.id, {
                uploadSpeed: stats.speed,
                eta: stats.eta
            });
          }

          scheduleProgressCommit();
        });
        u.on('complete', () => {
          if (progressTimer !== null) {
            clearTimeout(progressTimer);
            progressTimer = null;
          }
          setPendingFiles([]);
        });
        u.on('error', (error) => {
          console.error('Uppy global error:', error);
        });

        setUppy(u);
      })
      .catch((error: unknown) => {
        console.error('Uppy initialization failed', error);
        if (!cancelled) setUploaderError(getErrorMessage(error));
      });

    return () => {
      cancelled = true;
      if (progressTimer !== null) clearTimeout(progressTimer);
      instance?.destroy();
    };
  }, [allowedExtensionsKey]);

  // Sync password with Uppy meta
  useEffect(() => {
    if (uppy) uppy.setMeta({ password });
  }, [uppy, password]);



  // --- Handlers ---

  /**
   * The uploader loads right after the first paint; tell the user instead of
   * silently dropping files picked in that short window (or after a failure).
   */
  const requireUploader = (): Uppy | null => {
    if (uppy) return uppy;
    alert(uploaderError ? `上傳元件載入失敗：${uploaderError}` : '上傳元件載入中，請稍候再試');
    return null;
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const uploader = requireUploader();
      if (!uploader) {
        e.target.value = '';
        return;
      }
      Array.from(e.target.files).forEach((file) => {
        try {
          uploader.addFile({ source: 'file-input', name: file.name, type: file.type, data: file });
        } catch (err) { console.warn('File add skipped:', err); }
      });
      // Reset input
      e.target.value = ''; 
    }
  };

  const handleFolderSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const uploader = requireUploader();
      if (!uploader) {
        e.target.value = '';
        return;
      }
      Array.from(e.target.files).forEach((file) => {
        try {
          // For directory selection, webkitRelativePath contains the path
          const name = file.webkitRelativePath || file.name;
          uploader.addFile({ 
              source: 'folder-input', 
              name: name, 
              type: file.type, 
              data: file,
              meta: { relativePath: file.webkitRelativePath } 
          });
        } catch (err) { console.warn('File add skipped:', err); }
      });
       e.target.value = '';
    }
  };

  const handleNativePick = () => {
    pickNativeFiles()
      .then((files) => setNativeFiles((previous) => [...previous, ...files]))
      .catch((err: unknown) => {
        console.error('Native file picker failed', err);
        alert(`無法選擇檔案：${getErrorMessage(err)}`);
      });
  };

  const handleNativePickFolder = () => {
    pickNativeFolder()
      .then((picked) => {
        if (!picked) {
          return;
        }
        if (picked.files.length === 0) {
          alert(`資料夾「${picked.folderName}」中沒有可上傳的檔案`);
        } else {
          setNativeFiles((previous) => [...previous, ...picked.files]);
        }
        if (picked.skippedCount > 0) {
          alert(`已略過 ${picked.skippedCount} 個無法上傳的項目（例如雲端文件捷徑）`);
        }
      })
      .catch((err: unknown) => {
        console.error('Native folder picker failed', err);
        alert(`無法選擇資料夾：${getErrorMessage(err)}`);
      });
  };

  const handleAddNote = () => {
    const trimmed = inputText.trim();
    if (trimmed) {
      setPendingNotes(prev => [...prev, trimmed]);
      setInputText('');
    }
  };

  // Stable callbacks so the memoized pending panels skip keystroke re-renders.
  const handleRemoveNote = useCallback((index: number) => {
    setPendingNotes(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleRemoveFile = useCallback((fileId: string) => {
      if (uppy) {
          uppy.removeFile(fileId);
      }
  }, [uppy]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      alert('請輸入密碼以驗證身分');
      return;
    }

    // Add current input if not empty
    const finalNotes = [...pendingNotes];
    if (inputText.trim()) {
      finalNotes.push(inputText.trim());
    }

    const hasFiles = uppy && uppy.getFiles().length > 0;
    const hasNativeFiles = nativeMode && nativeFiles.length > 0;

    if (finalNotes.length === 0 && !hasFiles && !hasNativeFiles) {
      alert('請輸入文字或加入檔案');
      return;
    }

    setIsSyncing(true);

    try {
      // 1a. Native apps: hand picked files to the background upload queue.
      let nativeUploadUser: string | null = null;
      if (hasNativeFiles) {
        nativeUploadUser = await enqueueLandingFiles(nativeFiles);
        setNativeFiles([]);
      }

      // 1. Upload Files
      if (hasFiles && uppy) {
        const result = await uppy.upload();
        if (result && result.failed && result.failed.length > 0) {
           throw new Error(`上傳失敗: ${result.failed.length} 個檔案未完成`);
        } else if (!result) {
           throw new Error('上傳未回傳結果');
        }
      }

      // 2. Upload Notes
      if (finalNotes.length > 0) {
        await Promise.all(finalNotes.map(async (note) => {
           const body = new FormData();
           body.append('url', note);
           body.append('password', password);
           const res = await fetch(apiUrl('/api/upload_url'), { method: 'POST', body });
           if (!res.ok) {
             const err = await res.json();
             throw new Error(`筆記上傳失敗: ${note} - ${err.detail}`);
           }
        }));
      }

      // 3. Login & Redirect
      const body = new FormData();
      body.append('password', password);
      const res = await fetch(apiUrl('/api/login'), { method: 'POST', body });
      
      if (res.ok) {
        const user = await res.json();
        if (hasNativeFiles && nativeUploadUser && nativeUploadUser !== user.username) {
          alert(`檔案正在背景上傳到此裝置登入的帳號「${nativeUploadUser}」`);
        }
        if (user.first_login) {
          setFirstLoginUserInfo({ username: user.username, oldPwd: password });
          setRedirectPath(`/${user.username}`);
        } else {
          navigate(`/${user.username}`);
        }
      } else {
        alert('資料已提交，但自動登入失敗 (密碼可能錯誤？)');
        setIsSyncing(false);
      }

    } catch (err: unknown) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : '作業失敗，請檢查網路或密碼。';
      alert(errorMessage);
      setIsSyncing(false);
    }
  };

  // --- Drag & Drop ---
  const handleDragEnter = useCallback((e: React.DragEvent | DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent | DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent | DragEvent) => {
    e.preventDefault(); e.stopPropagation();
  }, []);

  // --- Folder Scanning Logic ---
  // Define types for FileSystem API (non-standard but widely supported)
  interface FileSystemEntry {
    isFile: boolean;
    isDirectory: boolean;
    name: string;
    fullPath: string;
  }
  interface FileSystemFileEntry extends FileSystemEntry {
    file: (callback: (file: File) => void, errorCallback?: (error: DOMException) => void) => void;
  }
  interface FileSystemDirectoryEntry extends FileSystemEntry {
    createReader: () => FileSystemDirectoryReader;
  }
  interface FileSystemDirectoryReader {
    readEntries: (
      successCallback: (entries: FileSystemEntry[]) => void,
      errorCallback?: (error: DOMException) => void
    ) => void;
  }

  const scanFiles = useCallback(async (entry: FileSystemEntry): Promise<File[]> => {
    if (entry.isFile) {
       return new Promise((resolve) => {
         (entry as FileSystemFileEntry).file((file) => {
            // Monkey-patch the path info onto the file object if needed for Uppy
            // Uppy uses 'relativePath' or simply the file name. 
            // construct the relative path from the entry.fullPath (usually starts with /)
            const relativePath = entry.fullPath.startsWith('/') ? entry.fullPath.slice(1) : entry.fullPath;
            Object.defineProperty(file, 'webkitRelativePath', {
              value: relativePath,
              writable: true // Allow overwriting if needed
            });
            resolve([file]);
         });
       });
    } else if (entry.isDirectory) {
       const dirReader = (entry as FileSystemDirectoryEntry).createReader();
       const readEntriesPromise = () => new Promise<FileSystemEntry[]>((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
       });
       
       let entries: FileSystemEntry[] = [];
       // Read all entries in the directory (loop needed for some browsers limiting batch size)
       let batch = await readEntriesPromise();
       while (batch.length > 0) {
          entries = entries.concat(batch);
          batch = await readEntriesPromise();
       }
       
       const files = await Promise.all(entries.map(e => scanFiles(e)));
       return files.flat();
    }
    return [];
  }, []);


  const handleDrop = useCallback(async (e: React.DragEvent | DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragOver(false);
    dragCounter.current = 0;

    if (!uppy) {
      alert(uploaderError ? `上傳元件載入失敗：${uploaderError}` : '上傳元件載入中，請稍候再試');
      return;
    }

    // Use DataTransferItemList if available to get FileSystemEntry (supports folders)
    if (e.dataTransfer && e.dataTransfer.items) {
      const items = Array.from(e.dataTransfer.items);
      const promises: Promise<File[]>[] = [];

      for (const item of items) {
        if (item.kind === 'file') {
          const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
          if (entry) {
             // It's a file or directory entry
             promises.push(scanFiles(entry as unknown as FileSystemEntry));
          } else {
             // Fallback for purely standard files (though rare if kind is file)
             const file = item.getAsFile();
             if (file) promises.push(Promise.resolve([file]));
          }
        }
      }

      try {
        const fileArrays = await Promise.all(promises);
        const allFiles = fileArrays.flat();
        
        allFiles.forEach((file) => {
          try {
            // Uppy's addFile automatically handles file objects. 
            // We set source to 'drag-drop-overlay'
            // If the file has webkitRelativePath set (from our scan), Uppy might utilize it,
            // or we can manually set the name to the full relative path to ensure structure visibility.
            // Using webkitRelativePath as the name ensures unique names in the dashboard list.
            const name = file.webkitRelativePath || file.name;
            
            uppy.addFile({ 
              source: 'drag-drop-overlay', 
              name: name,
              type: file.type, 
              data: file,
              meta: {
                // Ensure relativePath is passed in meta for TUS or other plugins to use
                relativePath: file.webkitRelativePath 
              }
            });
          } catch (err) { console.warn('File add skipped:', err); }
        });
      } catch (err) {
        console.error("Folder scanning failed:", err);
      }

    } else if (e.dataTransfer && e.dataTransfer.files?.length > 0) {
      // Fallback for browsers not supporting DataTransferItem / GetAsEntry
      Array.from(e.dataTransfer.files).forEach((file) => {
        try {
          uppy.addFile({ source: 'drag-drop-overlay', name: file.name, type: file.type, data: file });
        } catch (err) { console.warn('File add skipped:', err); }
      });
    }
  }, [uppy, uploaderError, scanFiles]);

  useEffect(() => {
    const handleWindowDragEnter = (e: DragEvent) => handleDragEnter(e);
    const handleWindowDragLeave = (e: DragEvent) => handleDragLeave(e);
    const handleWindowDragOver = (e: DragEvent) => handleDragOver(e);
    const handleWindowDrop = (e: DragEvent) => handleDrop(e);

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);


  return (
    // Outer container:
    // Mobile/Tablet: min-h-dvh (grows with content), standard scrolling allowed.
    // Large Desktop (lg+): h-screen, global overflow hidden (internal scaling).
    <div className="relative h-full w-full overflow-x-hidden bg-transparent custom-scrollbar">
      
      {/* Background glow - only in dark mode */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] h-[90vh] fx-glow text-quantum-cyan/5 -z-10 hidden dark:block" />

       {/* Drag Overlay - Ensure High Z-Index */}
       <AnimatePresence>
        {isDragOver && (
          <motion.div
            key="drag-overlay"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-100 bg-cyan-500/20 backdrop-blur-md flex flex-col items-center justify-center border-4 border-dashed border-cyan-400 p-8"
          >
            <div className="bg-white/90 dark:bg-black/80 p-6 rounded-3xl shadow-2xl flex flex-col items-center gap-4 pointer-events-none">
              <UploadCloud className="w-16 h-16 text-cyan-600 animate-bounce" />
              <h2 className="text-2xl font-bold text-gray-800 dark:text-white">釋放滑鼠以上傳檔案</h2>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* TRIPTYCH LAYOUT
          Mobile: flex-col, standard vertical stacking, gaps managed by rem.
          Desktop (lg+): flex-row, h-full, centered, no scrollbars on body.
          Breakpoint changed from 'xl' to 'lg' to support 13" laptops/iPad Pros.
      */}
      <div className="w-full h-full flex flex-col 2xl:flex-row items-center justify-start 2xl:justify-center gap-6 2xl:gap-[1.5vw] px-4 py-8 2xl:p-0 relative z-10 box-border overflow-y-auto 2xl:overflow-hidden max-w-480 mx-auto custom-scrollbar">
        
        {/* --- [LEFT WING] Pending Notes --- */}
        {/* Mobile: Order 2. Full Width. Auto height.
            Desktop: Order 1. Width ~19vw (Refined). Full Height.
        */}
        <div className="order-2 2xl:order-1 w-full 2xl:w-[22vw] xl:w-[20vw] 2xl:min-w-55 2xl:max-w-112.5 flex flex-col h-auto min-h-50 max-h-[50vh] 2xl:h-[80vh] 2xl:max-h-212.5 transition-opacity duration-300 2xl:opacity-60 2xl:hover:opacity-100 min-w-0 shrink">
           <PendingNotesPanel 
              pendingNotes={pendingNotes} 
              onRemoveNote={handleRemoveNote}
           />
        </div>

        {/* --- [CENTER CORE] Unified Input --- */}
        {/* Mobile: Order 1 (Top). Full Width. 
            Desktop: Order 2. Flex-1.
        */}
        <div className="order-1 2xl:order-2 w-full max-w-lg 2xl:flex-1 2xl:min-w-115 2xl:max-w-3xl xl:max-w-4xl relative z-20 min-w-0 shrink-0">
           <CoreTransferUnit
              inputText={inputText}
              setInputText={setInputText}
              onAddNote={handleAddNote}
              onFileSelect={handleFileSelect}
              onFolderSelect={handleFolderSelect}
              password={password}
              setPassword={setPassword}
              onSubmit={handleSubmit}
              isSyncing={isSyncing}
              onNativePickFiles={nativeMode ? handleNativePick : undefined}
              onNativePickFolder={nativeMode ? handleNativePickFolder : undefined}
           />
        </div>


        {/* --- [RIGHT WING] Pending Files --- */}
        {/* Mobile: Order 3. Full Width. Auto Height. 
            Desktop: Order 3. Width ~19vw (Refined). Full Height.
        */}
        <div className="order-3 2xl:order-3 w-full 2xl:w-[22vw] xl:w-[19vw] 2xl:min-w-55 2xl:max-w-112.5 flex flex-col h-auto min-h-50 max-h-[50vh] 2xl:h-[80vh] 2xl:max-h-212.5 transition-opacity duration-300 2xl:opacity-60 2xl:hover:opacity-100 min-w-0 shrink pb-10 2xl:pb-0">
           {nativeMode ? (
             <NativePendingFilesPanel
                files={nativeFiles}
                onRemove={(index) => setNativeFiles((previous) => previous.filter((_, i) => i !== index))}
             />
           ) : (
           <PendingFilesPanel 
              pendingFiles={pendingFiles} 
              onRemoveFile={handleRemoveFile} 
           />
           )}
        </div>

      </div>

      <SecurityInitializationModal
        isOpen={!!firstLoginUserInfo}
        username={firstLoginUserInfo?.username || ""}
        oldPassword={firstLoginUserInfo?.oldPwd || ""}
        onSuccess={() => {
            alert("安全性初始化完成，正在跳轉至專屬區域。");
            navigate(redirectPath || '/');
        }}
      />
    </div>
  );
};
