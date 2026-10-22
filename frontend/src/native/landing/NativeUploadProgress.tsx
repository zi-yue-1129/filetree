/**
 * Inline progress of native background uploads on the landing page, styled
 * like the web uploader's progress rows in `PendingFilesPanel`.
 *
 * Data comes from the native queue (`useNativeUploads`, the same source as
 * the Settings upload queue); this component only renders it.
 */
import React from 'react';
import { CheckCircle2, FileText, X, XCircle } from 'lucide-react';
import type { UploadJob } from '../index';
import { formatBytes } from '../settings/format';
import { UPLOAD_STATE_LABEL, isActiveUploadState, uploadPercent } from '../uploadJobs';

/** Props of {@link NativeUploadProgress}. */
interface NativeUploadProgressProps {
  /** Jobs started from this page, in submit order. */
  jobs: UploadJob[];
  /** Cancel one job. */
  onCancel: (jobId: string) => void;
  /** Leave the page while uploads continue in the background, if offered. */
  onContinueInBackground?: () => void;
}

/** Text colour per state for the state label. */
const STATE_TONE: Record<UploadJob['state'], string> = {
  queued: 'text-gray-500 dark:text-gray-400',
  uploading: 'text-cyan-600 dark:text-cyan-400',
  retrying: 'text-amber-600 dark:text-amber-400',
  completed: 'text-green-600 dark:text-green-400',
  failed: 'text-red-500',
  cancelled: 'text-gray-500 dark:text-gray-400',
};

/** Props of {@link UploadJobRow}. */
interface UploadJobRowProps {
  /** Job to show. */
  job: UploadJob;
  /** Cancel this job. */
  onCancel: () => void;
}

/**
 * One job: name, cancel, progress bar, percent, bytes and state.
 *
 * @param props - Row props.
 * @returns The row.
 */
const UploadJobRow: React.FC<UploadJobRowProps> = ({ job, onCancel }) => {
  const percent = uploadPercent(job.bytesSent, job.bytesTotal);
  const active = isActiveUploadState(job.state);
  const StateIcon = job.state === 'completed' ? CheckCircle2 : job.state === 'failed' ? XCircle : FileText;
  return (
    <li className="p-3 bg-white/60 dark:bg-white/10 rounded-xl border border-white/20 dark:border-white/5 shadow-sm flex items-center gap-3">
      <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-white/10 flex items-center justify-center shrink-0">
        <StateIcon className={`w-5 h-5 ${job.state === 'completed' || job.state === 'failed' ? STATE_TONE[job.state] : 'text-gray-500 dark:text-gray-300'}`} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-gray-800 dark:text-gray-200 font-bold truncate" title={job.name}>{job.name}</p>
          {active && (
            <button
              type="button"
              aria-label={`取消上傳 ${job.name}`}
              onClick={onCancel}
              // tap-target: invisible 44px touch area around the small icon.
              className="relative tap-target text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <div
          className="h-1.5 w-full bg-gray-100 dark:bg-white/5 rounded-full overflow-hidden"
          role="progressbar"
          aria-label={`${job.name} 上傳進度`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          {/* transform-only animation: no layout per progress tick */}
          <div
            className={`h-full w-full origin-left transition-transform duration-300 ease-out ${job.state === 'failed' ? 'bg-red-500' : 'bg-linear-to-r from-purple-500 to-cyan-500'}`}
            style={{ transform: `scaleX(${percent / 100})` }}
          />
        </div>
        <div className="grid grid-cols-2 gap-y-1 text-[0.6rem] font-mono uppercase tracking-tight">
          <div className="text-purple-600 dark:text-purple-400 font-bold">{Math.round(percent)}%</div>
          <div className="text-right text-gray-500 dark:text-gray-400">
            {formatBytes(job.bytesSent)} / {formatBytes(job.bytesTotal)}
          </div>
          <div className={`col-span-2 font-bold tracking-widest ${STATE_TONE[job.state]}`}>{UPLOAD_STATE_LABEL[job.state]}</div>
        </div>
        {job.error && job.state !== 'completed' && (
          <p className="text-[0.65rem] text-red-500 break-words">{job.error}</p>
        )}
      </div>
    </li>
  );
};

/**
 * Upload progress list with an aggregate summary.
 *
 * @param props - Component props.
 * @returns The progress region.
 */
export const NativeUploadProgress: React.FC<NativeUploadProgressProps> = ({ jobs, onCancel, onContinueInBackground }) => {
  const knownTotal = jobs.every((job) => job.bytesTotal >= 0);
  const bytesTotal = jobs.reduce((sum, job) => sum + Math.max(0, job.bytesTotal), 0);
  const bytesSent = jobs.reduce((sum, job) => sum + Math.max(0, job.bytesSent), 0);
  const doneCount = jobs.filter((job) => job.state === 'completed').length;
  const anyActive = jobs.some((job) => isActiveUploadState(job.state));
  return (
    <section aria-label="上傳進度" className="space-y-3">
      <div className="flex items-center justify-between gap-2 px-1 text-[0.65rem] text-gray-500 dark:text-gray-400">
        <span>已完成 {doneCount} / {jobs.length} 個檔案</span>
        {knownTotal && jobs.length > 1 && (
          <span className="font-mono">{Math.round(uploadPercent(bytesSent, bytesTotal))}% · {formatBytes(bytesSent)} / {formatBytes(bytesTotal)}</span>
        )}
      </div>
      <ul className="space-y-3">
        {jobs.map((job) => (
          <UploadJobRow key={job.jobId} job={job} onCancel={() => onCancel(job.jobId)} />
        ))}
      </ul>
      {onContinueInBackground && (
        <button
          type="button"
          onClick={onContinueInBackground}
          className="w-full min-h-11 rounded-xl border border-gray-200 dark:border-white/10 text-xs font-bold text-gray-600 dark:text-gray-300 hover:border-cyan-500/50 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-quantum-cyan"
        >
          {anyActive ? '在背景繼續上傳，前往個人頁面' : '前往個人頁面'}
        </button>
      )}
    </section>
  );
};
