export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('api') === 'local') {
      localStorage.setItem('xpos_admin_api', 'http://localhost:4000');
      return 'http://localhost:4000';
    }
    if (params.get('api') === 'cloud') {
      localStorage.setItem('xpos_admin_api', 'https://xpos-printing-cloud.onrender.com');
      return 'https://xpos-printing-cloud.onrender.com';
    }
    const saved = localStorage.getItem('xpos_admin_api');
    if (saved) return saved;

    const hostname = window.location.hostname;
    if (hostname.includes('loca.lt')) {
      return 'https://xpos-api-cloud.loca.lt';
    }
    if (hostname !== 'localhost' && hostname !== '127.0.0.1' && !/^(192\.168\.|10\.|172\.)/.test(hostname)) {
      return 'https://xpos-printing-cloud.onrender.com';
    }
    return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
}
