/**
 * Uppy + TUS uploader factory.
 *
 * Lives in its own module so the landing page can `import()` it after the
 * first paint: Uppy, tus-js-client and their helpers are ~90 KB of minified
 * JS that the initial render does not need.
 */
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';

/** Options for {@link createUploader}. */
export interface UploaderOptions {
  /** Allowed file types (extensions / MIME patterns), or null for any. */
  allowedFileTypes: string[] | null;
  /** Absolute TUS endpoint URL. */
  endpoint: string;
}

/**
 * Create the landing page uploader.
 *
 * @param options - Restrictions and endpoint.
 * @returns Configured Uppy instance with the TUS plugin.
 */
export function createUploader(options: UploaderOptions): Uppy {
  const uploader = new Uppy({
    id: 'filenexus-uploader',
    autoProceed: false,
    // Verbose per-event logging only in development builds.
    debug: import.meta.env.DEV,
    restrictions: {
      maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB
      allowedFileTypes: options.allowedFileTypes,
    },
  });
  uploader.use(Tus, {
    endpoint: options.endpoint,
    chunkSize: 5 * 1024 * 1024,
    retryDelays: [0, 1000, 3000, 5000],
    removeFingerprintOnSuccess: true,
    limit: 5,
  });
  return uploader;
}
