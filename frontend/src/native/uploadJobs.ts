/**
 * Shared presentation helpers for native upload queue jobs (landing page
 * inline progress and the Settings upload queue).
 */
import type { UploadJob } from './index';

/** zh-TW labels for upload states. */
export const UPLOAD_STATE_LABEL: Record<UploadJob['state'], string> = {
  queued: '排隊中',
  uploading: '上傳中',
  retrying: '重試中',
  completed: '完成',
  failed: '失敗',
  cancelled: '已取消',
};

/**
 * Whether the job may still change (and can be cancelled).
 *
 * @param state - Job state.
 * @returns `true` for queued, uploading and retrying jobs.
 */
export function isActiveUploadState(state: UploadJob['state']): boolean {
  return state === 'queued' || state === 'uploading' || state === 'retrying';
}

/**
 * Upload progress in percent.
 *
 * @param bytesSent - Bytes acknowledged by the server.
 * @param bytesTotal - Total bytes, negative when unknown.
 * @returns Percentage in [0, 100]; 0 when the total is unknown.
 */
export function uploadPercent(bytesSent: number, bytesTotal: number): number {
  if (bytesTotal <= 0) return 0;
  return Math.min(100, Math.max(0, (bytesSent / bytesTotal) * 100));
}
