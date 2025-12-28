import { Show } from 'solid-js';
import { useWallet } from './WalletProvider';
import { Button } from '../ui/Button';

export function WalletButton() {
  const wallet = useWallet();
  
  const formatAddress = (address: string) => {
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  };
  
  return (
    <Show
      when={wallet.connected()}
      fallback={
        <Button 
          onClick={wallet.connect}
          loading={wallet.connecting()}
          variant="primary"
        >
          <Show when={wallet.connecting()} fallback="CONNECT_WALLET">
            CONNECTING...
          </Show>
        </Button>
      }
    >
      <div class="flex items-center gap-3 bg-bg-secondary border border-border px-3 py-1">
        <div class="flex items-center gap-2">
          <div class="w-2 h-2 bg-accent-green"></div>
          <span class="font-mono text-xs text-text-primary">
            WALLET:{wallet.publicKey() && formatAddress(wallet.publicKey()!.toString())}
          </span>
        </div>
        <Button 
          onClick={wallet.disconnect}
          variant="outline"
          size="sm"
        >
          [DISCONNECT]
        </Button>
      </div>
    </Show>
  );
}