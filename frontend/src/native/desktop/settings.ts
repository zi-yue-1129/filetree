/** Authentication cleanup when the desktop backend origin changes. */

/** Remove saved credentials before relaunching with another backend origin.
 *
 * Args:
 *   local: Browser storage containing the web app's persisted authentication.
 *   session: Browser storage containing per-directory unlock sessions.
 */
export function clearDesktopAuthentication(
  local: Pick<Storage, 'removeItem'>,
  session: Pick<Storage, 'length' | 'key' | 'removeItem'>,
): void {
  local.removeItem('filenexus_token');
  local.removeItem('filenexus_user');
  const unlockKeys: string[] = [];
  for (let index: number = 0; index < session.length; index += 1) {
    const key: string | null = session.key(index);
    if (key?.startsWith('unlocked_')) unlockKeys.push(key);
  }
  unlockKeys.forEach((key: string): void => session.removeItem(key));
}
