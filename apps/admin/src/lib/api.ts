export function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return 'http://localhost:4000';
    }
    if (hostname.includes('loca.lt')) {
      return 'https://xpos-api-cloud.loca.lt';
    }
    if (/^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname)) {
      return `http://${hostname}:4000`;
    }
    return process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';
  }
  return process.env.NEXT_PUBLIC_API_URL || 'https://xpos-printing-cloud.onrender.com';
}
