import { useEffect } from 'react';
import '../styles/globals.css';
import { prefetchAll } from '../lib/dataCache';

export default function App({ Component, pageProps }) {
  const role = pageProps && pageProps.role;

  // 로그인된 페이지에 처음 들어오는 순간(역할 정보가 있는 시점) 모든 탭의 데이터를
  // 백그라운드에서 한 번만 미리 불러옵니다. 이후 다른 탭으로 이동하면 캐시된 데이터로
  // 즉시 화면이 그려집니다.
  useEffect(() => {
    if (role) prefetchAll(role);
  }, [role]);

  return <Component {...pageProps} />;
}
