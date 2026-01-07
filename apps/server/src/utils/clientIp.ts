import type { Context } from 'hono';

/**
 * Get client IP from request, considering proxy headers
 */
export function getClientIp(c: Context): string {
  // Try various headers in order of preference
  const headers = [
    'cf-connecting-ip',      // Cloudflare
    'x-forwarded-for',       // Standard proxy header
    'x-real-ip',             // Nginx
    'x-client-ip',           // Apache
    'forwarded',             // RFC 7239
  ];
  
  for (const header of headers) {
    const value = c.req.header(header);
    if (value) {
      // x-forwarded-for can contain multiple IPs, use the first one
      const ip = value.split(',')[0]?.trim();
      if (ip && isValidIp(ip)) {
        return ip;
      }
    }
  }
  
  // Fallback to connection remote address
  return c.env?.remoteAddr || '127.0.0.1';
}

/**
 * Basic IP validation
 */
function isValidIp(ip: string): boolean {
  // IPv4 regex
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6 regex (simplified)
  const ipv6Regex = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$/;
  
  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
}