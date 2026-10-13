/**
 * React hooks over the `FileNexusNative` plugin state and events.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { FileNexusNative, getErrorMessage, isMobileNative } from './index';
import type { NativeConfiguration, PhotoBackupStatus, SharedItem, UploadJob } from './index';

/** Generic async-state shape returned by the hooks. */
export interface NativeState<T> {
  /** Latest value, `null` until loaded. */
  data: T | null;
  /** Last load error message (zh-TW or native), `null` when fine. */
  error: string | null;
  /** Reload from native. */
  refresh: () => Promise<void>;
}

/**
 * Subscribe to a plugin event for the component's lifetime.
 *
 * @param subscribe - Function returning the listener handle.
 */
function useListener(subscribe: () => Promise<PluginListenerHandle>): void {
  useEffect(() => {
    if (!isMobileNative()) return undefined;
    let handle: PluginListenerHandle | null = null;
    let disposed = false;
    subscribe()
      .then((created) => {
        if (disposed) {
          void created.remove();
        } else {
          handle = created;
        }
      })
      .catch((error: unknown) => console.error('Failed to subscribe to native events', error));
    return () => {
      disposed = true;
      if (handle) void handle.remove();
    };
  }, [subscribe]);
}

/**
 * Load a value from native on mount and expose a refresh function.
 *
 * @param load - Loader.
 * @returns State with refresh.
 */
function useNativeValue<T>(load: () => Promise<T>): NativeState<T> & { setData: Dispatch<SetStateAction<T | null>> } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await load());
      setError(null);
    } catch (caught: unknown) {
      console.error('Native state load failed', caught);
      setError(getErrorMessage(caught));
    }
  }, [load]);
  useEffect(() => {
    if (!isMobileNative()) return;
    // Initial load from the native side; state updates happen after the await.
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  return { data, error, refresh, setData };
}

const loadUploads = async (): Promise<UploadJob[]> => (await FileNexusNative.getUploads()).uploads;
const loadPhotoStatus = (): Promise<PhotoBackupStatus> => FileNexusNative.getPhotoBackupStatus();
const loadShared = async (): Promise<SharedItem[]> => (await FileNexusNative.getSharedItems()).items;
const loadConfig = (): Promise<NativeConfiguration> => FileNexusNative.getConfiguration();

/**
 * Native upload queue with live progress.
 *
 * @returns Jobs (newest first) and refresh.
 */
export function useNativeUploads(): NativeState<UploadJob[]> {
  const state = useNativeValue(loadUploads);
  const { setData, refresh } = state;
  const subscribe = useCallback(
    () =>
      FileNexusNative.addListener('uploadProgress', (event) => {
        // `queued` is emitted for newly enqueued jobs: reload to pick them up.
        if (event.state === 'queued') void refresh();
        setData((previous) =>
          (previous ?? []).map((job) =>
            job.jobId === event.jobId
              ? { ...job, bytesSent: event.bytesSent, bytesTotal: event.bytesTotal, state: event.state, error: event.error ?? null }
              : job,
          ),
        );
      }),
    [refresh, setData],
  );
  useListener(subscribe);
  return { data: state.data, error: state.error, refresh: state.refresh };
}

/**
 * Photo backup status.
 *
 * @returns Status and refresh.
 */
export function usePhotoBackupStatus(): NativeState<PhotoBackupStatus> & {
  setData: Dispatch<SetStateAction<PhotoBackupStatus | null>>;
} {
  return useNativeValue(loadPhotoStatus);
}

/**
 * Share-sheet items waiting for the user, updated when new ones arrive.
 *
 * @returns Items and refresh.
 */
export function useSharedItems(): NativeState<SharedItem[]> {
  const state = useNativeValue(loadShared);
  const { refresh } = state;
  const subscribe = useCallback(() => FileNexusNative.addListener('sharedItems', () => void refresh()), [refresh]);
  useListener(subscribe);
  return { data: state.data, error: state.error, refresh: state.refresh };
}

/**
 * Native device configuration.
 *
 * @returns Configuration and refresh.
 */
export function useNativeConfiguration(): NativeState<NativeConfiguration> {
  const state = useNativeValue(loadConfig);
  return { data: state.data, error: state.error, refresh: state.refresh };
}
