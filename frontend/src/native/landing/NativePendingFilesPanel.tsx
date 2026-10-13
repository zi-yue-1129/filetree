/**
 * Pending-files list for the Landing page in the native apps (files picked
 * with the system picker, uploaded by the native queue on submit).
 */
import React from 'react';
import { FileText, X } from 'lucide-react';
import type { NativeFile } from '../index';
import { formatBytes } from '../settings/format';

/** Props of {@link NativePendingFilesPanel}. */
interface NativePendingFilesPanelProps {
  /** Picked files. */
  files: NativeFile[];
  /** Remove one file by index. */
  onRemove: (index: number) => void;
}

/**
 * Glass panel listing picked files, styled like the web `PendingFilesPanel`.
 *
 * @param props - Panel props.
 * @returns The panel.
 */
export const NativePendingFilesPanel: React.FC<NativePendingFilesPanelProps> = ({ files, onRemove }) => (
  <div className="glass-card h-full flex flex-col overflow-hidden">
    <div className="px-5 py-4 border-b border-gray-200 dark:border-white/5">
      <h3 className="text-[0.6rem] font-black text-gray-500 dark:text-stellar-label uppercase tracking-[0.2em]">
        待傳檔案 ({files.length})
      </h3>
    </div>
    <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2">
      {files.length === 0 ? (
        <p className="text-xs text-center text-gray-400 dark:text-white/30 py-8">尚未選擇檔案</p>
      ) : (
        files.map((file, index) => (
          <div key={`${file.uri}-${index}`} className="flex items-center gap-3 rounded-xl border border-gray-200 dark:border-white/10 px-3 py-2">
            <FileText className="w-4 h-4 shrink-0 text-cyan-500" />
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate text-gray-800 dark:text-white/80">{file.name}</p>
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
        ))
      )}
    </div>
    <p className="px-5 py-3 text-[0.65rem] text-gray-400 dark:text-white/30 border-t border-gray-200 dark:border-white/5">
      送出後會在背景上傳，可到「App 設定」查看進度。
    </p>
  </div>
);
