import { Show, createSignal, createMemo } from 'solid-js';
import { useSearchParams } from '@solidjs/router';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Button } from '@/components/ui/Button';
import { TokenSelector } from '@/components/tokens/TokenSelector';
import TokenInputSolid from '@/components/TokenVerification/TokenInputSolid';
import { createTokenVerification, createCanCreateLoan } from '@/hooks/useTokenVerificationSolid';
import { formatSOL, formatNumber, formatPercentage } from '@/lib/utils';
import { api } from '@/lib/api';

export default function Borrow() {
  const [searchParams] = useSearchParams();
  const wallet = useWallet();
  
  const [selectedToken, setSelectedToken] = createSignal(searchParams.token || '');
  const [collateralAmount, setCollateralAmount] = createSignal('');
  const [duration, setDuration] = createSignal(12 * 60 * 60); // 12 hours default
  const [tokenVerificationEnabled, setTokenVerificationEnabled] = createSignal(true);
  
  // Token verification hooks
  const tokenVerification = createTokenVerification(() => selectedToken());
  const loanEligibility = createCanCreateLoan(() => selectedToken());
  
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

      // Check token verification if enabled
      if (tokenVerificationEnabled()) {
        const verification = tokenVerification.data();
        if (!verification?.isValid) {
          throw new Error(`Token verification failed: ${verification?.reason || 'Invalid token'}`);
        }

        const canLoan = loanEligibility.canCreate();
        if (canLoan === false) {
          throw new Error(`Loan not allowed: ${loanEligibility.reason() || 'Token not eligible'}`);
        }
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
          <div class="flex justify-between items-center mb-2">
            <span class="text-sm font-medium">Collateral Token</span>
            <button
              class="text-xs text-blue-600 hover:text-blue-700 underline"
              onClick={() => setTokenVerificationEnabled(!tokenVerificationEnabled())}
            >
              {tokenVerificationEnabled() ? 'Use Token Selector' : 'Use Manual Entry'}
            </button>
          </div>
          
          <Show when={!tokenVerificationEnabled()}>
            <TokenSelector 
              value={selectedToken()}
              onChange={setSelectedToken}
              tokens={tokens.data}
            />
          </Show>
          
          <Show when={tokenVerificationEnabled()}>
            <TokenInputSolid
              value={selectedToken()}
              onChange={setSelectedToken}
              placeholder="Enter PumpFun token mint address..."
              label=""
              required={true}
              showVerification={true}
            />
          </Show>
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
        
        {/* Token Verification Status */}
        <Show when={tokenVerificationEnabled() && selectedToken()}>
          <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div class="flex items-center space-x-2">
              <svg class="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M9 12l2 2 4-4m5.5-4L9 12l-2-2" />
              </svg>
              <span class="text-blue-800 font-medium">Token Verification</span>
            </div>
            
            <Show when={tokenVerification.isLoading()}>
              <div class="mt-2 text-blue-700 text-sm flex items-center space-x-2">
                <svg class="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Verifying token...</span>
              </div>
            </Show>
            
            <Show when={!tokenVerification.isLoading() && tokenVerification.data()}>
              {(data) => {
                const verification = data();
                if (!verification) return null;
                
                if (verification.isValid) {
                  return (
                    <div class="mt-2 space-y-1">
                      <div class="text-green-700 text-sm flex items-center space-x-2">
                        <svg class="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>✅ Valid PumpFun Token</span>
                      </div>
                      <Show when={verification.tier}>
                        <div class="text-sm text-blue-700">
                          Tier: <span class="font-medium capitalize">{verification.tier}</span>
                          {verification.tier === 'bronze' && ' (50% LTV)'}
                          {verification.tier === 'silver' && ' (60% LTV)'}
                          {verification.tier === 'gold' && ' (70% LTV)'}
                        </div>
                      </Show>
                      <Show when={verification.liquidity > 0}>
                        <div class="text-sm text-blue-700">
                          Liquidity: <span class="font-medium">
                            ${verification.liquidity >= 1000000 
                              ? `${(verification.liquidity / 1000000).toFixed(1)}M` 
                              : verification.liquidity >= 1000 
                              ? `${(verification.liquidity / 1000).toFixed(1)}K` 
                              : verification.liquidity.toFixed(2)}
                          </span>
                        </div>
                      </Show>
                    </div>
                  );
                } else {
                  return (
                    <div class="mt-2 text-red-700 text-sm flex items-center space-x-2">
                      <svg class="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                      <span>❌ {verification.reason || 'Token verification failed'}</span>
                    </div>
                  );
                }
              }}
            </Show>
            
            <div class="mt-3 flex items-center space-x-2">
              <input
                type="checkbox"
                id="token-verification"
                checked={tokenVerificationEnabled()}
                onChange={(e) => setTokenVerificationEnabled((e.target as HTMLInputElement).checked)}
                class="rounded border-gray-300 text-blue-600 shadow-sm focus:border-blue-300 focus:ring focus:ring-blue-200 focus:ring-opacity-50"
              />
              <label for="token-verification" class="text-sm text-blue-700">
                Require token verification (recommended for security)
              </label>
            </div>
          </div>
        </Show>

        {/* Create Loan Button */}
        <Button
          onClick={handleCreateLoan}
          loading={createLoanMutation.isPending}
          disabled={
            !wallet.connected() || 
            !loanEstimate.data ||
            (tokenVerificationEnabled() && (!tokenVerification.data()?.isValid || loanEligibility.canCreate() === false))
          }
          class="w-full"
          size="lg"
        >
          <Show when={!wallet.connected()} fallback={
            <Show when={tokenVerificationEnabled() && tokenVerification.data() && !tokenVerification.data()?.isValid} fallback="Create Loan">
              Token Not Verified
            </Show>
          }>
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