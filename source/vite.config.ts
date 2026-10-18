declare const process: { env: Record<string, string | undefined> };
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/.cache/**", "**/.cargo-home/**", "**/src-tauri/target/**", "**/.pnpm-store/**", "**/old referennsece/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15" }
});
