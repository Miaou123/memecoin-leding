import { Route, Routes } from '@solidjs/router';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { WalletProvider } from './components/wallet/WalletProvider';
import { Layout } from './components/layout/Layout';
import Home from './routes/index';
import Borrow from './routes/borrow';
import Loans from './routes/loans';
import Repay from './routes/repay/[id]';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WalletProvider>
        <Layout>
          <Routes>
            <Route path="/" component={Home} />
            <Route path="/borrow" component={Borrow} />
            <Route path="/loans" component={Loans} />
            <Route path="/repay/:id" component={Repay} />
          </Routes>
        </Layout>
      </WalletProvider>
    </QueryClientProvider>
  );
}

export default App;