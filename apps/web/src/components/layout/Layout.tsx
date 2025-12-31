import { ParentComponent } from 'solid-js';
import { Header } from './Header';
import { ToastContainer } from '../ui/Toast';

export const Layout: ParentComponent = (props) => {
  return (
    <div class="min-h-screen bg-background">
      <Header />
      <main class="container mx-auto px-4 py-8">
        {props.children}
      </main>
      <ToastContainer />
    </div>
  );
};