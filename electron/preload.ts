/**
 * Preload script — bridge between renderer and main process.
 * Keep surface minimal; expose only what is required.
 */
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('urbanthat', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
