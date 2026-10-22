export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('api') === 'local') {
      return 'http://localhost:4000';
    }
    const hostname = window.location.hostname;
    if (hostname.includes('loca.lt')) {
      return 'https://xpos-api-cloud.loca.lt';
    }
    return 'https://xpos-printing-cloud.onrender.com';
  }
  return 'https://xpos-printing-cloud.onrender.com';
}
