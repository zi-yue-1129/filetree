/**
 * Pending-files list for the Landing page in the native apps (files picked
 * with the system picker, uploaded by the native queue on submit).
 *
 * A picked folder is shown as one grouped row (name, file count, total size)
 * so folders with thousands of files stay cheap to render; its files are only
 * listed on demand, capped at `FOLDER_PREVIEW_LIMIT` rows.
 */
import React, { useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, X } from 'lucide-react';
import type { NativeFile } from '../index';
import { formatBytes } from '../settings/format';
import { FOLDER_PREVIEW_LIMIT } from './pendingFolder';
import type { PendingNativeFolder } from './pendingFolder';

/** Props of {@link NativePendingFilesPanel}. */
interface NativePendingFilesPanelProps {
  /** Individually picked files. */
  files: NativeFile[];
  /** Picked folders, one grouped row each. */
  folders: PendingNativeFolder[];
  /** Remove one file by index. */
  onRemove: (index: number) => void;
  /** Remove a whole folder pick by id. */
  onRemoveFolder: (id: string) => void;
}

/** Props of {@link FolderRow}. */
interface FolderRowProps {
  /** The folder to show. */
  folder: PendingNativeFolder;
  /** Remove this folder pick. */
  onRemove: () => void;
}

/**
 * One grouped folder row with an optional, capped file preview.
 *
 * @param props - Row props.
 * @returns The row.
 */
const FolderRow: React.FC<FolderRowProps> = ({ folder, onRemove }) => {
  const [expanded, setExpanded] = useState(false);
  const hiddenCount = folder.files.length - FOLDER_PREVIEW_LIMIT;
  const sizeLabel = folder.unknownSizeCount > 0
    ? `${formatBytes(folder.totalBytes)}+（${folder.unknownSizeCount} 個大小未知）`
    : formatBytes(folder.totalBytes);
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10">
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? `收合 ${folder.folderName}` : `顯示 ${folder.folderName} 的檔案`}
          onClick={() => setExpanded((previous) => !previous)}
          className="flex flex-1 min-w-0 items-center gap-3 text-left rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
        >
          {expanded
            ? <ChevronDown className="w-4 h-4 shrink-0 text-gray-400" />
            : <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" />}
          <Folder className="w-4 h-4 shrink-0 text-purple-500" />
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate text-gray-800 dark:text-white/80" title={folder.folderName}>{folder.folderName}</p>
            <p className="text-[0.65rem] text-gray-400 dark:text-white/40">
              {folder.files.length} 個檔案 · {sizeLabel}
            </p>
          </div>
        </button>
        <button
          type="button"
          aria-label={`移除資料夾 ${folder.folderName}`}
          onClick={onRemove}
          className="p-1 rounded-lg hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
        >
          <X className="w-4 h-4 text-red-500" />
        </button>
      </div>
      {expanded && (
        <ul className="border-t border-gray-200 dark:border-white/5 px-3 py-2 space-y-1">
          {folder.files.slice(0, FOLDER_PREVIEW_LIMIT).map((file) => (
            <li key={file.uri} className="flex items-center gap-2 text-[0.7rem] text-gray-500 dark:text-white/50">
              <span className="flex-1 min-w-0 truncate" title={file.relativePath ?? file.name}>{file.relativePath ?? file.name}</span>
              <span className="shrink-0">{formatBytes(file.size ?? -1)}</span>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="text-[0.65rem] text-gray-400 dark:text-white/30">還有 {hiddenCount} 個檔案未列出</li>
          )}
        </ul>
      )}
    </div>
  );
};

/**
 * Glass panel listing picked files and folders, styled like the web `PendingFilesPanel`.
 *
 * @param props - Panel props.
 * @returns The panel.
 */
export const NativePendingFilesPanel: React.FC<NativePendingFilesPanelProps> = ({ files, folders, onRemove, onRemoveFolder }) => {
  const totalCount = files.length + folders.reduce((count, folder) => count + folder.files.length, 0);
  return (
    <div className="glass-card h-full flex flex-col overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5">
        <h3 className="text-[0.6rem] font-black text-gray-500 dark:text-stellar-label uppercase tracking-[0.2em]">
          待傳檔案 ({totalCount})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
        {totalCount === 0 ? (
          <p className="text-xs text-center text-gray-400 dark:text-white/30 py-8">尚未選擇檔案</p>
        ) : (
          <>
            {folders.map((folder) => (
              <FolderRow key={folder.id} folder={folder} onRemove={() => onRemoveFolder(folder.id)} />
            ))}
            {files.map((file, index) => (
              <div key={`${file.uri}-${index}`} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2">
                <FileText className="w-4 h-4 shrink-0 text-cyan-500" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate text-gray-800 dark:text-white/80" title={file.name}>{file.name}</p>
                  <p className="text-[0.65rem] text-gray-400 dark:text-white/40">{formatBytes(file.size ?? -1)}</p>
                </div>
                <button
                  type="button"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => onRemove(index)}
                  className="p-1 rounded-lg hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
                >
                  <X className="w-4 h-4 text-red-500" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
      <p className="px-5 py-3 text-[0.65rem] text-gray-400 dark:text-white/30 border-t border-gray-200 dark:border-white/5">
        送出後會在背景上傳，可到「App 設定」查看進度。
      </p>
    </div>
  );
};
