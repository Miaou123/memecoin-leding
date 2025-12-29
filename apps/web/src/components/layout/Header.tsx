import { A } from '@solidjs/router';
import { WalletButton } from '../wallet/WalletButton';

export function Header() {
  return (
    <header class="bg-bg-primary border-b border-border sticky top-0 z-50">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-12">
          <div class="flex items-center space-x-8">
            <A href="/" class="font-mono text-base font-semibold text-accent-green">
              TERMINAL_PRO://LENDING
            </A>
            
            <nav class="hidden md:flex items-center space-x-6">
              <A 
                href="/"
                class="font-mono text-xs uppercase tracking-wider text-text-secondary hover:text-accent-green transition-colors"
                activeClass="text-accent-green"
              >
                [DASHBOARD]
              </A>
              <A 
                href="/borrow"
                class="font-mono text-xs uppercase tracking-wider text-text-secondary hover:text-accent-green transition-colors"
                activeClass="text-accent-green"
              >
                [BORROW]
              </A>
              <A 
                href="/loans"
                class="font-mono text-xs uppercase tracking-wider text-text-secondary hover:text-accent-green transition-colors"
                activeClass="text-accent-green"
              >
                [MY_LOANS]
              </A>
              <A 
                href="/staking"
                class="font-mono text-xs uppercase tracking-wider text-text-secondary hover:text-accent-blue transition-colors"
                activeClass="text-accent-blue"
              >
                [STAKING]
              </A>
            </nav>
          </div>
          
          <div class="flex items-center">
            <div class="hidden sm:flex items-center text-xs font-mono text-text-dim mr-4">
              <span>STATUS: ONLINE</span>
              <div class="ml-2 w-2 h-2 bg-accent-green"></div>
            </div>
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
}