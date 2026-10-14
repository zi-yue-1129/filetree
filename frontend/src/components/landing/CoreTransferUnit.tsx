import React, { useRef } from 'react';
import { m } from 'framer-motion';
import {
  Cpu,
  Activity,
  Zap,
  ArrowRight,
  FileUp,
  FileText,
  Database,
  ShieldCheck,
  Orbit,
} from 'lucide-react';
import { cn } from '../../lib/utils';

interface CoreTransferUnitProps {
  inputText: string;
  setInputText: (val: string) => void;
  onAddNote: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFolderSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  password: string;
  setPassword: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isSyncing: boolean;
  /**
   * Native apps only: open the system picker instead of the WebView file
   * input (native uploads need content URIs, not File objects).
   */
  onNativePickFiles?: () => void;
  /**
   * Native apps only: open the system folder picker instead of the WebView
   * `webkitdirectory` input, which Android/iOS WebViews do not support. In
   * native mode the folder button is shown only when this is set.
   */
  onNativePickFolder?: () => void;
}

export const CoreTransferUnit: React.FC<CoreTransferUnitProps> = ({
  inputText,
  setInputText,
  onAddNote,
  onFileSelect,
  onFolderSelect,
  password,
  setPassword,
  onSubmit,
  isSyncing,
  onNativePickFiles,
  onNativePickFolder,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Native shells without a folder picker get a single full-width file button.
  const showFolderButton = !onNativePickFiles || onNativePickFolder !== undefined;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onAddNote();
    }
  };

  return (
    <div className="w-full">
      {/* Floating Title */}
      <m.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6 lg:mb-[2.5vh] space-y-1"
      >
        <div className="flex items-center justify-center gap-3">
          <h1 className="filenexus-brand text-4xl! lg:text-[clamp(2.5rem,3.5vw,4rem)]! tracking-tighter leading-none animate-stellar-text">
            FileNexus
          </h1>
          <Orbit className="w-8 h-8 lg:w-[clamp(1.5rem,3vw,2.5rem)] lg:h-[clamp(1.5rem,3vw,2.5rem)] text-cyan-500 animate-spin-slow opacity-80" />
        </div>
        <p className="text-[0.6rem] lg:text-[0.65rem] uppercase tracking-[0.4em] lg:tracking-[0.6em] font-bold text-cyan-600/80 dark:text-quantum-cyan/60 pl-2 lg:pl-4">
          File Management Hub 📁
        </p>
      </m.div>

      <div className="glass-card-premium p-0.5 relative group mx-auto w-full shadow-2xl hover:shadow-cyan-500/20 transition-all duration-500 hover:scale-[1.005] rounded-4xl lg:rounded-[2.5rem]">
        <div className="neural-border rounded-4xl lg:rounded-[2.5rem] p-5 lg:px-[3vw] lg:py-[3vh] space-y-5 lg:space-y-[2.5vh] relative overflow-hidden">
          {/* Internal Glow */}
          <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-transparent via-cyan-500/50 to-transparent opacity-50" />

          <div className="relative z-10 flex flex-col gap-5 lg:gap-[2vh]">
            {/* Core Header */}
            <div className="text-center mb-1 flex items-center justify-center gap-2 opacity-80">
              <Cpu className="w-4 h-4 text-cyan-500" />
              <span className="text-[0.65rem] lg:text-xs font-bold tracking-widest uppercase text-gray-500 dark:text-gray-400">
                資料傳輸核心
              </span>
              <Activity className="w-3.5 h-3.5 text-purple-500 animate-pulse" />
            </div>

            {/* 1. Note Input */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Zap className="w-3.5 h-3.5 text-orange-500" />
                <label className="text-[0.6rem] font-black text-gray-500 dark:text-stellar-label uppercase tracking-[0.2em]">
                  快速筆記 / 網址
                </label>
              </div>
              <div className="relative group/input">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="輸入內容..."
                  className="w-full h-32 lg:h-[12vh] min-h-25 bg-gray-50 dark:bg-white/3 border border-gray-200 dark:border-white/10 rounded-2xl px-5 py-4 outline-none focus:border-cyan-500/50 focus:bg-white dark:focus:bg-white/8 transition-all text-gray-900 dark:text-white/90 text-base lg:text-[clamp(1rem,1.5vw,1.25rem)] font-medium shadow-inner resize-none placeholder:text-gray-400 dark:placeholder:text-white/20 custom-scrollbar"
                />
                <div className="absolute bottom-4 right-4 flex items-center gap-2 text-[0.6rem] text-gray-400 uppercase tracking-widest font-bold bg-white dark:bg-white/10 border border-gray-100 dark:border-white/5 px-3 py-1.5 rounded-full pointer-events-none opacity-40 group-focus-within/input:opacity-100 transition-all transform group-focus-within/input:scale-105 shadow-sm">
                  <span className="hidden sm:inline">按 Enter</span>
                  <span className="sm:hidden">Enter</span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 px-1 justify-between">
              <div className="flex items-center gap-2">
                <FileUp className="w-3.5 h-3.5 text-cyan-500" />
                <label className="text-[0.6rem] font-black text-gray-500 dark:text-stellar-label uppercase tracking-[0.2em]">
                  檔案上傳
                </label>
              </div>
              {/* Hidden Inputs */}
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={onFileSelect}
              />
              <input
                type="file"
                // @ts-expect-error webkitdirectory is non-standard
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
                ref={folderInputRef}
                onChange={onFolderSelect}
              />
            </div>

            {/* File Buttons Grid: Taller on mobile for easier tapping */}
            <div className={cn("grid gap-3 lg:gap-4 h-28 lg:h-[15vh] min-h-25", showFolderButton ? "grid-cols-2" : "grid-cols-1")}>
              {/* Select File Button */}
              <button
                onClick={() => (onNativePickFiles ? onNativePickFiles() : fileInputRef.current?.click())}
                className="group/btn relative flex flex-col items-center justify-center gap-2 lg:gap-[1.5vh] rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 hover:border-cyan-500/50 hover:bg-cyan-500/5 active:bg-cyan-500/10 transition-all overflow-hidden"
              >
                <div className="p-3 lg:p-[1.5vh] rounded-full bg-white dark:bg-white/10 group-hover/btn:scale-110 transition-transform shadow-sm group-active/btn:scale-95">
                  <FileText className="w-5 h-5 lg:w-[3vh] lg:h-[3vh] text-gray-600 dark:text-gray-300 group-hover/btn:text-cyan-500" />
                </div>
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest group-hover/btn:text-cyan-500 transition-colors">
                  選擇檔案
                </span>
              </button>

              {/* Select Folder Button (web input, or the native folder picker) */}
              {showFolderButton && (
              <button
                onClick={() => (onNativePickFolder ? onNativePickFolder() : folderInputRef.current?.click())}
                className="group/btn relative flex flex-col items-center justify-center gap-2 lg:gap-[1.5vh] rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 hover:border-purple-500/50 hover:bg-purple-500/5 active:bg-purple-500/10 transition-all overflow-hidden"
              >
                <div className="p-3 lg:p-[1.5vh] rounded-full bg-white dark:bg-white/10 group-hover/btn:scale-110 transition-transform shadow-sm group-active/btn:scale-95">
                  <Database className="w-5 h-5 lg:w-[3vh] lg:h-[3vh] text-gray-600 dark:text-gray-300 group-hover/btn:text-purple-500" />
                </div>
                <span className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest group-hover/btn:text-purple-500 transition-colors">
                  選擇資料夾
                </span>
              </button>
              )}
            </div>

            {/* 3. Auth & Submit */}
            <div className="pt-4 lg:pt-[2vh] border-t border-gray-100 dark:border-white/5 space-y-4 lg:space-y-[1.5vh]">
              <div className="space-y-2">
                <label className="text-[0.6rem] font-black text-gray-500 dark:text-stellar-label uppercase tracking-[0.2em] ml-2 opacity-60">
                  身分驗證
                </label>
                <div className="relative group/auth">
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onSubmit(e)}
                    placeholder="輸入解鎖密碼"
                    className="w-full bg-white/50 dark:bg-white/3 border border-white/30 dark:border-white/10 rounded-2xl px-5 sm:px-6 py-4 outline-none focus:border-cyan-500/50 dark:focus:border-quantum-cyan/50 focus:bg-white/80 dark:focus:bg-white/8 transition-all text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-white/20 min-h-25 resize-none shadow-inner"
                  />
                  <ShieldCheck className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-300 dark:text-white/10 group-focus-within/auth:text-cyan-500 transition-colors" />
                </div>
              </div>

              <button
                onClick={onSubmit}
                disabled={isSyncing}
                className="group/btn relative w-full flex items-center justify-center gap-3 py-4 lg:py-[2vh] rounded-full border border-cyan-500/50 bg-transparent hover:bg-cyan-500/10 hover:border-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.3)] active:bg-cyan-500/20 hover:scale-[1.01] active:scale-[0.99] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden touch-manipulation"
              >
                <span className="tracking-[0.5em] uppercase font-bold text-sm lg:text-[clamp(1rem,1.2vw,1.5rem)] text-cyan-400 group-hover/btn:text-cyan-300 relative z-10 transition-colors pl-1">
                  {isSyncing ? '同步中...' : '提交資料'}
                </span>
                <Zap
                  className={cn(
                    'w-5 h-5 text-cyan-400 group-hover/btn:text-cyan-300 relative z-10 transition-colors',
                    isSyncing && 'animate-spin'
                  )}
                />

                {/* Scanline / Glimmer Effect */}
                <div className="absolute inset-0 bg-linear-to-r from-transparent via-cyan-400/10 to-transparent -translate-x-full group-hover/btn:animate-shimmer pointer-events-none" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
