import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldCheck } from 'lucide-react';
import { apiUrl } from '../services/api';

interface SecurityInitializationModalProps {
  isOpen: boolean;
  username: string;
  oldPassword: string;
  onSuccess: (newKey: string) => void;
}

export const SecurityInitializationModal: React.FC<SecurityInitializationModalProps> = ({
  isOpen,
  username,
  oldPassword,
  onSuccess
}) => {
  const [newKey, setNewKey] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey) return;

    setIsSyncing(true);
    try {
      const body = new FormData();
      body.append('username', username);
      body.append('old_password', oldPassword);
      body.append('new_password', newKey);

      const res = await fetch(apiUrl('/api/user/change-password'), {
        method: 'POST',
        body
      });

      if (res.ok) {
        onSuccess(newKey);
      } else {
        const result = await res.json();
        alert(result.detail || "密鑰同步失敗");
      }
    } catch (err) {
      console.error(err);
      alert("傳輸通訊中斷");
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-200 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white/95 dark:bg-space-black/95 backdrop-blur-2xl"
          />
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="glass-card p-10 w-full max-w-md relative z-10 space-y-8 border-violet-300 dark:border-neural-violet/30 shadow-[0_0_5rem_rgba(139,92,246,0.2)] dark:shadow-[0_0_5rem_rgba(139,92,246,0.4)]"
          >
            <div className="text-center space-y-3">
              <ShieldCheck className="w-16 h-16 text-violet-600 dark:text-neural-violet mx-auto animate-pulse" />
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tighter">啟動安全性初始化</h2>
              <p className="text-gray-600 dark:text-white/40 text-[0.625rem] uppercase font-black tracking-[0.2em] leading-relaxed">
                偵測到初始訪問或重置狀態，為了確保數據隔離，<br />請立即設定您的專屬傳輸密鑰。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[0.625rem] font-black text-violet-700 dark:text-neural-violet uppercase tracking-widest ml-2">New Security Key / 新密鑰</label>
                <input
                  type="password"
                  required
                  autoFocus
                  disabled={isSyncing}
                  placeholder="輸入新的高強度密鑰..."
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="w-full bg-gray-100 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-violet-500 dark:focus:border-neural-violet focus:bg-gray-50 dark:focus:bg-white/10 transition-all text-gray-900 dark:text-white text-center font-mono tracking-widest placeholder:text-gray-400 dark:placeholder:text-white/30"
                />
              </div>
              <button
                type="submit"
                disabled={isSyncing}
                className="btn-stellar w-full py-5 bg-violet-100 dark:bg-neural-violet/20 border-violet-300 dark:border-neural-violet/40 text-violet-700 dark:text-neural-violet uppercase text-sm font-black tracking-[0.4em] hover:bg-violet-200 dark:hover:bg-neural-violet/30 group disabled:opacity-50"
              >
                {isSyncing ? "部署中..." : "確認更新密鑰"}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
