import { Loan } from '@memecoin-lending/types';

export function formatSOL(lamports: string | number): string {
  const sol = Number(lamports) / 1_000_000_000;
  return sol.toFixed(sol < 1 ? 4 : 2);
}

export function formatPrice(price: string | number): string {
  const num = Number(price);
  
  if (num >= 1) {
    return num.toFixed(2);
  } else if (num >= 0.01) {
    return num.toFixed(4);
  } else {
    return num.toFixed(6);
  }
}

export function formatPercentage(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatWalletAddress(address: string): string {
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function formatTimeRemaining(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = timestamp - now;
  
  if (diff <= 0) {
    return '⏰ OVERDUE';
  }
  
  const hours = Math.floor(diff / 3600);
  const minutes = Math.floor((diff % 3600) / 60);
  
  if (hours > 48) {
    const days = Math.floor(hours / 24);
    return `⏳ ${days}d ${hours % 24}h`;
  }
  
  if (hours > 0) {
    return `⏳ ${hours}h ${minutes}m`;
  }
  
  return `⏳ ${minutes}m`;
}

export function formatLoanMessage(loan: Loan, index?: number): string {
  const prefix = index ? `<b>${index}.</b> ` : '';
  const statusEmoji = loan.status === 'active' ? '🟢' : 
                     loan.status === 'repaid' ? '✅' : '❌';
  
  const timeStatus = loan.status === 'active' 
    ? formatTimeRemaining(loan.dueAt)
    : loan.status === 'repaid' ? '✅ Repaid' : '❌ Liquidated';
  
  return `
${prefix}${statusEmoji} <b>${formatSOL(loan.solBorrowed)} SOL</b>
💎 Collateral: ${formatSOL(loan.collateralAmount)} tokens
📊 Fee: 1.0%
${timeStatus}
  `.trim();
}

export function formatLoanDetails(loan: Loan): string {
  const statusEmoji = loan.status === 'active' ? '🟢' : 
                     loan.status === 'repaid' ? '✅' : '❌';
  
  let message = `
${statusEmoji} <b>Loan Details</b>

💰 <b>Borrowed:</b> ${formatSOL(loan.solBorrowed)} SOL
💎 <b>Collateral:</b> ${formatSOL(loan.collateralAmount)} tokens
📊 <b>Protocol Fee:</b> 1.0%
🏷️ <b>Status:</b> ${loan.status.charAt(0).toUpperCase() + loan.status.slice(1)}

📅 <b>Created:</b> ${new Date(loan.createdAt * 1000).toLocaleString()}
  `;
  
  if (loan.status === 'active') {
    message += `\n⏰ <b>Due:</b> ${new Date(loan.dueAt * 1000).toLocaleString()}`;
    message += `\n${formatTimeRemaining(loan.dueAt)}`;
    
    // Calculate health ratio
    const currentTime = Date.now() / 1000;
    const timeRemaining = loan.dueAt - currentTime;
    const totalDuration = loan.dueAt - loan.createdAt;
    const healthRatio = Math.max(0, timeRemaining / totalDuration * 100);
    
    const healthEmoji = healthRatio > 50 ? '🟢' : healthRatio > 25 ? '🟡' : '🔴';
    message += `\n\n${healthEmoji} <b>Health:</b> ${healthRatio.toFixed(1)}%`;
    
    if (healthRatio < 25) {
      message += '\n⚠️ <i>Risk of liquidation!</i>';
    }
  }
  
  return message.trim();
}