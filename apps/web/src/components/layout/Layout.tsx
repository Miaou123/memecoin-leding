import { ParentComponent } from 'solid-js';
import { Header } from './Header';
import { ToastContainer } from '../ui/Toast';
import { ProtocolPausedBanner } from '../ui/ProtocolPausedBanner';
import { useProtocolStatus } from '@/hooks/useProtocolStatus';

export const Layout: ParentComponent = (props) => {
  const protocolStatus = useProtocolStatus();

  return (
    <div class="min-h-screen bg-background">
      <Header />
      <ProtocolPausedBanner 
        isPaused={protocolStatus.data?.paused ?? false}
        message={protocolStatus.data?.pauseReason}
      />
      <main class="container mx-auto px-4 py-8">
        {props.children}
      </main>
      <ToastContainer />
    </div>
  );
};