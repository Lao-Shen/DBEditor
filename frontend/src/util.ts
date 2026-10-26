export function formatSize(bytes: number): string {
  if (!bytes) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatNumber(n: number): string {
  return n.toLocaleString("zh-CN");
}

export function isNumericType(type: string): boolean {
  return /INT|REAL|FLOA|DOUB|NUM|DEC/i.test(type);
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
