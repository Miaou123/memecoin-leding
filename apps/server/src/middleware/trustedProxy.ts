import { Context, Next } from 'hono';

// Configure trusted proxy IPs/ranges
// In production, these should come from environment variables
const TRUSTED_PROXIES = new Set([
  '127.0.0.1',
  '::1',
  // Add your Cloudflare IPs, load balancer IPs, etc.
  // Cloudflare IPv4 ranges: https://www.cloudflare.com/ips-v4
]);

// Cloudflare IP ranges (add all from https://www.cloudflare.com/ips/)
const CLOUDFLARE_IPV4_RANGES = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

/**
 * Check if an IP is in CIDR range
 */
function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);
  
  const ipInt = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);
  const rangeInt = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0);
  
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * Check if IP is a trusted proxy
 */
function isTrustedProxy(ip: string): boolean {
  if (TRUSTED_PROXIES.has(ip)) {
    return true;
  }
  
  // Check Cloudflare ranges
  for (const range of CLOUDFLARE_IPV4_RANGES) {
    if (ipInCidr(ip, range)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Get the real client IP, only trusting headers from known proxies
 */
export function getClientIp(c: Context): string {
  // Get the direct connection IP (this is the IP that connected to our server)
  // In Hono/Node, this comes from the socket
  const directIp = c.env?.remoteAddr || 
                   (c.req as any).raw?.socket?.remoteAddress ||
                   'unknown';
  
  // If direct connection is from a trusted proxy, we can trust forwarded headers
  if (isTrustedProxy(directIp)) {
    // Cloudflare provides the real IP in CF-Connecting-IP
    const cfIp = c.req.header('CF-Connecting-IP');
    if (cfIp) {
      return cfIp;
    }
    
    // X-Forwarded-For contains: client, proxy1, proxy2, ...
    // The rightmost untrusted IP is the client
    const xff = c.req.header('X-Forwarded-For');
    if (xff) {
      const ips = xff.split(',').map(ip => ip.trim());
      // Find the rightmost IP that isn't a trusted proxy
      for (let i = ips.length - 1; i >= 0; i--) {
        if (!isTrustedProxy(ips[i])) {
          return ips[i];
        }
      }
    }
    
    // X-Real-IP from nginx
    const realIp = c.req.header('X-Real-IP');
    if (realIp) {
      return realIp;
    }
  }
  
  // Not from trusted proxy - use direct connection IP
  // This prevents header spoofing from untrusted sources
  return directIp;
}

/**
 * Middleware that sets the validated client IP on the context
 */
export const trustedProxyMiddleware = async (c: Context, next: Next) => {
  const clientIp = getClientIp(c);
  c.set('clientIp', clientIp);
  await next();
};

/**
 * Helper to get client IP from context (use after middleware)
 */
export function getIp(c: Context): string {
  return c.get('clientIp') || getClientIp(c);
}