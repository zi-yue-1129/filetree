/**
 * Native-only Settings page (`/settings`): server URL, device login, photo
 * backup, upload queue, versions and updates.
 */
import React from 'react';
import { motion } from 'framer-motion';
import { Settings } from 'lucide-react';
import { useNativeConfiguration } from '../hooks';
import { isMobileNative } from '../index';
import { BackupSection } from './BackupSection';
import { DeviceSection } from './DeviceSection';
import { ServerSection } from './ServerSection';
import { UpdateSection } from './UpdateSection';
import { UploadQueueSection } from './UploadQueueSection';
import { Message } from './ui';

/**
 * Settings page for the Android/iOS apps.
 *
 * @returns The page.
 */
export const SettingsPage: React.FC = () => {
  const config = useNativeConfiguration();
  const signedIn = Boolean(config.data?.deviceToken);

  if (!isMobileNative()) {
    return <Message tone="info">設定頁僅在 FileNexus 手機 App 中提供。</Message>;
  }

  return (
    <div className="relative min-h-[calc(100vh-8rem)] overflow-x-hidden custom-scrollbar">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <div className="flex items-center justify-center gap-4 mb-2">
          <div className="p-3 bg-quantum-cyan/10 rounded-2xl border border-quantum-cyan/20">
            <Settings className="w-8 h-8 text-cyan-600 dark:text-quantum-cyan" />
          </div>
          <h1 className="text-4xl font-black text-gray-900 dark:text-white/90 tracking-tighter">
            App <span className="text-quantum-cyan">設定</span>
          </h1>
        </div>
      </motion.div>
      <div className="max-w-3xl mx-auto space-y-6 pb-20">
        {config.error && <Message tone="error">{config.error}</Message>}
        <DeviceSection config={config.data} onChanged={config.refresh} />
        <UploadQueueSection deviceSignedIn={signedIn} />
        <BackupSection deviceSignedIn={signedIn} />
        <ServerSection deviceSignedIn={signedIn} />
        <UpdateSection />
      </div>
    </div>
  );
};
