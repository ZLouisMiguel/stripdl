// desktop/electron.vite.config.js
//
// electron-vite builds three independent bundles from one config:
//   main     — desktop/main/index.js, Node/Electron APIs, unbundled deps
//   preload  — desktop/main/preload.js, the contextBridge boundary
//   renderer — desktop/renderer/, the React app, bundled by Vite/esbuild
//
// main/index.js and main/preload.js are untouched in content — only their
// *build inputs* are pointed to here. Both keep using require() (CommonJS)
// exactly as before.
//
// externalizeDepsPlugin() keeps main/preload's node_modules dependencies
// (currently just "electron" itself, which Electron provides at runtime
// anyway) as external requires rather than bundling them.
//
// commonjs() lets Rollup bundle main/index.js's local, relative require()
// calls (./configKeys, ./scheduler) into the single output file — without
// it those calls are invisible to Rollup's module graph and get left
// unresolved in the build output.
//
// NOTE on output filenames: electron-vite names each build's output file
// after its *source* entry file's basename, not a configurable "fileName"
// callback (an earlier version of this config tried to force both outputs
// to "index.js" via build.lib.fileName — that override is silently
// ignored by electron-vite's main/preload build path, so it's been
// removed here rather than leaving misleading dead config in place).
// Concretely: main/index.js -> out/main/index.js, main/preload.js ->
// out/preload/preload.js. main/index.js's createMainWindow() must
// reference the preload path exactly that way.

import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import commonjs from "@rollup/plugin-commonjs";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), commonjs()],
    build: {
      outDir: "out/main",
      lib: {
        entry: resolve(__dirname, "main/index.js"),
        formats: ["cjs"],
      },
    },
  },

  preload: {
    plugins: [externalizeDepsPlugin(), commonjs()],
    build: {
      outDir: "out/preload",
      lib: {
        entry: resolve(__dirname, "main/preload.js"),
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
