/// <reference types="vite/client" />

interface UrbanThatBridge {
  platform: NodeJS.Platform;
  versions: {
    node: string;
    chrome: string;
    electron: string;
  };
}

declare global {
  interface Window {
    urbanthat?: UrbanThatBridge;
  }
}

export {};
