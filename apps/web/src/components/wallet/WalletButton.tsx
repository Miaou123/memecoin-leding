import { Show } from 'solid-js';
import { useWallet } from './WalletProvider';
import { Button } from '../ui/Button';

export function WalletButton() {
  const wallet = useWallet();
  
  const formatAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
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
          Connect Wallet
        </Button>
      }
    >
      <div class="flex items-center gap-2">
        <div class="w-2 h-2 bg-green-500 rounded-full"></div>
        <span class="text-sm font-medium">
          {wallet.publicKey() && formatAddress(wallet.publicKey()!.toString())}
        </span>
        <Button 
          onClick={wallet.disconnect}
          variant="outline"
          size="sm"
        >
          Disconnect
        </Button>
      </div>
    </Show>
  );
}