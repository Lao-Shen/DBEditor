import { theme as antdTheme } from "antd";
import type { ThemeConfig } from "antd";

export type ThemeMode = "dark" | "light";

const THEME_KEY = "dbeditor.theme";

export function loadThemeMode(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") {
    return saved;
  }
  return "dark";
}

export function saveThemeMode(mode: ThemeMode): void {
  localStorage.setItem(THEME_KEY, mode);
}

export function buildTheme(mode: ThemeMode): ThemeConfig {
  const isDark = mode === "dark";
  return {
    algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    token: {
      colorPrimary: "#6a8dff",
      borderRadius: 6,
      fontSize: 13,
      fontFamily:
        '"Segoe UI", -apple-system, BlinkMacSystemFont, "Microsoft YaHei", "PingFang SC", Roboto, Helvetica, Arial, sans-serif',
    },
  };
}
