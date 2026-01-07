import { Show, createSignal, createMemo, createEffect } from 'solid-js';
import { useSearchParams, useNavigate } from '@solidjs/router';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Button } from '@/components/ui/Button';
import { createTokenVerification, createCanCreateLoan } from '@/hooks/useTokenVerificationSolid';
import { formatSOL, formatNumber, formatPercentage } from '@/lib/utils';
import { api } from '@/lib/api';
import { useTokenBalance } from '@/hooks/useTokenBalance';
import { useWalletPumpTokens } from '@/hooks/useWalletPumpTokens';
import { TokenSelectionUnified } from '@/components/tokens/TokenSelectionUnified';
import { Transaction, PublicKey } from '@solana/web3.js';
import { createConnection } from '../utils/rpc';
import BN from 'bn.js';
import { SuccessModal } from '@/components/ui/SuccessModal';
import { createLoan } from '@/lib/loan-transactions';
// Simple debounce utility
function debounce<T extends (...args: any[]) => void>(func: T, delay: number): T {
  let timeoutId: number;
  return ((...args: any[]) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  }) as T;
}

export default function Borrow() {
  const [searchParams] = useSearchParams();
  const wallet = useWallet();
  const navigate = useNavigate();
  
  const [selectedToken, setSelectedToken] = createSignal(searchParams.token || '');
  const [manualTokenValue, setManualTokenValue] = createSignal(searchParams.token || '');
  const [collateralAmount, setCollateralAmount] = createSignal('');
  const [duration, setDuration] = createSignal(48 * 60 * 60); // 48 hours default (base LTV)
  
  // Success modal state
  const [showSuccessModal, setShowSuccessModal] = createSignal(false);
  const [loanResult, setLoanResult] = createSignal<any>(null);
  
  // Cached loan estimate signal
  const [cachedLoanEstimate, setCachedLoanEstimate] = createSignal<typeof loanEstimate.data>(null);
  
  // Token verification hooks
  const tokenVerification = createTokenVerification(() => selectedToken());
  const loanEligibility = createCanCreateLoan(() => selectedToken());
  
  // Token balance hook
  const tokenBalance = useTokenBalance(() => selectedToken() || null);
  
  // Wallet tokens hook
  const walletPumpTokens = useWalletPumpTokens();
  
  const loanEstimate = createQuery(() => ({
    queryKey: ['loan-estimate', selectedToken(), collateralAmount(), duration()],
    queryFn: async () => {
      const token = selectedToken();
      const amount = collateralAmount();
      const dur = duration();
      
      if (!token || !amount || !dur) {
        return null;
      }
      
      // Convert UI amount to raw units (multiply by 10^decimals)
      const tokenDecimals = 6; // PumpFun tokens use 6 decimals
      const rawCollateralAmount = (parseFloat(amount || '0') * Math.pow(10, tokenDecimals)).toString();
      
      return api.estimateLoan({
        tokenMint: token,
        collateralAmount: rawCollateralAmount,
        durationSeconds: dur,
      });
    },
    // Enable when we have token, amount, duration AND token is verified (wallet NOT required)
    enabled: () => Boolean(
      selectedToken() && 
      collateralAmount() && 
      parseFloat(collateralAmount() || '0') > 0 &&
      duration() && 
      tokenVerification.data()?.isValid
    ),
  }));
  
  // Effect to cache valid data whenever it arrives
  createEffect(() => {
    if (loanEstimate.data) {
      setCachedLoanEstimate(loanEstimate.data);
    }
  });
  
  // Create a derived signal that prefers fresh data but falls back to cached
  const displayedLoanEstimate = createMemo(() => loanEstimate.data ?? cachedLoanEstimate());
  
  const createLoanMutation = createMutation(() => ({
    mutationFn: async () => {
      if (!wallet.connected() || !selectedToken() || !collateralAmount()) {
        throw new Error('Missing required data');
      }

      // Check token verification (always required)
      const verification = tokenVerification.data();
      if (!verification?.isValid) {
        throw new Error(`Token verification failed: ${verification?.reason || 'Invalid token'}`);
      }

      const canLoan = loanEligibility.canCreate();
      if (canLoan === false) {
        throw new Error(`Loan not allowed: ${loanEligibility.reason() || 'Token not eligible'}`);
      }
      
      // Convert UI amount to raw units (multiply by 10^decimals)
      const tokenDecimals = 6; // PumpFun tokens use 6 decimals
      const rawCollateralAmount = (parseFloat(collateralAmount() || '0') * Math.pow(10, tokenDecimals)).toString();
      
      const connection = createConnection();
      
      // Use the new backend-signed transaction flow
      const result = await createLoan(
        {
          tokenMint: selectedToken()!,
          collateralAmount: rawCollateralAmount,
          durationSeconds: duration(),
          borrower: wallet.publicKey()!.toString(),
        },
        wallet.signTransaction!,
        connection
      );
      
      // Track the loan in database
      const loan = await api.trackLoan({
        loanPubkey: result.loanPda,
        txSignature: result.signature,
        borrower: wallet.publicKey()!.toString(),
        tokenMint: selectedToken(),
      });
      
      return { signature: result.signature, loan, estimate: loanEstimate.data! };
    },
    onSuccess: (result) => {
      setLoanResult(result);
      setShowSuccessModal(true);
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
  
  // Add debounced duration setter for smoother UX
  const debouncedSetDuration = debounce((value: number) => setDuration(value), 100);

  // Format duration for display in bubble
  const formatDurationDisplay = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    
    if (days === 0) {
      return `${hours}h`;
    } else if (remainingHours === 0) {
      return `${days}d`;
    } else {
      return `${days}d ${remainingHours}h`;
    }
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
        <TokenSelectionUnified
          walletTokens={walletPumpTokens.tokens()}
          isLoadingWalletTokens={walletPumpTokens.isLoading()}
          onSelect={(mint) => {
            setSelectedToken(mint);
            setManualTokenValue(mint);
          }}
          selectedMint={selectedToken()}
          manualValue={manualTokenValue()}
          onManualChange={setManualTokenValue}
          walletConnected={wallet.connected()}
        />
        
        {/* Amount Input */}
        <div>
          <div class="flex justify-between items-center mb-2">
            <label class="block text-sm font-medium">Collateral Amount</label>
            <Show when={selectedToken() && wallet.connected()}>
              <div class="text-xs text-muted-foreground">
                Balance: {tokenBalance.isLoading() ? '...' : tokenBalance.uiBalance() || '0'} tokens
              </div>
            </Show>
          </div>
          <div class="relative">
            <input
              type="number"
              value={collateralAmount()}
              onInput={(e) => setCollateralAmount(e.currentTarget.value)}
              placeholder="Enter amount"
              class="w-full p-3 border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            <div class="absolute right-3 top-1/2 -translate-y-1/2 flex items-center space-x-2">
              <Show when={selectedToken() && wallet.connected() && tokenBalance.uiBalance()}>
                <button
                  type="button"
                  onClick={() => setCollateralAmount(tokenBalance.uiBalance() || '0')}
                  class="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  disabled={tokenBalance.isLoading()}
                >
                  MAX
                </button>
              </Show>
              <div class="text-sm text-muted-foreground">
                tokens
              </div>
            </div>
          </div>
          {/* Token verification status messages */}
          <Show when={selectedToken() && collateralAmount() && tokenVerification.isLoading()}>
            <div class="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <svg class="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Verifying token...
            </div>
          </Show>
          <Show when={selectedToken() && collateralAmount() && !tokenVerification.data()?.isValid && !tokenVerification.isLoading()}>
            <div class="text-xs text-muted-foreground mt-1">
              Value calculation available after token verification
            </div>
          </Show>
          <Show when={selectedToken() && collateralAmount() && tokenVerification.data()?.isValid}>
            <Show when={loanEstimate.isLoading}>
              <div class="text-xs text-muted-foreground mt-1">Calculating loan estimate...</div>
            </Show>
            <Show when={loanEstimate.data}>
              <div class="text-xs text-green-600 mt-1">
                ≈ {formatSOL(loanEstimate.data!.solAmount)} SOL available to borrow
              </div>
            </Show>
          </Show>
          <Show when={tokenBalance.error()}>
            <div class="text-xs text-red-500 mt-1">
              Error loading balance: {tokenBalance.error()}
            </div>
          </Show>
        </div>
        
        {/* Duration Selection - Visual Timeline */}
        <div>
          <label class="block text-sm font-medium mb-4">Loan Duration</label>
          
          <div class="flex items-center gap-3">
            {/* Left label - FIXED: Added "LTV" to make it clear */}
            <div class="text-xs font-medium text-green-500 whitespace-nowrap text-center">
              <div>+25%</div>
              <div class="text-[10px] text-green-400/70">LTV</div>
            </div>
            
            {/* Main bar container */}
            <div class="flex-1 relative">
              {/* Background bar with gradient zones */}
              <div class="h-12 rounded-lg flex overflow-hidden">
                {/* Bonus zone: 12h to 48h = 23.1% of total range */}
                <div 
                  style="width: 23.1%;" 
                  class="bg-gradient-to-r from-green-600/40 to-green-500/20 flex items-center justify-center border-r border-green-500/30"
                >
                  <span class="text-[10px] text-green-400 font-medium">BONUS LTV</span>
                </div>
                {/* Reduced zone: 48h to 168h = 76.9% */}
                <div 
                  style="width: 76.9%;" 
                  class="bg-gradient-to-r from-gray-600/20 to-red-500/30"
                />
              </div>
              
              {/* Invisible range slider */}
              <input
                type="range"
                min={12 * 60 * 60}
                max={7 * 24 * 60 * 60}
                step={60 * 60}
                value={duration()}
                onInput={(e) => debouncedSetDuration(parseInt(e.currentTarget.value))}
                class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              
              {/* Position indicator (white bar with bubble) */}
              <div 
                class="absolute top-0 h-12 w-1 bg-white rounded shadow-lg pointer-events-none transition-all duration-75"
                style={`left: ${((duration() / 3600) - 12) / 156 * 100}%`}
              >
                <div class="absolute -top-7 left-1/2 -translate-x-1/2 bg-white text-black text-xs px-2 py-1 rounded font-bold whitespace-nowrap">
                  {formatDurationDisplay(duration())}
                </div>
              </div>
              
              {/* Time markers */}
              <div class="relative h-6 mt-2">
                {[
                  { label: '12h', hours: 12 },
                  { label: '1d', hours: 24 },
                  { label: '2d', hours: 48 },
                  { label: '3d', hours: 72 },
                  { label: '4d', hours: 96 },
                  { label: '5d', hours: 120 },
                  { label: '6d', hours: 144 },
                  { label: '7d', hours: 168 },
                ].map(marker => (
                  <button
                    onClick={() => setDuration(marker.hours * 60 * 60)}
                    class={`absolute text-xs transform -translate-x-1/2 transition-all hover:text-green-400 ${
                      Math.floor(duration() / 3600) === marker.hours
                        ? 'text-green-400 font-bold'
                        : 'text-gray-500'
                    }`}
                    style={`left: ${(marker.hours - 12) / 156 * 100}%`}
                  >
                    {marker.label}
                  </button>
                ))}
              </div>
            </div>
            
            {/* Right label - FIXED: Added "LTV" to make it clear */}
            <div class="text-xs font-medium text-red-500 whitespace-nowrap text-center">
              <div>-25%</div>
              <div class="text-[10px] text-red-400/70">LTV</div>
            </div>
          </div>
        </div>
        
        {/* Loan Estimate - FIXED: Always show container when inputs are valid */}
        <Show when={selectedToken() && collateralAmount() && tokenVerification.data()?.isValid}>
          <div class="bg-muted p-4 rounded-lg space-y-3">
            <div class="flex justify-between items-center">
              <h3 class="font-medium">Loan Terms</h3>
              {/* Show loading indicator without hiding the content */}
              <Show when={loanEstimate.isFetching}>
                <span class="text-xs text-muted-foreground animate-pulse">Updating...</span>
              </Show>
            </div>
            
            <div class={`space-y-2 text-sm transition-opacity duration-150 ${loanEstimate.isFetching ? 'opacity-60' : 'opacity-100'}`}>
              {/* Use displayedLoanEstimate which falls back to cached data */}
              <Show 
                when={displayedLoanEstimate()} 
                fallback={
                  // Skeleton loader for initial load only
                  <div class="space-y-2 animate-pulse">
                    <div class="flex justify-between">
                      <span>SOL Amount</span>
                      <span class="bg-muted-foreground/20 rounded w-20 h-4" />
                    </div>
                    <div class="flex justify-between">
                      <span>Protocol Fee</span>
                      <span>2.0%</span>
                    </div>
                    <div class="flex justify-between">
                      <span>Total to Repay</span>
                      <span class="bg-muted-foreground/20 rounded w-20 h-4" />
                    </div>
                    <div class="flex justify-between">
                      <span>Liquidation Price</span>
                      <span class="bg-muted-foreground/20 rounded w-16 h-4" />
                    </div>
                    <div class="flex justify-between">
                      <span>LTV Ratio</span>
                      <span class="bg-muted-foreground/20 rounded w-16 h-4" />
                    </div>
                    <div class="flex justify-between">
                      <span>Duration</span>
                      <span>{formatDuration(duration())}</span>
                    </div>
                  </div>
                }
              >
                <div class="flex justify-between">
                  <span>SOL Amount</span>
                  <span class="font-medium">{formatSOL(displayedLoanEstimate()!.solAmount)} SOL</span>
                </div>
                <div class="flex justify-between">
                  <span>Protocol Fee</span>
                  <span>2.0%</span>
                </div>
                <div class="flex justify-between">
                  <span>Total to Repay</span>
                  <span class="font-medium">{formatSOL(displayedLoanEstimate()!.totalOwed)} SOL</span>
                </div>
                <div class="flex justify-between">
                  <span>Liquidation Price</span>
                  <span class="text-red-600">${formatNumber(displayedLoanEstimate()!.liquidationPrice)}</span>
                </div>
                <div class="flex justify-between">
                  <span>LTV Ratio</span>
                  <span class="flex items-center gap-2">
                    <span class="font-medium">{formatPercentage(displayedLoanEstimate()!.ltv)}</span>
                    <Show when={displayedLoanEstimate()!.ltvModifier && displayedLoanEstimate()!.ltvModifier !== '0%'}>
                      <span class={`text-xs ${
                        displayedLoanEstimate()!.ltvModifier?.startsWith('+') 
                          ? 'text-green-600' 
                          : 'text-red-600'
                      }`}>
                        ({displayedLoanEstimate()!.ltvModifier})
                      </span>
                    </Show>
                  </span>
                </div>
                <div class="flex justify-between">
                  <span>Duration</span>
                  <span>{formatDuration(duration())}</span>
                </div>
              </Show>
            </div>

            {/* Duration impact hint - IMPROVED */}
            <div class="text-xs text-muted-foreground mt-2 border-t border-border/50 pt-2">
              💡 <span class="text-green-500">Green zone</span> = shorter loan = bonus LTV (up to +25%). 
              <span class="text-red-500">Red zone</span> = longer loan = reduced LTV (up to -25%).
            </div>
          </div>
        </Show>
        
        {/* Token Verification Status */}
        <Show when={selectedToken()}>
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
                          {verification.tier === 'bronze' && ' (25% base LTV)'}
                          {verification.tier === 'silver' && ' (35% base LTV)'}
                          {verification.tier === 'gold' && ' (50% base LTV)'}
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
            
          </div>
        </Show>

        {/* Create Loan Button */}
        <Button
          onClick={handleCreateLoan}
          loading={createLoanMutation.isPending}
          disabled={
            !wallet.connected() || 
            !loanEstimate.data ||
            !tokenVerification.data()?.isValid || 
            loanEligibility.canCreate() === false
          }
          class="w-full"
          size="lg"
        >
          <Show when={!wallet.connected()} fallback={
            <Show when={tokenVerification.data() && !tokenVerification.data()?.isValid} fallback="Create Loan">
              Token Not Verified
            </Show>
          }>
            Connect Wallet to Continue
          </Show>
        </Button>
        
        <Show when={createLoanMutation.error}>
          <div class="text-center p-4 bg-red-50 border border-red-200 rounded-lg">
            <div class="text-red-800 font-medium">Error Creating Loan</div>
            <div class="text-red-600 text-sm mt-1">
              {createLoanMutation.error?.message}
            </div>
          </div>
        </Show>
      </div>
      
      {/* Success Modal */}
      <SuccessModal
        isOpen={showSuccessModal()}
        onClose={() => setShowSuccessModal(false)}
        title="Loan Created Successfully!"
        subtitle="Your loan has been created and your collateral has been locked"
        details={loanResult() ? [
          { label: "Principal Amount", value: formatSOL(loanResult().estimate.solAmount) + " SOL", highlight: true },
          { label: "Collateral Locked", value: formatNumber(collateralAmount()) + " tokens" },
          { label: "Protocol Fee", value: "2.0%" },
          { label: "Duration", value: formatDuration(duration()) },
          { label: "Due Date", value: new Date(Date.now() + duration() * 1000).toLocaleDateString() },
          { label: "Total to Repay", value: formatSOL(loanResult().estimate.totalOwed) + " SOL" },
          { label: "Liquidation Price", value: "$" + formatNumber(loanResult().estimate.liquidationPrice) },
        ] : []}
        transactionSignature={loanResult()?.signature}
        primaryAction={{
          label: "View My Loans",
          onClick: () => navigate('/loans')
        }}
        secondaryAction={{
          label: "Create Another",
          onClick: () => {
            // Reset form
            setSelectedToken('');
            setCollateralAmount('');
            setDuration(48 * 60 * 60); // Reset to 2d default
            setLoanResult(null);
          }
        }}
      />
    </div>
  );
}