/**
 * Entry point of the `filenexus-native` Capacitor plugin.
 *
 * Registers `FileNexusNative`; on the web it lazily loads the fallback in `web.ts`.
 */
import { registerPlugin } from '@capacitor/core';

import type { FileNexusNativePlugin } from './definitions';

/** The `FileNexusNative` plugin proxy (native on Android/iOS, web fallback otherwise). */
export const FileNexusNative: FileNexusNativePlugin = registerPlugin<FileNexusNativePlugin>(
  'FileNexusNative',
  {
    web: () => import('./web').then((module) => new module.FileNexusNativeWeb()),
  },
);

export * from './definitions';
