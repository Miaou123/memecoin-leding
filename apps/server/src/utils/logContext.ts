/**
 * Helper to ensure LogContext compatibility
 */
export function toLogContext(data: unknown): Record<string, any> | undefined {
  if (!data) return undefined;
  
  // If it's already a plain object, return it
  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    return data as Record<string, any>;
  }
  
  // Otherwise wrap it
  return { data };
}