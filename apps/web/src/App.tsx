import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { WalletProvider } from './components/wallet/WalletProvider';
import { Layout } from './components/layout/Layout';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
    },
  },
});

function App(props: { children?: any }) {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <Layout>
          {props.children}
        </Layout>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;
