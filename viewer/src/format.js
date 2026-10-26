const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function humanBytes(n) {
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  return i === 0 ? `${v} B` : `${v.toFixed(1)} ${UNITS[i]}`;
}

export function percent(part, total) {
  if (!total) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

/** 1234567 -> "1 234 567" (thin spaces) */
export function formatInt(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
