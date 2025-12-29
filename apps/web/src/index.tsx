import "./polyfills";
import { Buffer } from 'buffer';
import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import App from './App';
import Home from './routes/index';
import Borrow from './routes/borrow';
import Loans from './routes/loans';
import Staking from './routes/staking';
import Repay from './routes/repay/[id]';
import './styles/globals.css';

(globalThis as any).Buffer = Buffer;

const root = document.getElementById('root');

if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error('Root element not found.');
}

render(() => (
  <Router root={App}>
    <Route path="/" component={Home} />
    <Route path="/borrow" component={Borrow} />
    <Route path="/loans" component={Loans} />
    <Route path="/staking" component={Staking} />
    <Route path="/repay/:id" component={Repay} />
  </Router>
), root!);
