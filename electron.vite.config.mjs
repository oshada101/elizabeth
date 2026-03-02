import { resolve } from "path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

export default defineConfig({
    main: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "src/main/index.ts"),
                },
                external: [
                    "@langchain/core",
                    "@langchain/openai",
                    "@langchain/langgraph",
                    "@langchain/langgraph-checkpoint-sqlite",
                    "langchain",
                    "zod",
                    "fs",
                    "path",
                    "crypto",
                    "node:async_hooks",
                    "better-sqlite3",
                ],
            },
        },
    },
    preload: {
        plugins: [externalizeDepsPlugin()],
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "src/preload/index.ts"),
                },
            },
        },
    },
    renderer: {
        root: resolve(__dirname, "src/renderer"),
        build: {
            rollupOptions: {
                input: {
                    index: resolve(__dirname, "src/renderer/index.html"),
                },
            },
        },
        plugins: [react()],
        css: {
            postcss: {
                plugins: [tailwindcss, autoprefixer],
            },
        },
    },
});
