import { createQuery } from '@tanstack/solid-query';
import { api } from '@/lib/api';

export interface ProtocolStatus {
  paused: boolean;
  pauseReason?: string;
  version: string;
  treasury: string;
}

export function useProtocolStatus() {
  return createQuery(() => ({
    queryKey: ['protocol-status'],
    queryFn: async (): Promise<ProtocolStatus> => {
      try {
        // Fetch from your API endpoint
        const response = await api.getProtocolStatus();
        return response;
      } catch (error) {
        // Default to not paused if we can't fetch status
        return {
          paused: false,
          version: 'unknown',
          treasury: '',
        };
      }
    },
    refetchInterval: 30000, // Check every 30 seconds
    staleTime: 10000,
  }));
}