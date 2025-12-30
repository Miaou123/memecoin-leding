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

export function formatTokenAmount(amount: string | number, maxDecimals = 2): string {
  return formatNumber(amount, {
    maximumFractionDigits: maxDecimals,
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

export function getHealthColor(health: number): string {
  if (health >= 70) return 'accent-green';
  if (health >= 40) return 'accent-yellow';
  return 'accent-red';
}

export function getLoanUrgency(dueAt: number): 'normal' | 'warning' | 'critical' {
  const hoursLeft = (dueAt - Date.now() / 1000) / 3600;
  if (hoursLeft <= 2) return 'critical';
  if (hoursLeft <= 6) return 'warning';
  return 'normal';
}

export function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000 - timestamp);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}