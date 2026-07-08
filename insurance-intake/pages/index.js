import cookie from 'cookie';
import { verifySession, COOKIE_NAME } from '../lib/auth';

export async function getServerSideProps({ req }) {
  const cookies = cookie.parse(req.headers.cookie || '');
  const session = cookies[COOKIE_NAME] ? verifySession(cookies[COOKIE_NAME]) : null;
  return {
    redirect: {
      destination: session ? '/dashboard' : '/login',
      permanent: false,
    },
  };
}

export default function IndexPage() {
  return null;
}
