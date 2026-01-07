import { Show, createMemo, createSignal } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { createQuery, createMutation } from '@tanstack/solid-query';
import { useWallet } from '@/components/wallet/WalletProvider';
import { Button } from '@/components/ui/Button';
import { formatSOL, formatTimeRemaining, formatNumber } from '@/lib/utils';
import { api } from '@/lib/api';
import { LoanStatus } from '@memecoin-lending/types';
import { Transaction } from '@solana/web3.js';
import { createConnection } from '../../utils/rpc';
import { SuccessModal } from '@/components/ui/SuccessModal';

export default function Repay() {
  const params = useParams();
  const navigate = useNavigate();
  const wallet = useWallet();
  
  // Success modal state
  const [showSuccessModal, setShowSuccessModal] = createSignal(false);
  const [repayResult, setRepayResult] = createSignal<any>(null);
  
  const loan = createQuery(() => ({
    queryKey: ['loan', params.id],
    queryFn: () => api.getLoan(params.id),
    enabled: () => Boolean(params.id),
  }));
  
  const repayMutation = createMutation(() => ({
    mutationFn: async () => {
      if (!wallet.connected()) {
        throw new Error('Wallet not connected');
      }
      
      // Get unsigned transaction from API
      const { transaction: encodedTransaction } = await api.repayLoanUnsigned(
        params.id,
        wallet.publicKey()!.toString()
      );
      
      // Deserialize the transaction
      const transactionBuffer = Buffer.from(encodedTransaction, 'base64');
      const transaction = Transaction.from(transactionBuffer);
      
      // Get a fresh blockhash
      const connection = createConnection();
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet.publicKey()!;
      
      // Sign and send the transaction
      const signedTransaction = await wallet.signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      
      // Wait for confirmation
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });
      
      // Confirm repayment in database
      const updatedLoan = await api.confirmRepayment(params.id, signature);
      
      return { 
        signature, 
        loan: loan.data!,
        updatedLoan 
      };
    },
    onSuccess: (result) => {
      setRepayResult(result);
      setShowSuccessModal(true);
    },
    onError: (error) => {
      console.error('Repayment failed:', error);
      // Error is already shown by the existing error display in the UI
    },
  }));
  
  const canRepay = createMemo(() => {
    const loanData = loan.data;
    if (!loanData || !wallet.connected()) return false;
    
    return loanData.status === LoanStatus.Active &&
           loanData.borrower === wallet.publicKey()?.toString();
  });
  
  const totalToRepay = createMemo(() => {
    const loanData = loan.data;
    if (!loanData) return '0';
    
    // Calculate total including 1% flat fee
    const principal = parseFloat(loanData.solBorrowed);
    const protocolFee = principal * 0.01; // 1% flat fee
    
    return (principal + protocolFee).toString();
  });
  
  const isOverdue = createMemo(() => {
    const loanData = loan.data;
    if (!loanData) return false;
    
    return loanData.status === LoanStatus.Active && 
           Date.now() / 1000 > loanData.dueAt;
  });
  
  return (
    <div class="max-w-2xl mx-auto space-y-8">
      <Show when={loan.isLoading}>
        <div class="text-center py-8">
          <div class="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
          <p class="text-muted-foreground">Loading loan details...</p>
        </div>
      </Show>
      
      <Show when={loan.error}>
        <div class="text-center py-8">
          <div class="text-red-600 mb-2">Failed to load loan</div>
          <p class="text-muted-foreground mb-4">
            {loan.error?.message}
          </p>
          <Button onClick={() => loan.refetch()}>
            Try Again
          </Button>
        </div>
      </Show>
      
      <Show when={loan.data}>
        <div class="space-y-6">
          <div class="text-center">
            <h1 class="text-3xl font-bold">Repay Loan</h1>
            <p class="text-muted-foreground mt-2">
              Review your loan details and repay to reclaim your collateral
            </p>
          </div>
          
          {/* Loan Overview */}
          <div class="bg-card p-6 rounded-lg border">
            <h2 class="text-xl font-semibold mb-4">Loan Overview</h2>
            <div class="grid md:grid-cols-2 gap-6">
              <div class="space-y-3">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Borrowed Amount</span>
                  <span class="font-medium">{formatSOL(loan.data!.solBorrowed)} SOL</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Collateral</span>
                  <span class="font-medium">{formatSOL(loan.data!.collateralAmount)} tokens</span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Protocol Fee</span>
                  <span class="font-medium">1.0%</span>
                </div>
              </div>
              
              <div class="space-y-3">
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Status</span>
                  <span class={`font-medium ${
                    loan.data!.status === LoanStatus.Active 
                      ? isOverdue() ? 'text-red-600' : 'text-green-600'
                      : 'text-gray-600'
                  }`}>
                    {loan.data!.status === LoanStatus.Active && isOverdue() ? 'Overdue' : loan.data!.status}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Time Remaining</span>
                  <span class={`font-medium ${isOverdue() ? 'text-red-600' : ''}`}>
                    {formatTimeRemaining(loan.data!.dueAt)}
                  </span>
                </div>
                <div class="flex justify-between">
                  <span class="text-muted-foreground">Due Date</span>
                  <span class="font-medium">
                    {new Date(loan.data!.dueAt * 1000).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          </div>
          
          <Show when={isOverdue()}>
            <div class="bg-red-50 border border-red-200 p-4 rounded-lg">
              <div class="text-red-800 font-medium">⚠️ Loan is Overdue</div>
              <div class="text-red-600 text-sm mt-1">
                This loan is past its due date and may be liquidated at any time. 
                Repay immediately to avoid losing your collateral.
              </div>
            </div>
          </Show>
          
          {/* Repayment Details */}
          <Show when={canRepay()}>
            <div class="bg-card p-6 rounded-lg border">
              <h2 class="text-xl font-semibold mb-4">Repayment Details</h2>
              <div class="space-y-4">
                <div class="flex justify-between items-center py-3 border-b">
                  <span class="text-muted-foreground">Principal</span>
                  <span class="font-medium">{formatSOL(loan.data!.solBorrowed)} SOL</span>
                </div>
                <div class="flex justify-between items-center py-3 border-b">
                  <span class="text-muted-foreground">Protocol Fee (1%)</span>
                  <span class="font-medium">
                    {formatSOL((parseFloat(totalToRepay()) - parseFloat(loan.data!.solBorrowed)).toString())} SOL
                  </span>
                </div>
                <div class="flex justify-between items-center py-3 text-lg font-semibold">
                  <span>Total to Repay</span>
                  <span>{formatSOL(totalToRepay())} SOL</span>
                </div>
              </div>
              
              <div class="mt-6">
                <Button
                  onClick={() => repayMutation.mutate()}
                  loading={repayMutation.isPending}
                  size="lg"
                  class="w-full"
                >
                  Repay Loan
                </Button>
              </div>
            </div>
          </Show>
          
          <Show when={!canRepay() && loan.data?.status !== LoanStatus.Active}>
            <div class="text-center py-8">
              <h2 class="text-xl font-semibold mb-2">Loan Already Settled</h2>
              <p class="text-muted-foreground">
                This loan has already been {loan.data?.status.toLowerCase()}.
              </p>
            </div>
          </Show>
          
          <Show when={loan.data?.borrower !== wallet.publicKey()?.toString()}>
            <div class="text-center py-8">
              <h2 class="text-xl font-semibold mb-2">Access Denied</h2>
              <p class="text-muted-foreground">
                You can only repay loans that belong to your wallet.
              </p>
            </div>
          </Show>
          
          <Show when={repayMutation.error}>
            <div class="bg-red-50 border border-red-200 p-4 rounded-lg">
              <div class="text-red-800 font-medium">Repayment Failed</div>
              <div class="text-red-600 text-sm mt-1">
                {repayMutation.error?.message}
              </div>
            </div>
          </Show>
        </div>
      </Show>
      
      {/* Success Modal */}
      <SuccessModal
        isOpen={showSuccessModal()}
        onClose={() => setShowSuccessModal(false)}
        title="Loan Repaid Successfully!"
        subtitle="Your collateral has been returned to your wallet"
        details={repayResult() && loan.data ? (() => {
          const principal = parseFloat(loan.data.solBorrowed) / 1e9;
          const protocolFee = principal * 0.01; // 1% flat fee
          const totalRepaid = principal + protocolFee;
          
          return [
            { label: "Principal Repaid", value: formatSOL(loan.data.solBorrowed) + " SOL" },
            { label: "Protocol Fee", value: protocolFee.toFixed(6) + " SOL" },
            { label: "Total Repaid", value: totalRepaid.toFixed(6) + " SOL", highlight: true },
            { label: "Collateral Returned", value: formatNumber(parseFloat(loan.data.collateralAmount) / 1e6) + " " + loan.data.token?.symbol },
            { label: "Protocol Fee Rate", value: "1.0%" },
          ];
        })() : []}
        transactionSignature={repayResult()?.signature}
        primaryAction={{
          label: "View My Loans",
          onClick: () => navigate('/loans')
        }}
        secondaryAction={{
          label: "Close",
          onClick: () => {}
        }}
      />
    </div>
  );
}