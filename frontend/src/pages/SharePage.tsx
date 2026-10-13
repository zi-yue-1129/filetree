import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Download, FileText, Loader2, AlertCircle, Share2, Clock, HardDrive } from 'lucide-react';
import { FilePreviewContent } from '../components/FilePreviewModal';
import { cn } from '../lib/utils';
import { apiUrl } from '../services/api';

interface ShareInfo {
  username: string;
  filename: string;
  size: string;
  size_bytes: number;
  expiry: string;
  is_locked: boolean;
  preview_url: string;
  download_url: string;
  thumbnail_url?: string;
}

export const SharePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // States for FilePreviewContent
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    const fetchShareInfo = async () => {
      try {
        const res = await fetch(apiUrl(`/api/share-info/${token}`));
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || '無法取得分享資訊');
        }
        const data = await res.json();
        setShareInfo(data);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '取得分享資訊時發生未知錯誤');
      } finally {
        setLoading(false);
      }
    };

    if (token) {
      fetchShareInfo();
    }
  }, [token]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-space-black text-white">
        <Loader2 className="w-12 h-12 text-quantum-cyan animate-spin mb-4" />
        <p className="text-white/60 animate-pulse">正在準備分享內容...</p>
      </div>
    );
  }

  if (error || !shareInfo) {
    return (
      <div className="flex flex-col items-center justify-center min-h-dvh bg-space-black text-white p-6">
        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6 border border-red-500/20">
          <AlertCircle className="w-10 h-10 text-red-400" />
        </div>
        <h2 className="text-2xl font-bold mb-2">分享連結已失效</h2>
        <p className="text-white/40 text-center max-w-md">
          {error || '連結可能已過期或被移除。請聯繫分享者取得新的連結。'}
        </p>
        <button 
          onClick={() => window.location.href = '/'}
          className="mt-8 px-6 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors border border-white/10"
        >
          回首頁
        </button>
      </div>
    );
  }

  const expiryDate = new Date(shareInfo.expiry);
  const isExpired = expiryDate < new Date();

  return (
    <div className="min-h-dvh bg-transparent text-white selection:bg-quantum-cyan/30 flex flex-col">
      {/* Background patterns */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-quantum-cyan/20 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[30%] h-[30%] bg-neural-violet/20 blur-[100px] rounded-full" />
      </div>

      {/* Header */}
      <header className="relative z-10 p-6 flex items-center justify-between border-b border-white/5 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-linear-to-br from-quantum-cyan to-neural-violet rounded-xl flex items-center justify-center shadow-lg">
            <Share2 className="w-6 h-6 text-space-black" />
          </div>
          <div>
            <h1 className="font-bold tracking-tight text-white/90">檔案分享</h1>
            <p className="filenexus-brand text-[0.6rem]! uppercase tracking-widest font-black">FileNexus Secure Share</p>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col md:flex-row items-stretch gap-6 p-4 md:p-8 max-w-7xl mx-auto w-full overflow-hidden">
        
        {/* Preview Area */}
        <div className="flex-1 min-h-[40vh] md:min-h-0 bg-deep-space/40 rounded-3xl border border-white/10 overflow-hidden relative shadow-2xl">
          <FilePreviewContent
            file={{
              name: shareInfo.filename,
              size: shareInfo.size,
              url: shareInfo.preview_url
            }}
            loading={previewLoading}
            setLoading={setPreviewLoading}
            error={previewError}
            setError={setPreviewError}
          />
        </div>

        {/* Info Area */}
        <div className="w-full md:w-80 flex flex-col gap-6 shrink-0">
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-md"
          >
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-quantum-cyan/10 rounded-2xl">
                <FileText className="w-6 h-6 text-quantum-cyan" />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-lg truncate" title={shareInfo.filename}>
                  {shareInfo.filename}
                </h2>
                <div className="flex items-center gap-1.5 text-white/40 text-xs">
                  <HardDrive className="w-3 h-3" />
                  <span>{shareInfo.size}</span>
                </div>
              </div>
            </div>

            <div className="space-y-4 mb-8">
              <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="flex items-center gap-2 text-white/40 text-[0.6rem] uppercase tracking-widest font-bold mb-1">
                  <Clock className="w-3 h-3" />
                  有效期限
                </div>
                <div className={cn(
                  "text-sm font-medium",
                  isExpired ? "text-red-400" : "text-white/80"
                )}>
                  {expiryDate.toLocaleString()}
                </div>
              </div>

              <div className="p-3 bg-black/20 rounded-xl border border-white/5">
                <div className="text-white/40 text-[0.6rem] uppercase tracking-widest font-bold mb-1">
                  分享者
                </div>
                <div className="text-sm text-white/80 font-medium">
                  @{shareInfo.username}
                </div>
              </div>
            </div>

            <a
              href={shareInfo.download_url}
              className={cn(
                "w-full py-4 rounded-2xl flex items-center justify-center gap-3 font-bold transition-all shadow-xl",
                isExpired 
                  ? "bg-white/10 text-white/40 cursor-not-allowed" 
                  : "bg-quantum-cyan text-space-black hover:scale-[1.02] active:scale-95 shadow-quantum-cyan/20"
              )}
              onClick={(e) => isExpired && e.preventDefault()}
            >
              <Download className="w-5 h-5" />
              立即下載
            </a>

            <p className="mt-4 text-[0.6rem] text-center text-white/20 italic">
              使用 SSL 端對端加密傳輸技術
            </p>
          </motion.div>

          </div>
      </main>

      <footer className="relative z-10 p-6 text-center text-[0.6rem] tracking-[0.3em] uppercase text-white/20">
        © 2026 Space-Time <span className="filenexus-brand text-[0.6rem]! tracking-[0.3em] uppercase inline-block">FileNexus</span>. All Rights Reserved.
      </footer>
    </div>
  );
};
