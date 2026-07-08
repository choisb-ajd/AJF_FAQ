import { useEffect } from 'react';
import '../styles/globals.css';
import { prefetchAll } from '../lib/dataCache';

export default function App({ Component, pageProps }) {
  const role = pageProps && pageProps.role;

  useEffect(() => {
    if (role) prefetchAll(role);
  }, [role]);

  return <Component {...pageProps} />;
}
