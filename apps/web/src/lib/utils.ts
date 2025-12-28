import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(
  number: number | string,
  options?: Intl.NumberFormatOptions
) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
    ...options,
  }).format(Number(number));
}

export function formatSOL(lamports: string | number): string {
  const sol = Number(lamports) / 1_000_000_000;
  return formatNumber(sol, { 
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function formatUSD(amount: number): string {
  return formatNumber(amount, {
    style: 'currency',
    currency: 'USD',
  });
}

export function formatPercentage(value: number): string {
  return `${value > 0 ? '+' : ''}${formatNumber(value)}%`;
}

export function formatTimeRemaining(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = timestamp - now;
  
  if (diff <= 0) {
    return 'Expired';
  }
  
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  
  return `${minutes}m`;
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}