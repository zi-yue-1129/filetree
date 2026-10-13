import React from 'react';
import { useNavigate } from 'react-router-dom';
import { m } from 'framer-motion';
import { HelpCircle, FileUp, Zap, Lock, Clock, Globe, Cpu, ExternalLink, Users } from 'lucide-react';

interface HelpPageProps {
  onOpenDirectory?: () => void;
}

export const HelpPage: React.FC<HelpPageProps> = ({ onOpenDirectory }) => {
  const navigate = useNavigate();

  const handleAction = (type: 'upload' | 'note' | 'directory') => {
    if (type === 'directory' && onOpenDirectory) {
      onOpenDirectory();
      navigate('/');
    } else {
      navigate('/');
    }
  };

  return (
    <div className="relative min-h-[calc(100vh-8rem)] overflow-x-hidden custom-scrollbar">
      {/* Background Glow */}
      <div className="absolute top-1/4 -right-20 w-[50vw] h-[40vh] fx-glow text-quantum-cyan/5 -z-10" />
      <div className="absolute bottom-1/4 -left-20 w-[40vw] h-[30vh] fx-glow text-neural-violet/5 -z-10" />

      {/* Header */}
      <m.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <div className="flex items-center justify-center gap-4 mb-4">
          <div className="p-3 bg-quantum-cyan/10 rounded-2xl border border-quantum-cyan/20">
            <HelpCircle className="w-8 h-8 text-cyan-600 dark:text-quantum-cyan" />
          </div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white/90 tracking-tighter">
            核心使用<span className="text-quantum-cyan">協議</span>
          </h1>
        </div>
        <p className="filenexus-brand text-xs! uppercase tracking-[0.4em] opacity-60">
          FileNexus System Documentation v2.2
        </p>
      </m.div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl mx-auto pb-20">
        
        {/* Feature Card: Upload */}
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          onClick={() => handleAction('upload')}
          className="glass-card p-8 group cursor-pointer hover:border-quantum-cyan/40 transition-all duration-500"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-4 flex-1">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-50 dark:bg-quantum-cyan/10 rounded-xl border border-cyan-200 dark:border-quantum-cyan/20">
                  <FileUp className="w-5 h-5 text-cyan-600 dark:text-quantum-cyan" />
                </div>
                <h2 className="text-xl font-black text-gray-800 dark:text-white/90">高頻檔案傳輸</h2>
              </div>
              <ul className="space-y-3 text-gray-600 dark:text-white/50 text-sm font-medium">
                <li className="flex items-start gap-2">
                  <span className="text-quantum-cyan">#</span>
                  支援主串流協議，單一物件上限 10GB
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-quantum-cyan">#</span>
                  整合 TUS 斷點續傳，即使網路中斷也能無縫恢復
                </li>
                <li className="flex items-start gap-2 group-hover:text-quantum-cyan transition-colors">
                  <span className="text-quantum-cyan">#</span>
                  點擊此處立即進入傳輸控制台
                </li>
              </ul>
            </div>
            <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-40 transition-opacity" />
          </div>
        </m.div>

        {/* Feature Card: Notes */}
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          onClick={() => handleAction('note')}
          className="glass-card p-8 group cursor-pointer hover:border-neural-violet/40 transition-all duration-500"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-4 flex-1">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-50 dark:bg-neural-violet/10 rounded-xl border border-violet-200 dark:border-neural-violet/20">
                  <Zap className="w-5 h-5 text-violet-600 dark:text-neural-violet" />
                </div>
                <h2 className="text-xl font-black text-gray-800 dark:text-white/90">冷數據筆記</h2>
              </div>
              <ul className="space-y-3 text-gray-600 dark:text-white/50 text-sm font-medium">
                <li className="flex items-start gap-2">
                  <span className="text-neural-violet">#</span>
                  具備加密雜湊保護的文字筆記與網址索引
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-neural-violet">#</span>
                  筆記內容為永久性存儲，不參與自動清除機制
                </li>
                <li className="flex items-start gap-2 group-hover:text-neural-violet transition-colors">
                  <span className="text-neural-violet">#</span>
                  立即前往建立您的第一個加密筆記
                </li>
              </ul>
            </div>
            <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-40 transition-opacity" />
          </div>
        </m.div>

        {/* Feature Card: Lifecycle */}
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="glass-card p-8 space-y-4 border-amber-500/10"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-50 dark:bg-amber-500/10 rounded-xl border border-amber-200 dark:border-amber-500/20">
              <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
            </div>
            <h2 className="text-xl font-black text-gray-800 dark:text-white/90">生命週期管理</h2>
          </div>
          <ul className="space-y-3 text-gray-600 dark:text-white/50 text-sm font-medium">
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              實體檔案留存週期為 30 個自然日，逾期自動清除
            </li>
            <li className="flex items-start gap-2 text-amber-500/80">
              <span className="text-amber-500">•</span>
              系統將於檔案卡片右上方顯示倒數計時器
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-500">•</span>
              重要數據請務必於效期內完成回寫或備份
            </li>
          </ul>
        </m.div>

        {/* Feature Card: Security */}
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.3 }}
          className="glass-card p-8 space-y-4 border-emerald-500/10"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-50 dark:bg-green-500/10 rounded-xl border border-emerald-200 dark:border-green-500/20">
              <Lock className="w-5 h-5 text-emerald-600 dark:text-green-400" />
            </div>
            <h2 className="text-xl font-black text-gray-800 dark:text-white/90">權限與隱私</h2>
          </div>
          <ul className="space-y-3 text-gray-600 dark:text-white/50 text-sm font-medium">
            <li className="flex items-start gap-2">
              <span className="text-emerald-500">•</span>
              使用者目錄具備獨立密碼屏障
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500">•</span>
              支援顆粒化鎖定，可對個別檔案進行二次加密
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-500">•</span>
              不建議共享主密碼，如有需求請使用「分享連結」功能
            </li>
          </ul>
        </m.div>

        {/* Feature Card: Share */}
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="glass-card p-8 space-y-4 border-blue-500/10"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 dark:bg-blue-500/10 rounded-xl border border-blue-200 dark:border-blue-500/20">
              <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <h2 className="text-xl font-black text-gray-800 dark:text-white/90">動態分享機制</h2>
          </div>
          <ul className="space-y-3 text-gray-600 dark:text-white/50 text-sm font-medium">
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              產生的臨時下載連結有效期限為 24 小時
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              支援 Social Meta 預覽，連結貼上自動顯示摘要
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500">•</span>
              自動產生對應 QR Code，便於跨端設備快速存取
            </li>
          </ul>
        </m.div>

        {/* Feature Card: Access */}
        <m.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.5 }}
          onClick={() => handleAction('directory')}
          className="glass-card p-8 group cursor-pointer hover:border-rose-500/40 transition-all duration-500"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-4 flex-1">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-50 dark:bg-rose-500/10 rounded-xl border border-rose-200 dark:border-rose-500/20">
                  <Users className="w-5 h-5 text-rose-600 dark:text-rose-400" />
                </div>
                <h2 className="text-xl font-black text-gray-800 dark:text-white/90">公開節點目錄</h2>
              </div>
              <ul className="space-y-3 text-gray-600 dark:text-white/50 text-sm font-medium">
                <li className="flex items-start gap-2">
                  <span className="text-rose-500">#</span>
                  透過右側側邊欄可快速切換至其他公開目錄
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-rose-500">#</span>
                  解除鎖定後可管理該目錄下的所有權限項目
                </li>
                <li className="flex items-start gap-2 group-hover:text-rose-500 transition-colors">
                  <span className="text-rose-500">#</span>
                  點擊展開公開節點清單
                </li>
              </ul>
            </div>
            <ExternalLink className="w-4 h-4 opacity-0 group-hover:opacity-40 transition-opacity" />
          </div>
        </m.div>

      </div>

      {/* Footer Note */}
      <m.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="text-center mt-12 mb-20 text-gray-400 dark:text-white/20 text-xs uppercase tracking-[0.4em] font-bold"
      >
        <div className="flex items-center justify-center gap-3 mb-2">
          <div className="h-px w-8 bg-current opacity-20" />
          <Cpu className="w-4 h-4 opacity-50" />
          <div className="h-px w-8 bg-current opacity-20" />
        </div>
        <span className="filenexus-brand text-xs! tracking-[0.3em] uppercase inline-block">FileNexus</span>
        <span className="mx-2">Autonomous Hub</span>
      </m.div>
    </div>
  );
};
