// desktop/electron.vite.config.js
//
// electron-vite builds three independent bundles from one config:
//   main     — desktop/main/index.js, Node/Electron APIs, unbundled deps
//   preload  — desktop/main/preload.js, the contextBridge boundary
//   renderer — desktop/renderer/, the React app, bundled by Vite/esbuild
//
// main/index.js and main/preload.js are untouched in content — only their
// *build inputs* are pointed to here. Both keep using require() (CommonJS)
// exactly as before; format: 'cjs' below matches that.
//
// externalizeDepsPlugin() keeps main/preload's node_modules dependencies
// (currently just "electron" itself, which Electron provides at runtime
// anyway) as external requires rather than bundling them — standard
// practice for the main/preload side of an Electron app.
//
// fileName: () => 'index.js' pins the output filename regardless of the
// source file's name, so main/index.js's preload path
// (../preload/index.js) and the loadFile() path (../renderer/index.html)
// stay predictable no matter what the source files are called.

import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/main",
      lib: {
        entry: resolve(__dirname, "main/index.js"),
        fileName: () => "index.js",
        formats: ["cjs"],
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "out/preload",
      lib: {
        entry: resolve(__dirname, "main/preload.js"),
        fileName: () => "index.js",
        formats: ["cjs"],
      },
    },
  },

  renderer: {
    root: resolve(__dirname, "renderer"),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, "out/renderer"),
      rollupOptions: {
        input: resolve(__dirname, "renderer/index.html"),
      },
    },
  },
});
