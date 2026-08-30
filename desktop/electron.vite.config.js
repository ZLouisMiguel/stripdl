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
// commonjs() is what actually lets Rollup bundle main/index.js's local,
// relative require() calls (./configKeys, ./scheduler) into the single
// output file. Without it, Rollup only understands ES import/export for
// tracing which local files to inline — plain require("./x") calls are
// invisible to it and get left in the output verbatim, pointing at a file
// that was never copied into out/main/. (This is what caused the
// "Cannot find module './configKeys'" runtime error.) All the main and
// preload source files stay written in plain CommonJS — no need to
// rewrite them to import/export just to fix the build.
//
// fileName: () => 'index.js' pins the output filename regardless of the
// source file's name, so main/index.js's preload path
// (../preload/index.js) and the loadFile() path (../renderer/index.html)
// stay predictable no matter what the source files are called.

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
        fileName: () => "index.js",
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
