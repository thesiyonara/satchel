import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './fonts/fonts.css';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { message: string }> {
  state = { message: '' };
  static getDerivedStateFromError(error: Error) { return { message: error.message }; }
  render() { return this.state.message ? <div className="fatal"><h1>Something needs a restart.</h1><p>Your files are still in your collection folder.</p><pre>{this.state.message}</pre><button onClick={() => location.reload()}>Reload dashboard</button></div> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
