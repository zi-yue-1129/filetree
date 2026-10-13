import React, { useState, useEffect } from 'react';
import { m, AnimatePresence } from 'framer-motion';
import { X, Download, FileText, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { getFileType } from '../lib/file-utils';

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  file: {
    name: string;
    size: string;
    url: string;
  } | null;
}

// Internal component to handle content loading and display
// This avoids "state reset cascading renders" in the parent modal
export const FilePreviewContent: React.FC<{
  file: NonNullable<FilePreviewModalProps['file']>;
  loading: boolean;
  setLoading: (l: boolean) => void;
  error: string | null;
  setError: (e: string | null) => void;
}> = ({ file, loading, setLoading, error, setError }) => {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [officeViewer, setOfficeViewer] = useState<'microsoft' | 'google'>('microsoft');

  useEffect(() => {
    const type = getFileType(file.name);

    if (type === 'text' || type === 'code' || file.size === 'Note') {
      const isUrl = file.url.startsWith('http') || file.url.startsWith('/') || file.url.startsWith('blob:');
      
      if (isUrl) {
        fetch(file.url)
          .then(res => {
            if (!res.ok) throw new Error("無法讀取檔案內容");
            return res.text();
          })
          .then(text => {
            setTextContent(text);
            setLoading(false);
          })
          .catch(err => {
            console.error(err);
            setError("預覽失敗：無法載入內容");
            setLoading(false);
          });
      } else {
        Promise.resolve().then(() => {
          setTextContent(file.url);
          setLoading(false);
        });
      }
    } else {
      // Media types: loading is handled by onLoad events in the render
    }
  }, [file, setLoading, setError]);

  const isNote = file.size === 'Note' || file.name === '筆記預覽';
  const fileType = isNote ? 'text' : getFileType(file.name);

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-400 space-y-4">
        <FileText className="w-16 h-16 opacity-50" />
        <p>{error}</p>
      </div>
    );
  }

  switch (fileType) {
    case 'image':
      return (
        <div className="flex items-center justify-center h-full w-full relative">
          {loading && <Loader2 className="w-8 h-8 text-quantum-cyan animate-spin absolute" />}
          <img
            src={file.url}
            alt={file.name}
            className={cn(
              "max-w-full max-h-full object-contain transition-opacity duration-300",
              "opacity-100"
            )}
            onLoad={() => setLoading(false)}
            onError={() => { setLoading(false); setError("無法載入圖片"); }}
          />
        </div>
      );
    case 'video':
      return (
        <div className="flex items-center justify-center h-full w-full relative">
          <video
            controls
            autoPlay
            className="max-w-full max-h-full rounded-lg shadow-2xl"
            onLoadedData={() => setLoading(false)}
            onError={() => { setLoading(false); setError("無法播放影片"); }}
          >
            <source src={file.url} />
            您的瀏覽器不支援此影片格式
          </video>
        </div>
      );
    case 'audio':
      return (
        <div className="flex flex-col items-center justify-center h-full w-full space-y-8">
          <div className="w-32 h-32 rounded-full bg-neural-violet/10 flex items-center justify-center animate-pulse-slow border border-neural-violet/20">
            <div className="w-3 h-12 bg-neural-violet rounded-full animate-music-bar-1 mx-1" />
            <div className="w-3 h-16 bg-quantum-cyan rounded-full animate-music-bar-2 mx-1" />
            <div className="w-3 h-10 bg-neural-violet rounded-full animate-music-bar-3 mx-1" />
          </div>
          <audio controls autoPlay src={file.url} className="w-full max-w-md" onLoadedData={() => setLoading(false)} />
        </div>
      );
    case 'pdf': {
      const pdfUrl = file.url.includes('?')
        ? `${file.url}&inline=true`
        : `${file.url}?inline=true`;
      return (
        <iframe
          src={pdfUrl}
          className="w-full h-full rounded-lg border border-white/10"
          title={file.name}
          onLoad={() => setLoading(false)}
        />
      );
    }
    case 'office': {
      const fullUrl = file.url.startsWith('http') ? file.url : window.location.origin + file.url;
      const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const sizeInMB = parseFloat(file.size.split(' ')[0]);
      const isTooLarge = file.size.includes('GB') || (file.size.includes('MB') && sizeInMB > 25);

      if (isLocal || isTooLarge) {
        return (
          <div className="flex flex-col items-center justify-center h-full space-y-6 text-center p-8 bg-space-black/40 rounded-xl border border-white/5">
            <div className="w-20 h-20 rounded-full bg-amber-500/10 flex items-center justify-center border border-amber-500/20">
              <FileText className="w-10 h-10 text-amber-400" />
            </div>
            <div className="max-w-md space-y-2">
              <h4 className="text-xl font-bold text-white/90">無法線上預覽此 Office 檔案</h4>
              <p className="text-sm text-white/40 leading-relaxed">
                {isTooLarge
                  ? `檔案大小 (${file.size}) 超過線上預覽限制 (25MB)，請下載到本地端查看。`
                  : "偵測到您正在使用 Localhost，線上預覽功能需要公開的網路網址才能運作。請使用雲端隧道產生的網址開啟網站。"}
              </p>
            </div>
            <a
              href={file.url}
              download
              className="flex items-center gap-2 px-8 py-3 bg-quantum-cyan text-deep-space font-bold rounded-lg hover:scale-105 active:scale-95 transition-all shadow-[0_0_20px_rgba(34,211,238,0.3)]"
            >
              <Download className="w-5 h-5" />
              立即下載查看
            </a>
          </div>
        );
      }

      const viewers = {
        microsoft: `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(fullUrl)}`,
        google: `https://docs.google.com/viewer?url=${encodeURIComponent(fullUrl)}&embedded=true`
      };

      return (
        <div className="w-full h-full flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/5">
            <div className={cn(
              "text-[0.5625rem] uppercase font-bold tracking-[0.2em]",
              officeViewer === 'microsoft' ? "text-blue-400" : "text-amber-400"
            )}>
              正在使用 {officeViewer === 'microsoft' ? 'Microsoft Office' : 'Google Docs'} 引擎載入預覽
            </div>
            <button
              onClick={() => setOfficeViewer(v => v === 'microsoft' ? 'google' : 'microsoft')}
              className="text-[0.5625rem] px-2 py-1 bg-white/5 hover:bg-white/10 rounded border border-white/10 text-white/40 transition-colors"
            >
              切換引擎
            </button>
          </div>
          <iframe
            key={officeViewer}
            src={viewers[officeViewer]}
            className="flex-1 w-full rounded-b-lg bg-white"
            title={file.name}
            onLoad={() => setLoading(false)}
          />
        </div>
      );
    }
    case 'text':
    case 'code':
      if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 text-quantum-cyan animate-spin" /></div>;
      return (
        <div className="w-full h-full overflow-auto p-4 bg-space-black/50 rounded-lg border border-white/10 font-mono text-sm text-white/80 whitespace-pre-wrap">
          {textContent}
        </div>
      );
    default:
      return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 text-white/50">
          <FileText className="w-20 h-20 opacity-20" />
          <p>此檔案類型不支援預覽</p>
          <a
            href={file.url}
            download
            className="btn-stellar px-6 py-2 bg-white/5 hover:bg-quantum-cyan/20 text-quantum-cyan"
          >
            下載檢視
          </a>
        </div>
      );
  }
};

export const FilePreviewModal: React.FC<FilePreviewModalProps> = ({ isOpen, onClose, file }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <AnimatePresence>
      {isOpen && file && (
        <div className="fixed inset-0 z-150 flex items-center justify-center p-4 sm:p-6">
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-space-black/95 backdrop-blur-xl"
          />

          <m.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className={cn(
              "relative z-10 flex flex-col bg-deep-space/50 rounded-2xl border border-white/10 shadow-[0_0_50px_rgba(34,211,238,0.1)] overflow-hidden",
              isFullscreen ? "w-[98vw] h-[95vh]" : "w-full max-w-5xl h-[80vh]"
            )}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/5 backdrop-blur-md shrink-0">
              <div className="flex items-center gap-4 min-w-0">
                <div className="p-2 bg-quantum-cyan/10 rounded-lg">
                  <FileText className="w-5 h-5 text-quantum-cyan" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-white/90 font-bold truncate text-lg tracking-tight">
                    {file.name}
                    <span className="text-[0.5rem] opacity-10 ml-2 font-mono">v2.1.5</span>
                  </h3>
                  <p className="text-white/30 text-xs uppercase tracking-widest font-bold">{file.size} </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={file.url}
                  download
                  className="p-2 text-white/40 hover:text-quantum-cyan hover:bg-quantum-cyan/10 rounded-lg transition-colors"
                  title="下載檔案"
                >
                  <Download className="w-5 h-5" />
                </a>
                <button
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-colors hidden sm:block"
                  title={isFullscreen ? "退出全螢幕" : "全螢幕"}
                >
                  {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
                </button>
                <div className="w-px h-6 bg-white/10 mx-2" />
                <button
                  onClick={onClose}
                  className="p-2 text-white/40 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden p-2 sm:p-4 relative bg-black/20">
              <FilePreviewContent
                key={file.url}
                file={file}
                loading={loading}
                setLoading={setLoading}
                error={error}
                setError={setError}
              />
            </div>

          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
};
