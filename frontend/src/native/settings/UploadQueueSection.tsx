/**
 * Native upload queue with progress/cancel, plus share-sheet items waiting
 * for the device to be signed in.
 */
import React, { useState } from 'react';
import { ListChecks, X } from 'lucide-react';
import { FileNexusNative, enqueueNativeUpload, getErrorMessage } from '../index';
import { useNativeUploads, useSharedItems } from '../hooks';
import { UPLOAD_STATE_LABEL, isActiveUploadState, uploadPercent } from '../uploadJobs';
import { formatBytes } from './format';
import { ActionButton, Message, SettingsSection } from './ui';


/** Props of {@link UploadQueueSection}. */
interface UploadQueueSectionProps {
  /** Shared items can only be uploaded once signed in. */
  deviceSignedIn: boolean;
}

/**
 * Upload queue and pending shared items.
 *
 * @param props - Section props.
 * @returns The section.
 */
export const UploadQueueSection: React.FC<UploadQueueSectionProps> = ({ deviceSignedIn }) => {
  const uploads = useNativeUploads();
  const shared = useSharedItems();
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>, context: string): Promise<void> => {
    setError(null);
    try {
      await action();
    } catch (caught: unknown) {
      console.error(context, caught);
      setError(getErrorMessage(caught));
    } finally {
      await Promise.all([uploads.refresh(), shared.refresh()]);
    }
  };

  const sharedItems = shared.data ?? [];
  const jobs = uploads.data ?? [];

  return (
    <SettingsSection icon={ListChecks} title="上傳佇列">
      {sharedItems.length > 0 && (
        <div className="space-y-2">
          <Message tone="info">有 {sharedItems.length} 個從其他 App 分享的檔案等待上傳。</Message>
          <div className="flex flex-wrap gap-2">
            <ActionButton
              variant="primary"
              disabled={!deviceSignedIn}
              onClick={() => void run(() => enqueueNativeUpload(sharedItems), 'Uploading shared items failed')}
            >
              {deviceSignedIn ? '上傳分享的檔案' : '請先登入此裝置'}
            </ActionButton>
            <ActionButton variant="danger" onClick={() => void run(() => FileNexusNative.clearSharedItems(), 'Clearing shared items failed')}>
              捨棄
            </ActionButton>
          </div>
        </div>
      )}
      {uploads.error && <Message tone="error">{uploads.error}</Message>}
      {jobs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-white/40">目前沒有上傳工作。</p>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => {
            const percent = uploadPercent(job.bytesSent, job.bytesTotal);
            const active = isActiveUploadState(job.state);
            return (
              <li key={job.jobId} className="rounded-xl border border-gray-200 dark:border-white/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-white/80 truncate">{job.name}</span>
                  {active && (
                    <button
                      type="button"
                      aria-label={`取消上傳 ${job.name}`}
                      onClick={() => void run(() => FileNexusNative.cancelUpload({ jobId: job.jobId }), 'Cancel upload failed')}
                      className="relative tap-target p-1 rounded-lg hover:bg-red-500/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
                    >
                      <X className="w-4 h-4 text-red-500" />
                    </button>
                  )}
                </div>
                <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full bg-quantum-cyan transition-all" style={{ width: `${percent}%` }} />
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/40">
                  <span>{UPLOAD_STATE_LABEL[job.state]}{job.source === 'backup' ? '・相簿備份' : job.source === 'share' ? '・分享' : ''}</span>
                  <span>{formatBytes(job.bytesSent)} / {formatBytes(job.bytesTotal)}</span>
                </div>
                {job.error && job.state !== 'completed' && <p className="text-xs text-red-500">{job.error}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {jobs.some((job) => job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled') && (
        <ActionButton onClick={() => void run(() => FileNexusNative.clearFinishedUploads(), 'Clearing finished uploads failed')}>
          清除已完成項目
        </ActionButton>
      )}
      {error && <Message tone="error">{error}</Message>}
    </SettingsSection>
  );
};
