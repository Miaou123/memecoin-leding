interface ImportMetaEnv {
    readonly VITE_SOLANA_RPC_URL: string;
    readonly VITE_API_URL: string;
  }
  
  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }