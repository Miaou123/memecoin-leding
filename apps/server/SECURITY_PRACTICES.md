# Security Practices

## Input Sanitization

All user input MUST be sanitized before use. This codebase provides utilities in `src/utils/inputSanitizer.ts`.

### Required Sanitization by Input Type

| Input Type | Function | Example |
|------------|----------|---------|
| Solana addresses | `sanitizeSolanaAddress()` | Wallet, mint, program IDs |
| URLs | `sanitizeUrl()` | Logo URLs, external links |
| Free text | `sanitizeString()` | Names, descriptions, notes |
| Search queries | `sanitizeSearchQuery()` | Search inputs |
| Numbers | `sanitizeInteger()`, `sanitizeNumericString()` | Amounts, counts |
| Arrays | `sanitizeStringArray()` | Tags, lists |

### Zod Validators

Use pre-built Zod schemas from `src/validators/index.ts`:

```typescript
import { solanaAddressSchema, safeStringSchema } from '../validators';

const schema = z.object({
  mint: solanaAddressSchema,  // Auto-validates and sanitizes
  name: safeStringSchema(100), // Max 100 chars, strips HTML
});
```

### Security Rules

1. **NEVER** use raw user input in:
   - SQL queries (even with Prisma, avoid `$queryRaw` with user input)
   - Log messages (use `sanitizeForLogging()`)
   - HTML responses (use `escapeHtml()`)
   - File paths
   - Shell commands

2. **ALWAYS** validate:
   - Solana addresses with `sanitizeSolanaAddress()`
   - URLs with `sanitizeUrl()` (blocks javascript:, data:, etc.)
   - Numeric inputs with range checks

3. **LIMIT** all inputs:
   - String lengths
   - Array sizes
   - Number ranges

### Example: Secure Route Handler

```typescript
import { zValidator } from '@hono/zod-validator';
import { solanaAddressSchema, safeStringSchema } from '../validators';
import { sanitizeForLogging } from '../utils/inputSanitizer';

app.post(
  '/api/example',
  zValidator('json', z.object({
    address: solanaAddressSchema,
    name: safeStringSchema(100),
  })),
  async (c) => {
    const { address, name } = c.req.valid('json');
    // address and name are now sanitized and safe to use
    
    logger.info('Processing request', {
      address: sanitizeForLogging(address.substring(0, 8) + '...'),
    });
    
    // Use sanitized values...
  }
);
```