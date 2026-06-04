import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMonthYearLabel(monthStr: string): string {
  if (!monthStr) return 'No Month Selected';
  const parts = monthStr.split('-');
  if (parts.length === 2) {
    const [mmm, yy] = parts;
    const monthsMap: Record<string, string> = {
      jan: 'January', feb: 'February', mar: 'March', apr: 'April',
      may: 'May', jun: 'June', jul: 'July', aug: 'August',
      sep: 'September', oct: 'October', nov: 'November', dec: 'December'
    };
    const fullMonth = monthsMap[mmm.toLowerCase()] || mmm;
    const fullYear = yy.length === 2 ? `20${yy}` : yy;
    return `${fullMonth} ${fullYear}`;
  }
  return monthStr;
}

