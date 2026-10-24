declare const process: { env: Record<string, string | undefined> };
import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  // pnpm / npm put the package.json version into the environment of every script they run
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "") },
  server: { port: 1420, strictPort: true, host: "127.0.0.1", watch: { ignored: ["**/.cache/**", "**/.cargo-home/**", "**/src-tauri/target/**", "**/.pnpm-store/**", "**/old referennsece/**", "**/.scratch/**"] } },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: { target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari15" }
});
