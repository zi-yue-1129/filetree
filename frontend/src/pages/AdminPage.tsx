import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, Terminal, Activity, UserPlus, ChevronLeft, ShieldCheck, KeyRound, Save, X, Edit3, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { NotFoundPage } from './NotFoundPage';
import { apiUrl, wsUrl as buildWsUrl } from '../services/api';

export const AdminPage: React.FC = () => {
  const [masterKey, setMasterKey] = useState('');
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [isExternalBlocked, setIsExternalBlocked] = useState(false);
  const [formData, setFormData] = useState({ username: '', folder: '' });
  const [status, setStatus] = useState<{ type: 'info' | 'error' | 'success', msg: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  interface User {
    username: string;
    folder: string;
    is_locked: boolean;
    first_login: boolean;
    data_retention_days?: number;
    show_in_list?: boolean;
  }

  interface AuditLog {
    timestamp: string;
    username: string;
    action: string;
    details: string;
    level: string;
    ip?: string;
  }



  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [activeTab, setActiveTab] = useState<'users' | 'logs'>('users');

  // Inline editing states (RESTORED)
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [resettingPwdUser, setResettingPwdUser] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  
  // Extra settings editing
  const [editingSettingsUser, setEditingSettingsUser] = useState<string | null>(null);
  const [editRetention, setEditRetention] = useState<string>('');
  const [editShowInList, setEditShowInList] = useState<boolean>(true);

  const fetchUsers = React.useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/admin/users?master_key=${masterKey}`));
      if (res.ok) {
        const data = await res.json();
        setUsers(data);
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  }, [masterKey]);

  const fetchLogs = React.useCallback(async () => {
    try {
      const res = await fetch(apiUrl(`/api/admin/audit-logs?master_key=${masterKey}`));
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error('Failed to fetch logs:', err);
    }
  }, [masterKey]);



  React.useEffect(() => {
    if (isAuthorized) {
      fetchUsers();
      fetchLogs();
      const interval = setInterval(() => {
        fetchLogs();
      }, 5000);
      
      // WebSocket for realtime user list updates
      // Direct endpoint on app.py to bypass router issues
      const wsUrl = buildWsUrl('/ws/global');
      const socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('Admin: Connected to global WS');
      };

      socket.onmessage = (event) => {
        if (event.data === 'USER_LIST_UPDATE') {
          fetchUsers();
        }
      };

      socket.onclose = () => {
        console.log('Admin: Global WS closed');
      };
      
      return () => {
        clearInterval(interval);
        socket.close();
      };
    }
  }, [isAuthorized, fetchUsers, fetchLogs]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(apiUrl(`/api/admin/verify?master_key=${masterKey}`));
      if (res.ok) {
        setIsAuthorized(true);
        setStatus({ type: 'success', msg: '矩陣權限已確認。指揮系統上線。' });
      } else if (res.status === 418) {
        // External network blocked
        setIsExternalBlocked(true);
      } else {
        const err = await res.json();
        setStatus({ type: 'error', msg: err.detail || '權限驗證失敗：無效的主金鑰。' });
      }
    } catch (err) {
      console.error('Matrix Auth Error:', err);
      setStatus({ type: 'error', msg: '連結中斷：無法存取核心驗證伺服器。' });
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSyncing(true);
    setStatus(null);

    try {
      const body = new FormData();
      body.append('master_key', masterKey);
      body.append('username', formData.username);
      // Password now defaults to username on backend
      if (formData.folder) body.append('folder', formData.folder);

      const res = await fetch(apiUrl('/api/admin/create-user'), {
        method: 'POST',
        body
      });
      const result = await res.json();

      if (res.ok) {
        setStatus({ type: 'success', msg: `節點建立成功：${formData.username} 已加入網格。` });
        setFormData({ username: '', folder: '' });
        fetchUsers();
      } else {
        setStatus({ type: 'error', msg: result.detail || '建立失敗：核心邏輯衝突。' });
      }
    } catch (err) {
      console.error('Deployment Error:', err);
      setStatus({ type: 'error', msg: '系統錯誤：數據流寫入中斷。' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUpdateUsername = async (oldName: string) => {
    if (!editName || editName === oldName) {
      setEditingUser(null);
      return;
    }

    setIsSyncing(true);
    try {
      const body = new FormData();
      body.append('master_key', masterKey);
      body.append('username', oldName);
      body.append('new_username', editName);

      const res = await fetch(apiUrl('/api/admin/update-user'), {
        method: 'POST',
        body
      });

      if (res.ok) {
        setStatus({ type: 'success', msg: `節點 ${oldName} 已重命名為 ${editName}` });
        setEditingUser(null);
        fetchUsers();
      } else {
        const err = await res.json();
        setStatus({ type: 'error', msg: err.detail || '重新命名失敗。' });
      }
    } catch {
      setStatus({ type: 'error', msg: '網路連線失敗。' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleUpdateSettings = async (username: string) => {
    setIsSyncing(true);
    try {
        const body = new FormData();
        body.append('master_key', masterKey);
        body.append('username', username);
        
        // Handle retention: empty string -> -1 (reset to default in backend)
        const retentionParam = editRetention.trim() === '' ? '-1' : editRetention;
        body.append('data_retention_days', retentionParam);
        
        body.append('show_in_list', String(editShowInList));

        const res = await fetch(apiUrl('/api/admin/update-user'), {
            method: 'POST',
            body
        });

        if (res.ok) {
            setStatus({ type: 'success', msg: `節點 ${username} 設定已更新` });
            setEditingSettingsUser(null);
            fetchUsers();
        } else {
            const err = await res.json();
            setStatus({ type: 'error', msg: err.detail || '設定更新失敗。' });
        }
    } catch {
        setStatus({ type: 'error', msg: '網路連線失敗。' });
    } finally {
        setIsSyncing(false);
    }
  };

  const handleResetPassword = async (username: string) => {
    if (!newPwd) return;

    setIsSyncing(true);
    try {
      const body = new FormData();
      body.append('master_key', masterKey);
      body.append('username', username);
      body.append('new_password', newPwd);

      const res = await fetch(apiUrl('/api/admin/reset-password'), {
        method: 'POST',
        body
      });

      if (res.ok) {
        setStatus({ type: 'success', msg: `節點 ${username} 的密鑰已重新產生。` });
        setResettingPwdUser(null);
        setNewPwd('');
      } else {
        const err = await res.json();
        setStatus({ type: 'error', msg: err.detail || '密鑰更新失敗。' });
      }
    } catch {
      setStatus({ type: 'error', msg: '系統錯誤：密鑰流寫入中斷。' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResetToDefault = async (username: string) => {
    if (!confirm(`確定要將 ${username} 的密碼重設為與帳號名稱相同嗎？`)) return;

    setIsSyncing(true);
    try {
      const body = new FormData();
      body.append('master_key', masterKey);
      body.append('username', username);

      const res = await fetch(apiUrl('/api/admin/reset-default-password'), {
        method: 'POST',
        body
      });

      if (res.ok) {
        setStatus({ type: 'success', msg: `節點 ${username} 已重置為預設密鑰。` });
        fetchUsers();
      } else {
        const err = await res.json();
        setStatus({ type: 'error', msg: err.detail || '重置失敗。' });
      }
    } catch {
      setStatus({ type: 'error', msg: '系統錯誤。' });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeleteUser = async (username: string) => {
    if (!confirm(`警告：確定要刪除節點 ${username} 及其所有數據嗎？此操作不可逆！`)) return;

    setIsSyncing(true);
    try {
      const body = new FormData();
      body.append('master_key', masterKey);
      body.append('username', username);

      const res = await fetch(apiUrl('/api/admin/delete-user'), {
        method: 'POST', // Backend uses POST for this as per my implementation above
        body
      });

      if (res.ok) {
        setStatus({ type: 'success', msg: `節點 ${username} 已從網格中完全抹除。` });
        fetchUsers();
      } else {
        const err = await res.json();
        setStatus({ type: 'error', msg: err.detail || '刪除失敗。' });
      }
    } catch {
      setStatus({ type: 'error', msg: '系統錯誤。' });
    } finally {
      setIsSyncing(false);
    }
  };

  // External network access - show 404 meme page
  if (isExternalBlocked) {
    return <NotFoundPage />;
  }

  if (!isAuthorized) {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 bg-transparent">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card-premium p-12 w-full max-w-md space-y-8 relative z-10 rounded-3xl"
        >
          <div className="text-center space-y-4">
            <ShieldAlert className="w-16 h-16 text-violet-600 dark:text-neural-violet mx-auto animate-pulse" />
            <h1 className="text-3xl font-bold tracking-tighter text-gray-900 dark:text-white">CORE AUTHORITY</h1>
            <p className="text-gray-500 dark:text-white/40 text-xs uppercase tracking-widest font-bold">請輸入授權主金鑰以進入矩陣</p>
          </div>

          <form onSubmit={handleVerify} className="space-y-6">
            <input
              type="password"
              placeholder="MASTER KEY"
              value={masterKey}
              onChange={(e) => setMasterKey(e.target.value)}
              className="w-full bg-gray-100 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-2xl px-6 py-4 outline-none focus:border-violet-500 dark:focus:border-neural-violet transition-all text-center tracking-widest font-mono text-gray-900 dark:text-white"
            />
            <button className="btn-stellar w-full py-4 bg-violet-100 dark:bg-neural-violet/10 border-violet-300 dark:border-neural-violet/30 text-violet-700 dark:text-neural-violet uppercase font-black tracking-widest">
              啟動授權
            </button>
          </form>

          {status && (
            <p className={cn("text-center text-xs font-bold uppercase tracking-widest", status.type === 'error' ? "text-red-400" : "text-green-400")}>
              {status.msg}
            </p>
          )}
        </motion.div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen p-[clamp(1rem,3vw,2rem)] sm:p-[clamp(1.5rem,4vw,3rem)] space-y-[clamp(1.5rem,4vh,3rem)] overflow-hidden bg-transparent">

      {/* Background Ambient Elements */}
      <div className="absolute top-1/4 -left-20 w-[60vw] h-[50vh] fx-glow text-quantum-cyan/5 -z-10" />
      <div className="absolute bottom-1/4 -right-20 w-[80vw] h-[60vh] fx-glow text-neural-violet/5 -z-10" />

      {/* Admin Header */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 relative z-10 max-w-10xl mx-auto">
        <a href="/" className="flex items-center gap-2 text-gray-500 dark:text-white/40 hover:text-cyan-600 dark:hover:text-quantum-cyan transition-all uppercase text-[clamp(0.6rem,0.9vw,0.8rem)] tracking-[0.3em] font-bold group">
          <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5 group-hover:-translate-x-2 transition-transform" />
          <span>回歸核心樞紐</span>
        </a>
        <div className="flex items-center gap-3 sm:gap-6 px-4 sm:px-6 py-2 sm:py-2.5 glass-card text-[clamp(0.45rem,0.75vw,0.7rem)] tracking-[0.2em] sm:tracking-[0.3em] uppercase font-black text-green-600 dark:text-green-400 border-green-200 dark:border-green-500/20 shadow-lg">
          <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5 animate-pulse shrink-0" /> 矩陣維護者憑證：ACTIVE
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-[clamp(1rem,3vw,3rem)] relative z-10 max-w-10xl mx-auto">
        <div className="lg:col-span-8 xl:col-span-9 space-y-[clamp(1rem,2.5vh,2.5rem)]">
          {/* Create User Form Section */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-[clamp(1.25rem,3.5vw,3rem)] space-y-[clamp(1.25rem,3.5vh,2.5rem)] relative overflow-hidden group"
          >
            <div className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-cyan-500 dark:via-quantum-cyan to-transparent opacity-30" />

            <div className="flex items-center gap-4">
              <div className="p-[clamp(0.75rem,2vw,1.25rem)] bg-cyan-50 dark:bg-quantum-cyan/5 rounded-2xl border border-cyan-100 dark:border-quantum-cyan/20 shadow-xl shrink-0">
                <UserPlus className="w-[clamp(1.5rem,3vw,2.5rem)] h-[clamp(1.5rem,3vw,2.5rem)] text-cyan-600 dark:text-quantum-cyan" />
              </div>
              <div>
                <h2 className="text-[clamp(1.5rem,3vw,2.5rem)] font-bold text-gray-900 dark:text-white tracking-tighter leading-tight">部署新數據節點</h2>
                <p className="text-cyan-600/60 dark:text-quantum-cyan/40 text-[clamp(0.45rem,0.75vw,0.7rem)] uppercase tracking-[0.3em] font-bold">DEPLOYMENT CONTROL UNIT</p>
              </div>
            </div>

            <form onSubmit={handleCreateUser} className="grid grid-cols-1 sm:grid-cols-2 gap-[clamp(1rem,2.5vw,2rem)]">
              <div className="space-y-2">
                <label className="text-[9px] sm:text-[10px] font-black text-cyan-700 dark:text-stellar-label uppercase tracking-[0.3em] ml-2 opacity-60">Username / Node ID</label>
                <input
                  required
                  placeholder="輸入節點代碼 (例如: pilot_01)"
                  value={formData.username}
                  onChange={(e) => setFormData(p => ({ ...p, username: e.target.value }))}
                  className="w-full bg-gray-100 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-5 py-3.5 sm:py-4 outline-none focus:border-cyan-500 dark:focus:border-quantum-cyan focus:bg-gray-50 dark:focus:bg-white/10 transition-all text-gray-900 dark:text-white text-sm sm:text-base font-medium"
                />
              </div>

              <div className="sm:col-span-2 space-y-2">
                <label className="text-[9px] sm:text-[10px] font-black text-cyan-700 dark:text-stellar-label uppercase tracking-[0.3em] ml-2 opacity-60">Storage Sector (Optional)</label>
                <input
                  placeholder="檔案儲存路徑 (預設為名稱)"
                  value={formData.folder}
                  onChange={(e) => setFormData(p => ({ ...p, folder: e.target.value }))}
                  className="w-full bg-gray-100 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-xl px-5 py-3.5 sm:py-4 outline-none focus:border-cyan-500 dark:focus:border-quantum-cyan focus:bg-gray-50 dark:focus:bg-white/10 transition-all text-gray-900 dark:text-white text-sm sm:text-base font-medium font-mono"
                />
              </div>
              <button
                disabled={isSyncing}
                className="sm:col-span-2 btn-stellar py-4 sm:py-5 bg-cyan-100 dark:bg-quantum-cyan/10 border-cyan-300 dark:border-quantum-cyan/30 text-gray-900 dark:text-white font-black uppercase tracking-[clamp(0.2em,1vw,0.5em)] text-sm sm:text-base hover:bg-cyan-200 dark:hover:bg-quantum-cyan/20 shadow-xl transition-all"
              >
                {isSyncing ? '同步數據中...' : '確認節點部署'}
              </button>
            </form>

            <AnimatePresence>
              {status && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className={cn("p-4 rounded-2xl border text-center text-[10px] sm:text-xs font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3",
                    status.type === 'error' ? "bg-red-100 dark:bg-red-500/10 border-red-300 dark:border-red-500/20 text-red-700 dark:text-red-100" : "bg-green-100 dark:bg-green-500/10 border-green-300 dark:border-green-500/20 text-green-700 dark:text-green-100 shadow-lg")}
                >
                  <Activity className={cn("w-4 h-4 sm:w-5 sm:h-5", status.type === 'error' ? "text-red-400" : "text-green-400 animate-pulse")} />
                  {status.msg}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>

          {/* Tab Navigation */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={() => setActiveTab('users')}
              className={cn(
                "px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all border",
                activeTab === 'users' ? "bg-cyan-100 dark:bg-quantum-cyan/20 border-cyan-300 dark:border-quantum-cyan/40 text-cyan-700 dark:text-quantum-cyan shadow-lg shadow-cyan-100 dark:shadow-quantum-cyan/10" : "bg-gray-100 dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-500 dark:text-white/30 hover:text-gray-700 dark:hover:text-white/60"
              )}
            >
              使用者節點管理
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={cn(
                "px-6 py-3 rounded-xl font-black uppercase tracking-widest text-xs transition-all border",
                activeTab === 'logs' ? "bg-violet-100 dark:bg-neural-violet/20 border-violet-300 dark:border-neural-violet/40 text-violet-700 dark:text-neural-violet shadow-lg shadow-violet-100 dark:shadow-neural-violet/10" : "bg-gray-100 dark:bg-white/5 border-gray-300 dark:border-white/10 text-gray-500 dark:text-white/30 hover:text-gray-700 dark:hover:text-white/60"
              )}
            >
              系統審計日誌
            </button>
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'users' ? (
              <motion.div
                key="users-tab"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="glass-card p-[clamp(1.25rem,3.5vw,3rem)] space-y-6"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">數據節點目錄</h3>
                    <p className="text-gray-500 dark:text-white/30 text-[10px] uppercase tracking-[0.3em] font-bold italic">DATA NEXUS NODE DIRECTORY</p>
                  </div>
                  <button onClick={fetchUsers} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors group">
                    <Activity className="w-5 h-5 text-cyan-600 dark:text-quantum-cyan group-hover:rotate-180 transition-transform duration-500" />
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-white/2">
                  <div className="max-h-[clamp(15rem,40vh,30rem)] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-[#0A0A0F] z-20">
                        <tr className="border-b border-gray-200 dark:border-white/10">
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">節點狀態 / 代碼</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em] hidden sm:table-cell">存取扇區</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em] hidden md:table-cell">保留策略</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em] hidden md:table-cell">公開索引</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em] text-right">管理指令</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-white/5">
                        {users.map((user) => (
                          <tr key={user.username} className="group hover:bg-gray-100 dark:hover:bg-white/3 transition-colors">
                            <td className="px-6 py-5">
                              {editingUser === user.username ? (
                                <div className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2">
                                  <input
                                    autoFocus
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateUsername(user.username)}
                                    className="bg-gray-100 dark:bg-white/10 border border-cyan-300 dark:border-quantum-cyan/30 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none w-40"
                                  />
                                  <button onClick={() => handleUpdateUsername(user.username)} className="p-1.5 bg-cyan-100 dark:bg-quantum-cyan/20 text-cyan-700 dark:text-quantum-cyan rounded-md hover:bg-cyan-200 dark:hover:bg-quantum-cyan/30 transition-colors">
                                    <Save className="w-4 h-4" />
                                  </button>
                                  <button onClick={() => setEditingUser(null)} className="p-1.5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/40 rounded-md hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                                    <X className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-4">
                                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                                  <span className="text-gray-900 dark:text-white font-bold text-base tracking-tight">{user.username}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-5 hidden sm:table-cell">
                              <div className="flex items-center gap-2 text-gray-500 dark:text-white/30 font-mono text-xs">
                                <Terminal className="w-3.5 h-3.5 opacity-50" />
                                <span>/uploads/{user.folder}</span>
                              </div>
                            </td>
                              <td className="px-6 py-5 hidden md:table-cell">
                                {editingSettingsUser === user.username ? (
                                    <input 
                                        type="number" 
                                        placeholder="Default"
                                        value={editRetention}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val === '' || val === '-1' || parseInt(val) >= 0) {
                                                setEditRetention(val);
                                            }
                                        }}
                                        min="-1"
                                        className="w-20 bg-gray-100 dark:bg-white/10 border border-cyan-300 dark:border-quantum-cyan/30 rounded px-2 py-1 text-xs text-gray-900 dark:text-white outline-none"
                                    />
                                ) : (
                                    <span className="text-gray-500 dark:text-white/40 text-xs font-mono">
                                        {user.data_retention_days ?? 'System Default'} Days
                                    </span>
                                )}
                              </td>
                              <td className="px-6 py-5 hidden md:table-cell">
                                {editingSettingsUser === user.username ? (
                                    <button 
                                        onClick={() => setEditShowInList(!editShowInList)}
                                        className={cn(
                                            "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-colors",
                                            editShowInList ? "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-400" : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-white/40"
                                        )}
                                    >
                                        {editShowInList ? "VISIBLE" : "HIDDEN"}
                                    </button>
                                ) : (
                                    <span className={cn(
                                        "text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded",
                                        user.show_in_list !== false ? "bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400" : "bg-gray-100 dark:bg-white/5 text-gray-400 dark:text-white/30"
                                    )}>
                                        {user.show_in_list !== false ? "VISIBLE" : "HIDDEN"}
                                    </span>
                                )}
                              </td>
                            <td className="px-6 py-5">
                              <div className="flex items-center justify-end gap-2">
                                {editingSettingsUser === user.username ? (
                                      <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                                          <button onClick={() => handleUpdateSettings(user.username)} className="p-1.5 bg-cyan-100 dark:bg-quantum-cyan/20 text-cyan-700 dark:text-quantum-cyan rounded-md hover:bg-cyan-200 dark:hover:bg-quantum-cyan/30 transition-colors">
                                            <Save className="w-4 h-4" />
                                          </button>
                                          <button onClick={() => setEditingSettingsUser(null)} className="p-1.5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/40 rounded-md hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                                            <X className="w-4 h-4" />
                                          </button>
                                      </div>
                                ) : resettingPwdUser === user.username ? (
                                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-right-2">
                                    <input
                                      autoFocus
                                      type="password"
                                      placeholder="新金鑰"
                                      value={newPwd}
                                      onChange={(e) => setNewPwd(e.target.value)}
                                      onKeyDown={(e) => e.key === 'Enter' && handleResetPassword(user.username)}
                                      className="bg-gray-100 dark:bg-white/10 border border-violet-300 dark:border-neural-violet/30 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-white outline-none w-32"
                                    />
                                    <button onClick={() => handleResetPassword(user.username)} className="p-1.5 bg-violet-100 dark:bg-neural-violet/20 text-violet-700 dark:text-neural-violet rounded-md hover:bg-violet-200 dark:hover:bg-neural-violet/30 transition-colors">
                                      <Save className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setResettingPwdUser(null)} className="p-1.5 bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-white/40 rounded-md hover:bg-gray-200 dark:hover:bg-white/10 transition-colors">
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <button
                                        onClick={() => { 
                                            setEditingSettingsUser(user.username); 
                                            setEditRetention(user.data_retention_days?.toString() || ''); 
                                            setEditShowInList(user.show_in_list ?? true);
                                        }}
                                        className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-white/60 hover:border-cyan-500 dark:hover:border-quantum-cyan hover:text-cyan-700 dark:hover:text-quantum-cyan hover:bg-cyan-50 dark:hover:bg-quantum-cyan/5 transition-all flex items-center gap-2 group/btn"
                                      >
                                        <Edit3 className="w-3.5 h-3.5 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                        <span>設定</span>
                                      </button>
                                    <button
                                      onClick={() => { setEditingUser(user.username); setEditName(user.username); }}
                                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-white/60 hover:border-cyan-500 dark:hover:border-quantum-cyan hover:text-cyan-700 dark:hover:text-quantum-cyan hover:bg-cyan-50 dark:hover:bg-quantum-cyan/5 transition-all flex items-center gap-2 group/btn"
                                    >
                                      <Edit3 className="w-3.5 h-3.5 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                      <span>改名</span>
                                    </button>
                                    <button
                                      onClick={() => handleResetToDefault(user.username)}
                                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-white/60 hover:border-cyan-500 dark:hover:border-quantum-cyan hover:text-cyan-700 dark:hover:text-quantum-cyan hover:bg-cyan-50 dark:hover:bg-quantum-cyan/5 transition-all flex items-center gap-2 group/btn"
                                      title="重設為預設密碼"
                                    >
                                      <Activity className="w-3.5 h-3.5 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                      <span>重置</span>
                                    </button>
                                    <button
                                      onClick={() => { setResettingPwdUser(user.username); setNewPwd(''); }}
                                      className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-white/10 bg-gray-100 dark:bg-white/5 text-[10px] font-black uppercase tracking-widest text-gray-600 dark:text-white/60 hover:border-violet-500 dark:hover:border-neural-violet hover:text-violet-700 dark:hover:text-neural-violet hover:bg-violet-50 dark:hover:bg-neural-violet/5 transition-all flex items-center gap-2 group/btn"
                                    >
                                      <KeyRound className="w-3.5 h-3.5 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                      <span>改密</span>
                                    </button>
                                    <button
                                      onClick={() => handleDeleteUser(user.username)}
                                      className="px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/5 text-[10px] font-black uppercase tracking-widest text-red-400/60 hover:border-red-500 hover:text-red-500 hover:bg-red-500/10 transition-all flex items-center gap-2 group/btn"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                                      <span>刪除</span>
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="logs-tab"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="glass-card p-[clamp(1.25rem,3.5vw,3rem)] space-y-6 min-h-[50vh]"
              >
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white tracking-tight">系統安全審計</h3>
                    <p className="text-gray-500 dark:text-white/30 text-[10px] uppercase tracking-[0.3em] font-bold italic">SYSTEM SECURITY AUDIT STREAM</p>
                  </div>
                  <button onClick={fetchLogs} className="p-2 hover:bg-gray-100 dark:hover:bg-white/5 rounded-lg transition-colors group">
                    <Activity className="w-5 h-5 text-violet-600 dark:text-neural-violet group-hover:rotate-180 transition-transform duration-500" />
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-white/2">
                  <div className="max-h-[clamp(20rem,50vh,40rem)] overflow-y-auto custom-scrollbar">
                    <table className="w-full text-left border-collapse">
                      <thead className="sticky top-0 bg-gray-50 dark:bg-[#0A0A0F] z-20">
                        <tr className="border-b border-gray-200 dark:border-white/10">
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">時間戳記</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">主體節點</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">來源 IP</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">執行動作</th>
                          <th className="px-6 py-5 text-[10px] font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.2em]">詳細紀錄</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-white/5 font-mono">
                        {logs.length === 0 ? (
                          <tr><td colSpan={5} className="px-6 py-20 text-center text-gray-400 dark:text-white/20 uppercase tracking-[0.3em] text-xs">尚無相關安全性日誌</td></tr>
                        ) : logs.map((log, idx) => (
                          <tr key={idx} className="hover:bg-gray-100 dark:hover:bg-white/3 transition-colors text-[clamp(0.6rem,0.8vw,0.75rem)] whitespace-nowrap">
                            <td className="px-6 py-4 text-gray-500 dark:text-white/40">{new Date(log.timestamp).toLocaleString()}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-0.5 rounded-sm font-bold",
                                log.username === 'admin' ? "bg-cyan-100 dark:bg-quantum-cyan/10 text-cyan-700 dark:text-quantum-cyan" : "bg-gray-200 dark:bg-white/10 text-gray-600 dark:text-white/60"
                              )}>
                                {log.username}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-gray-500 dark:text-white/30 font-mono text-[10px]">{log.ip || '---'}</span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "font-black",
                                log.level === 'ERROR' ? "text-red-400" : log.level === 'WARNING' ? "text-yellow-400" : "text-green-400"
                              )}>
                                {log.action}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-gray-600 dark:text-white/60 max-w-xs truncate" title={log.details}>{log.details}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div >

        {/* Sidebar Status */}
        < div className="lg:col-span-4 xl:col-span-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-[clamp(1rem,2.5vw,2.5rem)]" >
          {/* R2 Usage Widget */}


          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-card p-6 space-y-4 shadow-xl"
          >
            <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.4em] flex items-center gap-2 border-b border-gray-200 dark:border-white/5 pb-3">
              <Activity className="w-4 h-4 text-violet-600 dark:text-neural-violet animate-pulse" /> 矩陣脈動
            </h3>
            <div className="space-y-4">
              {[
                { label: '核心節點狀態', val: 'SYNCHRONIZED', color: 'text-cyan-600 dark:text-quantum-cyan' },
                { label: '活躍連接數', val: users.length.toString(), color: 'text-green-600 dark:text-green-400' },
                { label: '安全協定', val: 'AES-SHA-MATRIX', color: 'text-violet-600 dark:text-neural-violet' },
              ].map((item, i) => (
                <div key={i} className="space-y-1">
                  <span className="text-[10px] tracking-[0.2em] uppercase text-gray-500 dark:text-white/40 font-bold">{item.label}</span>
                  <div className={cn("text-lg font-black tracking-tight", item.color)}>{item.val}</div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 }}
            className="glass-card p-6 space-y-4 shadow-xl"
          >
            <h3 className="text-xs font-black text-gray-500 dark:text-white/40 uppercase tracking-[0.4em] flex items-center gap-2 border-b border-gray-200 dark:border-white/5 pb-3">
              <Terminal className="w-4 h-4 text-cyan-600 dark:text-quantum-cyan" /> 系統日誌
            </h3>
            <div className="text-[10px] font-mono text-gray-600 dark:text-white/60 space-y-3 max-h-64 overflow-y-auto custom-scrollbar pr-2">
              <div className="flex gap-2"><span className="text-cyan-600 dark:text-quantum-cyan font-bold">[SYS]</span> <span>管理授權已確認</span></div>
              <div className="flex gap-2"><span className="text-green-600 dark:text-green-400 font-bold">[OK]</span> <span>核心數據庫連線就緒</span></div>
              {users.length > 0 && <div className="flex gap-2 text-gray-700 dark:text-white/80"><span className="text-gray-500 dark:text-white/40 font-bold">[LOG]</span> <span>偵測到 {users.length} 個活躍數據節點</span></div>}
              {logs.slice(0, 5).map((log, i) => (
                <div key={i} className="flex gap-2 opacity-80 border-t border-gray-200 dark:border-white/5 pt-2 animate-in fade-in slide-in-from-right-2 duration-500">
                  <span className={cn(
                    "font-bold shrink-0",
                    log.level === 'ERROR' ? "text-red-400" : log.level === 'WARNING' ? "text-yellow-400" : "text-green-400"
                  )}>[{log.action.split('_')[0]}]</span>
                  <span className="truncate" title={log.details}>{log.details}</span>
                </div>
              ))}
            </div>
          </motion.div>
        </div >
      </div >
    </div >
  );
};
