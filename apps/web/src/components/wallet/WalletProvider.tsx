import { createContext, createSignal, useContext, onMount, ParentComponent } from 'solid-js';
import { Connection, PublicKey } from '@solana/web3.js';
import { getNetworkConfig } from '@memecoin-lending/config';

interface WalletContextType {
  connected: () => boolean;
  connecting: () => boolean;
  publicKey: () => PublicKey | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
}

const WalletContext = createContext<WalletContextType>();

export const WalletProvider: ParentComponent = (props) => {
  const [connected, setConnected] = createSignal(false);
  const [connecting, setConnecting] = createSignal(false);
  const [publicKey, setPublicKey] = createSignal<PublicKey | null>(null);
  
  let wallet: any = null;
  
  const networkConfig = getNetworkConfig();
  const connection = new Connection(networkConfig.rpcUrl, 'confirmed');
  
  const connect = async () => {
    if (typeof window === 'undefined') return;
    
    setConnecting(true);
    
    try {
      // Try Phantom first
      if ('solana' in window) {
        const { solana } = window as any;
        
        if (solana?.isPhantom) {
          const response = await solana.connect();
          wallet = solana;
          setPublicKey(new PublicKey(response.publicKey));
          setConnected(true);
          
          // Listen for account changes
          solana.on('accountChanged', (publicKey: any) => {
            if (publicKey) {
              setPublicKey(new PublicKey(publicKey));
            } else {
              disconnect();
            }
          });
          
          // Listen for disconnection
          solana.on('disconnect', () => {
            disconnect();
          });
        }
      } else {
        // Redirect to Phantom installation
        window.open('https://phantom.app/', '_blank');
      }
    } catch (error) {
      console.error('Failed to connect wallet:', error);
    } finally {
      setConnecting(false);
    }
  };
  
  const disconnect = () => {
    if (wallet) {
      wallet.disconnect();
    }
    wallet = null;
    setConnected(false);
    setPublicKey(null);
  };
  
  const signMessage = async (message: Uint8Array): Promise<Uint8Array> => {
    if (!wallet || !connected()) {
      throw new Error('Wallet not connected');
    }
    
    const { signature } = await wallet.signMessage(message);
    return signature;
  };
  
  onMount(() => {
    // Check if wallet is already connected
    if (typeof window !== 'undefined' && 'solana' in window) {
      const { solana } = window as any;
      if (solana?.isPhantom && solana.isConnected) {
        wallet = solana;
        setPublicKey(new PublicKey(solana.publicKey));
        setConnected(true);
      }
    }
  });
  
  const contextValue: WalletContextType = {
    connected,
    connecting,
    publicKey,
    connect,
    disconnect,
    signMessage,
  };
  
  return (
    <WalletContext.Provider value={contextValue}>
      {props.children}
    </WalletContext.Provider>
  );
};

export const useWallet = () => {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};