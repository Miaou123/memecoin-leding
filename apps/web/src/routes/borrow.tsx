import { Show, createSignal, createMemo } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Button } from '@/components/ui/Button';
import { TokenSelector } from '@/components/tokens/TokenSelector';
import { formatSOL, formatNumber, formatPercentage } from '@/lib/utils';
import { api } from '@/lib/api';

export default function Borrow() {
  const [searchParams] = useSearchParams();
  const wallet = useWallet();
  
  const [selectedToken, setSelectedToken] = createSignal(searchParams.token);
  const [collateralAmount, setCollateralAmount] = createSignal('');
  const [duration, setDuration] = createSignal(12 * 60 * 60); // 12 hours default
  
  const tokens = createQuery(() => ({
    queryKey: ['tokens'],
    queryFn: () => api.getTokens(),
  }));
  
  const selectedTokenData = createMemo(() => {
    const token = selectedToken();
    return tokens.data?.find(t => t.mint === token);
  });
  
  const loanEstimate = createQuery(() => ({
    queryKey: ['loan-estimate', selectedToken(), collateralAmount(), duration()],
    queryFn: async () => {
      const token = selectedToken();
      const amount = collateralAmount();
      const dur = duration();
      
      if (!token || !amount || !dur) {
        return null;
      }
      
      return api.estimateLoan({
        tokenMint: token,
        collateralAmount: amount,
        durationSeconds: dur,
      });
    },
    enabled: () => Boolean(selectedToken() && collateralAmount() && duration()),
  }));
  
  const createLoanMutation = createMutation(() => ({
    mutationFn: async () => {
      if (!wallet.connected() || !selectedToken() || !collateralAmount()) {
        throw new Error('Missing required data');
      }
      
      // Sign authentication message
      const timestamp = Date.now();
      const message = `Sign in to Memecoin Lending Protocol\nTimestamp: ${timestamp}`;
      const messageBytes = new TextEncoder().encode(message);
      const signature = await wallet.signMessage(messageBytes);
      
      const authHeaders = {
        'X-Signature': btoa(String.fromCharCode(...signature)),
        'X-Public-Key': wallet.publicKey()!.toString(),
        'X-Timestamp': timestamp.toString(),
      };
      
      return api.createLoan({
        tokenMint: selectedToken()!,
        collateralAmount: collateralAmount(),
        durationSeconds: duration(),
      }, authHeaders);
    },
  }));
  
  const handleCreateLoan = () => {
    createLoanMutation.mutate();
  };
  
  const formatDuration = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h`;
  };
  
  return (
    <div class="max-w-2xl mx-auto space-y-8">
      <div class="text-center">
        <h1 class="text-3xl font-bold">Borrow SOL</h1>
        <p class="text-muted-foreground mt-2">
          Get instant SOL loans using your memecoins as collateral
        </p>
      </div>
      
      <div class="bg-card p-6 rounded-lg border space-y-6">
        {/* Token Selection */}
        <div>
          <label class="block text-sm font-medium mb-2">Select Collateral Token</label>
          <TokenSelector 
            value={selectedToken()}
            onChange={setSelectedToken}
            tokens={tokens.data}
          />
        </div>
        
        {/* Amount Input */}
        <div>
          <label class="block text-sm font-medium mb-2">Collateral Amount</label>
          <div class="relative">
            <input
              type="number"
              value={collateralAmount()}
              onInput={(e) => setCollateralAmount(e.currentTarget.value)}
              placeholder="Enter amount"
              class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <div class="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {selectedTokenData()?.symbol}
            </div>
          </div>
          <Show when={selectedTokenData()}>
            <div class="text-xs text-muted-foreground mt-1">
              ≈ ${formatNumber(
                parseFloat(collateralAmount() || '0') * 
                parseFloat(selectedTokenData()?.currentPrice || '0')
              )}
            </div>
          </Show>
        </div>
        
        {/* Duration Selection */}
        <div>
          <label class="block text-sm font-medium mb-2">Loan Duration</label>
          <div class="grid grid-cols-4 gap-2">
            {[
              { label: '12h', value: 12 * 60 * 60 },
              { label: '1d', value: 24 * 60 * 60 },
              { label: '3d', value: 3 * 24 * 60 * 60 },
              { label: '7d', value: 7 * 24 * 60 * 60 },
            ].map(option => (
              <button
                onClick={() => setDuration(option.value)}
                class={`p-2 text-sm border rounded ${
                  duration() === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        
        {/* Loan Estimate */}
        <Show when={loanEstimate.data}>
          <div class="bg-muted p-4 rounded-lg space-y-3">
            <h3 class="font-medium">Loan Terms</h3>
            <div class="space-y-2 text-sm">
              <div class="flex justify-between">
                <span>SOL Amount</span>
                <span class="font-medium">{formatSOL(loanEstimate.data!.solAmount)} SOL</span>
              </div>
              <div class="flex justify-between">
                <span>Interest Rate (APR)</span>
                <span>{formatPercentage(loanEstimate.data!.interestRate / 100)}</span>
              </div>
              <div class="flex justify-between">
                <span>Total to Repay</span>
                <span class="font-medium">{formatSOL(loanEstimate.data!.totalOwed)} SOL</span>
              </div>
              <div class="flex justify-between">
                <span>Liquidation Price</span>
                <span class="text-red-600">${formatNumber(loanEstimate.data!.liquidationPrice)}</span>
              </div>
              <div class="flex justify-between">
                <span>LTV Ratio</span>
                <span>{formatPercentage(loanEstimate.data!.ltv)}</span>
              </div>
              <div class="flex justify-between">
                <span>Duration</span>
                <span>{formatDuration(duration())}</span>
              </div>
            </div>
          </div>
        </Show>
        
        {/* Create Loan Button */}
        <Button
          onClick={handleCreateLoan}
          loading={createLoanMutation.isPending}
          disabled={!wallet.connected() || !loanEstimate.data}
          class="w-full"
          size="lg"
        >
          <Show when={!wallet.connected()} fallback="Create Loan">
            Connect Wallet to Continue
          </Show>
        </Button>
        
        <Show when={createLoanMutation.isSuccess}>
          <div class="text-center p-4 bg-green-50 border border-green-200 rounded-lg">
            <div class="text-green-800 font-medium">Loan Created Successfully!</div>
            <div class="text-green-600 text-sm mt-1">
              Check your loans page to manage your new loan
            </div>
          </div>
        </Show>
        
        <Show when={createLoanMutation.error}>
          <div class="text-center p-4 bg-red-50 border border-red-200 rounded-lg">
            <div class="text-red-800 font-medium">Error Creating Loan</div>
            <div class="text-red-600 text-sm mt-1">
              {createLoanMutation.error?.message}
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}