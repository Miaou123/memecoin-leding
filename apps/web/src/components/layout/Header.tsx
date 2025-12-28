import { A } from '@solidjs/router';
import { WalletButton } from '../wallet/WalletButton';

export function Header() {
  return (
    <header class="border-b bg-white/50 backdrop-blur-sm sticky top-0 z-50">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <div class="flex items-center space-x-8">
            <A href="/" class="text-xl font-bold text-primary">
              Memecoin Lending
            </A>
            
            <nav class="hidden md:flex space-x-6">
              <A 
                href="/"
                class="text-sm font-medium hover:text-primary transition-colors"
                activeClass="text-primary"
              >
                Dashboard
              </A>
              <A 
                href="/borrow"
                class="text-sm font-medium hover:text-primary transition-colors"
                activeClass="text-primary"
              >
                Borrow
              </A>
              <A 
                href="/loans"
                class="text-sm font-medium hover:text-primary transition-colors"
                activeClass="text-primary"
              >
                My Loans
              </A>
            </nav>
          </div>
          
          <WalletButton />
        </div>
      </div>
    </header>
  );
}