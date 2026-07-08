// 로그인 직후 데이터를 미리 받아두는 공용 캐시입니다.
// 브라우저 탭이 열려있는 동안(전체 새로고침 전까지) 메모리에 유지되므로,
// 사용자가 실제로 그 화면에 들어갔을 때 다시 불러올 필요 없이 바로 화면을 그릴 수 있습니다.

const store = new Map(); // key -> { data, etag, fetchedAt }
const inflight = new Map(); // key -> Promise<data|null>

function getEntry(key) {
  return store.get(key) || null;
}

function setEntry(key, data, etag) {
  const entry = { data, etag: etag || null, fetchedAt: Date.now() };
  store.set(key, entry);
  return entry;
}

function touchEntry(key) {
  const entry = store.get(key);
  if (entry) entry.fetchedAt = Date.now();
  return entry;
}

// 기존 캐시 데이터에 일부 필드만 덮어써서 갱신합니다(로컬 저장 등 즉시 반영용).
function mergeEntry(key, patch) {
  const existing = getEntry(key);
  const data = existing ? { ...existing.data, ...patch } : { ...patch };
  return setEntry(key, data, existing ? existing.etag : null);
}

// 같은 key로 동시에 여러 곳에서 요청해도 실제 네트워크 요청은 한 번만 보내고 결과를 함께 사용합니다.
// force=true면 캐시/ETag/중복방지를 모두 건너뛰고 무조건 새로 받아옵니다.
function fetchAndCache(key, url, { force = false } = {}) {
  if (!force && inflight.has(key)) return inflight.get(key);

  const existing = !force ? getEntry(key) : null;
  const headers = {};
  if (existing && existing.etag) headers['If-None-Match'] = existing.etag;
  const finalUrl = force ? `${url}${url.includes('?') ? '&' : '?'}force=1` : url;

  const promise = fetch(finalUrl, { headers })
    .then(async (res) => {
      if (res.status === 304) {
        const entry = touchEntry(key);
        return entry ? entry.data : null;
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '불러오지 못했습니다.');
      setEntry(key, data, res.headers.get('ETag'));
      return data;
    })
    .finally(() => {
      inflight.delete(key);
    });

  if (!force) inflight.set(key, promise);
  return promise;
}

const PREFETCH_ENDPOINTS = [
  { key: 'intake', url: '/api/intake' },
];

let prefetched = false;

// 로그인 직후(또는 첫 인증 페이지 진입 시) 한 번만 호출됩니다.
function prefetchAll(role) {
  if (prefetched) return;
  prefetched = true;
  const endpoints = role === '관리자'
    ? [...PREFETCH_ENDPOINTS, { key: 'accounts', url: '/api/accounts' }]
    : PREFETCH_ENDPOINTS;
  endpoints.forEach(({ key, url }) => {
    fetchAndCache(key, url).catch(() => {});
  });
}

module.exports = { getEntry, setEntry, touchEntry, mergeEntry, fetchAndCache, prefetchAll };
