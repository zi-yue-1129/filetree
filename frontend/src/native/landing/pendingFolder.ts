/**
 * Grouping of native folder picks for the Landing page's pending list.
 */
import type { NativeFile } from '../index';

/** Maximum number of file rows rendered for an expanded folder. */
export const FOLDER_PREVIEW_LIMIT = 100;

/** A folder picked with the native folder picker, pending upload. */
export interface PendingNativeFolder {
  /** Unique id of this pick (the same folder may be picked twice). */
  id: string;
  /** Display name of the folder. */
  folderName: string;
  /** Files below the folder, each with a `relativePath`. */
  files: NativeFile[];
  /** Sum of known file sizes in bytes. */
  totalBytes: number;
  /** Number of files whose size the platform could not report. */
  unknownSizeCount: number;
}

/**
 * Group the files of one folder pick into a pending row.
 *
 * @param id - Unique id for the pick.
 * @param folderName - Display name of the folder.
 * @param files - Files returned by the picker.
 * @returns The grouped folder with its size totals computed once.
 */
export function makePendingFolder(id: string, folderName: string, files: NativeFile[]): PendingNativeFolder {
  let totalBytes = 0;
  let unknownSizeCount = 0;
  for (const file of files) {
    const size = file.size ?? -1;
    if (size >= 0) {
      totalBytes += size;
    } else {
      unknownSizeCount += 1;
    }
  }
  return { id, folderName, files, totalBytes, unknownSizeCount };
}
