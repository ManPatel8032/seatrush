import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const backendUrl =
    process.env.BACKEND_URL ||
    env.BACKEND_URL ||
    process.env.VITE_API_URL ||
    env.VITE_API_URL ||
    "";

  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_API_URL": JSON.stringify(backendUrl),
    },
  };
});
