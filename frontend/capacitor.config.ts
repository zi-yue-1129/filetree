/**
 * Capacitor configuration for the FileNexus Android/iOS apps.
 *
 * See docs/NATIVE_APPS.md (sections 1, 4, 5) for the shared contract this
 * configuration implements.
 */
import type { CapacitorConfig } from '@capacitor/cli';

/** Capacitor project configuration shared by the Android and iOS shells. */
const config: CapacitorConfig = {
  appId: 'cc.spkuan.filenexus',
  appName: 'FileNexus',
  // Must match `build.outDir` in vite.config.ts.
  webDir: '../static/dist',
  android: {
    // The web bundle talks to a remote HTTPS server; never allow cleartext
    // or mixed content unless a user explicitly points the app at one.
    allowMixedContent: false,
  },
  plugins: {
    CapacitorUpdater: {
      // Self-hosted manual mode: the JS side (src/native/liveUpdate.ts) checks
      // web-bundle.json on GitHub Releases and schedules bundles itself.
      autoUpdate: false,
      // Roll back if the new bundle does not call notifyAppReady() in time.
      appReadyTimeout: 10000,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      // A freshly installed APK ships a newer built-in bundle; drop old ones.
      resetWhenUpdate: true,
      // No Capgo cloud: disable stats/channel calls to plugin.capgo.app.
      statsUrl: '',
      channelUrl: '',
      updateUrl: '',
    },
  },
};

export default config;
