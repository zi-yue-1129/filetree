import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Smartphone, Copy, Check, Download, ShieldCheck, AlertTriangle, Share2 } from 'lucide-react';
import { apiUrl } from '../services/api';

/** Upload endpoint the shortcut posts to (absolute, so it works from iOS). */
const UPLOAD_ENDPOINT = apiUrl('/api/upload');

/**
 * Optional iCloud link to a pre-built shortcut. Set `VITE_IOS_SHORTCUT_URL`
 * at build time to show a one-tap install button.
 */
const ICLOUD_SHORTCUT_URL: string | undefined = import.meta.env.VITE_IOS_SHORTCUT_URL || undefined;

interface Step {
  title: string;
  detail: React.ReactNode;
}

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-white/10 border border-gray-200 dark:border-white/10 font-semibold text-gray-800 dark:text-white/90">
    {children}
  </span>
);

const BUILD_STEPS: Step[] = [
  {
    title: '建立捷徑',
    detail: <>開啟「捷徑」App → 右上角 <Kbd>+</Kbd>，命名為 <Kbd>FileNexus 上傳</Kbd>。</>,
  },
  {
    title: '加入分享選單',
    detail: <>點下方 <Kbd>ⓘ</Kbd> → 開啟 <Kbd>在分享表單中顯示</Kbd>，接收類型選「檔案」「影像」「媒體」。</>,
  },
  {
    title: '詢問密碼',
    detail: <>加入動作 <Kbd>要求輸入</Kbd>，類型「文字」，提示文字填「FileNexus 密碼」。</>,
  },
  {
    title: '逐一上傳',
    detail: (
      <>
        加入 <Kbd>對每個項目重複</Kbd>，項目選「捷徑輸入」。在迴圈內加入 <Kbd>取得 URL 內容</Kbd>：
        URL 貼上方網址、方法 <Kbd>POST</Kbd>、要求本文 <Kbd>表單</Kbd>，新增兩個欄位：
        <span className="block mt-2 font-mono text-xs">password（文字）＝ 提供的輸入</span>
        <span className="block font-mono text-xs">files（檔案）＝ 重複項目</span>
      </>
    ),
  },
  {
    title: '完成通知',
    detail: <>在迴圈後加入 <Kbd>顯示通知</Kbd>，內容「上傳完成」。</>,
  },
  {
    title: '開始使用',
    detail: <>在任何 App 點 <Kbd>分享</Kbd> → <Kbd>FileNexus 上傳</Kbd> → 輸入密碼即可。可在分享選單底部「編輯動作」將它加入喜好項目。</>,
  },
];

/**
 * Setup guide for uploading to FileNexus from the iOS Share Sheet.
 *
 * Shows the backend upload URL for this deployment and step-by-step
 * instructions for building the shortcut, plus an install button when a
 * shared iCloud shortcut link is configured.
 */
export const ShortcutPage: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const copyEndpoint = async (): Promise<void> => {
    await navigator.clipboard.writeText(UPLOAD_ENDPOINT);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative min-h-[calc(100vh-8rem)] overflow-x-hidden custom-scrollbar">
      <div className="absolute top-1/4 -right-20 w-[50vw] h-[40vh] bg-quantum-cyan/5 blur-[6rem] rounded-full -z-10 animate-pulse" />

      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="p-3 bg-quantum-cyan/10 rounded-2xl border border-quantum-cyan/20">
            <Smartphone className="w-8 h-8 text-cyan-600 dark:text-quantum-cyan" />
          </div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white/90 tracking-tighter">
            iPhone <span className="text-quantum-cyan">捷徑</span>
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-white/50">從任何 App 的分享選單，一鍵上傳檔案到 FileNexus</p>
      </motion.div>

      <div className="max-w-3xl mx-auto space-y-6 pb-20">
        {ICLOUD_SHORTCUT_URL && (
          <a
            href={ICLOUD_SHORTCUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card p-6 flex items-center justify-center gap-3 font-bold text-cyan-700 dark:text-quantum-cyan hover:border-quantum-cyan/40 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
          >
            <Download className="w-5 h-5" />
            加入捷徑（在 iPhone 上開啟）
          </a>
        )}

        <section className="glass-card p-6 space-y-3">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white/90 flex items-center gap-2">
            <Share2 className="w-5 h-5 text-quantum-cyan" />
            上傳網址
          </h2>
          <div className="flex items-stretch gap-2">
            <code className="flex-1 min-w-0 break-all px-3 py-2 rounded-lg bg-gray-100 dark:bg-white/5 text-sm text-gray-800 dark:text-white/80">
              {UPLOAD_ENDPOINT}
            </code>
            <button
              type="button"
              onClick={copyEndpoint}
              aria-label="複製上傳網址"
              className="px-3 rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-500 dark:text-white/60" />}
            </button>
          </div>
        </section>

        <section className="glass-card p-6">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white/90 mb-4">
            {ICLOUD_SHORTCUT_URL ? '或自行建立捷徑' : '建立捷徑'}
          </h2>
          <ol className="space-y-4">
            {BUILD_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-4">
                <span className="shrink-0 w-7 h-7 rounded-full bg-quantum-cyan/15 text-cyan-700 dark:text-quantum-cyan text-sm font-bold flex items-center justify-center">
                  {index + 1}
                </span>
                <div className="text-sm leading-relaxed text-gray-600 dark:text-white/60">
                  <p className="font-semibold text-gray-900 dark:text-white/90 mb-1">{step.title}</p>
                  {step.detail}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="glass-card p-6 space-y-3 text-sm text-gray-600 dark:text-white/60">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white/90 flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-green-500" />
            注意事項
          </h2>
          <p>密碼不儲存在捷徑內，每次上傳時輸入，並透過 HTTPS 傳送。</p>
          <p className="flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
            經由 Cloudflare 時單一檔案上限約 100 MB，更大的檔案請使用網頁版上傳（支援分段續傳）。
          </p>
        </section>
      </div>
    </div>
  );
};
