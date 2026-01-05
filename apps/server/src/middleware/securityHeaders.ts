import { Context, Next } from 'hono';

interface SecurityHeadersConfig {
  contentSecurityPolicy?: boolean | Record<string, string[]>;
  crossOriginEmbedderPolicy?: boolean | string;
  crossOriginOpenerPolicy?: boolean | string;
  crossOriginResourcePolicy?: boolean | string;
  originAgentCluster?: boolean;
  referrerPolicy?: boolean | string;
  strictTransportSecurity?: boolean | { maxAge: number; includeSubDomains?: boolean; preload?: boolean };
  xContentTypeOptions?: boolean;
  xDnsPrefetchControl?: boolean;
  xDownloadOptions?: boolean;
  xFrameOptions?: boolean | string;
  xPermittedCrossDomainPolicies?: boolean | string;
  xXssProtection?: boolean;
}

const defaultConfig: SecurityHeadersConfig = {
  contentSecurityPolicy: {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'https:'],
    'connect-src': [
      "'self'",
      'wss:',
      'https://api.jup.ag',
      'https://*.helius-rpc.com',
      'https://api.mainnet-beta.solana.com',
      'https://api.devnet.solana.com',
    ],
    'font-src': ["'self'"],
    'object-src': ["'none'"],
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'upgrade-insecure-requests': [],
  },
  crossOriginEmbedderPolicy: 'require-corp',
  crossOriginOpenerPolicy: 'same-origin',
  crossOriginResourcePolicy: 'same-origin',
  originAgentCluster: true,
  referrerPolicy: 'strict-origin-when-cross-origin',
  strictTransportSecurity: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  xContentTypeOptions: true,
  xDnsPrefetchControl: true,
  xDownloadOptions: true,
  xFrameOptions: 'DENY',
  xPermittedCrossDomainPolicies: 'none',
  xXssProtection: false, // Deprecated, can cause issues in older browsers
};

function buildCspString(policy: Record<string, string[]>): string {
  return Object.entries(policy)
    .map(([directive, values]) => {
      if (values.length === 0) {
        return directive;
      }
      return `${directive} ${values.join(' ')}`;
    })
    .join('; ');
}

export const securityHeadersMiddleware = (config: SecurityHeadersConfig = defaultConfig) => {
  return async (c: Context, next: Next) => {
    await next();
    
    // Content-Security-Policy
    if (config.contentSecurityPolicy) {
      const csp = typeof config.contentSecurityPolicy === 'object'
        ? buildCspString(config.contentSecurityPolicy)
        : "default-src 'self'";
      c.header('Content-Security-Policy', csp);
    }
    
    // Cross-Origin-Embedder-Policy
    if (config.crossOriginEmbedderPolicy) {
      const value = typeof config.crossOriginEmbedderPolicy === 'string'
        ? config.crossOriginEmbedderPolicy
        : 'require-corp';
      c.header('Cross-Origin-Embedder-Policy', value);
    }
    
    // Cross-Origin-Opener-Policy
    if (config.crossOriginOpenerPolicy) {
      const value = typeof config.crossOriginOpenerPolicy === 'string'
        ? config.crossOriginOpenerPolicy
        : 'same-origin';
      c.header('Cross-Origin-Opener-Policy', value);
    }
    
    // Cross-Origin-Resource-Policy
    if (config.crossOriginResourcePolicy) {
      const value = typeof config.crossOriginResourcePolicy === 'string'
        ? config.crossOriginResourcePolicy
        : 'same-origin';
      c.header('Cross-Origin-Resource-Policy', value);
    }
    
    // Origin-Agent-Cluster
    if (config.originAgentCluster) {
      c.header('Origin-Agent-Cluster', '?1');
    }
    
    // Referrer-Policy
    if (config.referrerPolicy) {
      const value = typeof config.referrerPolicy === 'string'
        ? config.referrerPolicy
        : 'strict-origin-when-cross-origin';
      c.header('Referrer-Policy', value);
    }
    
    // Strict-Transport-Security
    if (config.strictTransportSecurity) {
      let value = '';
      if (typeof config.strictTransportSecurity === 'object') {
        value = `max-age=${config.strictTransportSecurity.maxAge}`;
        if (config.strictTransportSecurity.includeSubDomains) {
          value += '; includeSubDomains';
        }
        if (config.strictTransportSecurity.preload) {
          value += '; preload';
        }
      } else {
        value = 'max-age=31536000; includeSubDomains';
      }
      c.header('Strict-Transport-Security', value);
    }
    
    // X-Content-Type-Options
    if (config.xContentTypeOptions) {
      c.header('X-Content-Type-Options', 'nosniff');
    }
    
    // X-DNS-Prefetch-Control
    if (config.xDnsPrefetchControl) {
      c.header('X-DNS-Prefetch-Control', 'off');
    }
    
    // X-Download-Options
    if (config.xDownloadOptions) {
      c.header('X-Download-Options', 'noopen');
    }
    
    // X-Frame-Options
    if (config.xFrameOptions) {
      const value = typeof config.xFrameOptions === 'string'
        ? config.xFrameOptions
        : 'DENY';
      c.header('X-Frame-Options', value);
    }
    
    // X-Permitted-Cross-Domain-Policies
    if (config.xPermittedCrossDomainPolicies) {
      const value = typeof config.xPermittedCrossDomainPolicies === 'string'
        ? config.xPermittedCrossDomainPolicies
        : 'none';
      c.header('X-Permitted-Cross-Domain-Policies', value);
    }
    
    // X-XSS-Protection (disabled by default as it's deprecated)
    if (config.xXssProtection) {
      c.header('X-XSS-Protection', '0');
    }
  };
};

// Pre-configured for API responses (less restrictive CSP since we're not serving HTML)
export const apiSecurityHeaders = securityHeadersMiddleware({
  ...defaultConfig,
  // API doesn't serve HTML, so we can be more restrictive
  contentSecurityPolicy: {
    'default-src': ["'none'"],
    'frame-ancestors': ["'none'"],
  },
});

// Export default config for customization
export { defaultConfig as securityHeadersDefaultConfig };