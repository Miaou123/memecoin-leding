import { Show, createSignal, createMemo } from 'solid-js';
import { createQuery, createMutation, useQueryClient } from '@tanstack/solid-query';
import { Button } from '@/components/ui/Button';
import { api } from '@/lib/api';
import { TokenTier } from '@memecoin-lending/types';

interface WhitelistFormData {
  mint: string;
  symbol: string;
  name: string;
  tier: TokenTier;
  ltvBps?: number;
  interestRateBps?: number;
  reason?: string;
  notes?: string;
  externalUrl?: string;
  logoUrl?: string;
  tags?: string[];
}

export default function Admin() {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [selectedEntry, setSelectedEntry] = createSignal<any>(null);
  const [filters, setFilters] = createSignal({
    enabled: undefined as boolean | undefined,
    tier: '' as TokenTier | '',
    search: '',
  });

  // Admin authentication state (implement based on your auth system)
  const [adminPrivateKey, setAdminPrivateKey] = createSignal('');
  const [isAuthenticated, setIsAuthenticated] = createSignal(false);

  // Queries
  const whitelistEntries = createQuery(() => ({
    queryKey: ['whitelist-entries', filters()],
    queryFn: () => api.admin.getWhitelistEntries({
      filters: {
        enabled: filters().enabled,
        tier: filters().tier || undefined,
        search: filters().search || undefined,
      },
      limit: 100,
    }),
    enabled: isAuthenticated(),
  }));

  const whitelistStats = createQuery(() => ({
    queryKey: ['whitelist-stats'],
    queryFn: () => api.admin.getWhitelistStats(),
    enabled: isAuthenticated(),
  }));

  // Mutations
  const addToWhitelistMutation = createMutation(() => ({
    mutationFn: (data: WhitelistFormData) => 
      api.admin.addToWhitelist(data, adminPrivateKey()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whitelist-entries'] });
      queryClient.invalidateQueries({ queryKey: ['whitelist-stats'] });
      setShowAddForm(false);
    },
  }));

  const updateWhitelistMutation = createMutation(() => ({
    mutationFn: ({ mint, data }: { mint: string; data: Partial<WhitelistFormData> }) =>
      api.admin.updateWhitelistEntry(mint, data, adminPrivateKey()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whitelist-entries'] });
      setSelectedEntry(null);
    },
  }));

  const toggleEnabledMutation = createMutation(() => ({
    mutationFn: ({ mint, enable, reason }: { mint: string; enable: boolean; reason?: string }) =>
      enable 
        ? api.admin.enableWhitelistEntry(mint, adminPrivateKey())
        : api.admin.disableWhitelistEntry(mint, reason || 'Disabled by admin', adminPrivateKey()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whitelist-entries'] });
    },
  }));

  const removeFromWhitelistMutation = createMutation(() => ({
    mutationFn: ({ mint, reason }: { mint: string; reason: string }) =>
      api.admin.removeFromWhitelist(mint, reason, adminPrivateKey()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['whitelist-entries'] });
      queryClient.invalidateQueries({ queryKey: ['whitelist-stats'] });
    },
  }));

  const handleLogin = () => {
    if (adminPrivateKey().length > 0) {
      setIsAuthenticated(true);
    }
  };

  const handleAddToken = (formData: WhitelistFormData) => {
    addToWhitelistMutation.mutate(formData);
  };

  const handleToggleEnabled = (mint: string, enabled: boolean) => {
    const reason = enabled ? undefined : prompt('Reason for disabling:') || 'Disabled by admin';
    toggleEnabledMutation.mutate({ mint, enable: !enabled, reason });
  };

  const handleRemoveToken = (mint: string) => {
    const reason = prompt('Reason for removal:');
    if (reason) {
      removeFromWhitelistMutation.mutate({ mint, reason });
    }
  };

  const formatAddress = (address: string) => 
    `${address.slice(0, 6)}...${address.slice(-4)}`;

  const getTierColor = (tier: TokenTier) => {
    switch (tier) {
      case 'gold': return 'text-accent-yellow';
      case 'silver': return 'text-accent-blue';
      case 'bronze': return 'text-accent-red';
      default: return 'text-text-primary';
    }
  };

  return (
    <div class="space-y-8 font-mono">
      {/* Admin Header */}
      <div class="bg-bg-secondary border border-border p-6">
        <div class="text-xs text-text-dim mb-2">ADMIN_PANEL v1.0.0</div>
        <div class="text-xl font-bold text-accent-red mb-4">
          {">"} WHITELIST_MANAGEMENT_SYSTEM.init()
        </div>
        
        <Show when={!isAuthenticated()}>
          <div class="space-y-4">
            <div class="text-text-secondary">ADMIN_AUTHENTICATION_REQUIRED:</div>
            <div class="flex gap-4">
              <input
                type="password"
                placeholder="PRIVATE_KEY_OR_SIGNATURE..."
                class="bg-bg-primary border border-border p-2 text-text-primary font-mono flex-1"
                value={adminPrivateKey()}
                onInput={(e) => setAdminPrivateKey(e.target.value)}
              />
              <Button onClick={handleLogin}>[AUTHENTICATE]</Button>
            </div>
          </div>
        </Show>

        <Show when={isAuthenticated()}>
          <div class="text-text-secondary">
            AUTHENTICATED_ADMIN_SESSION_ACTIVE
          </div>
        </Show>
      </div>

      <Show when={isAuthenticated()}>
        {/* Stats Dashboard */}
        <div class="space-y-4">
          <div class="text-xs text-text-dim">WHITELIST_STATISTICS:</div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">TOTAL_ENTRIES</div>
              <div class="text-lg font-bold text-accent-green">
                {whitelistStats.isLoading ? '---' : whitelistStats.data?.totalEntries || 0}
              </div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">ENABLED_ENTRIES</div>
              <div class="text-lg font-bold text-accent-blue">
                {whitelistStats.isLoading ? '---' : whitelistStats.data?.enabledEntries || 0}
              </div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">RECENT_ADDED</div>
              <div class="text-lg font-bold text-accent-yellow">
                {whitelistStats.isLoading ? '---' : whitelistStats.data?.recentlyAdded || 0}
              </div>
              <div class="text-xs text-text-secondary">LAST_7_DAYS</div>
            </div>
            <div class="bg-bg-secondary border border-border p-4">
              <div class="text-xs text-text-dim mb-1">BRONZE_TIER</div>
              <div class="text-lg font-bold text-accent-red">
                {whitelistStats.isLoading ? '---' : whitelistStats.data?.entriesByTier?.bronze || 0}
              </div>
            </div>
          </div>
        </div>

        {/* Controls */}
        <div class="flex flex-col md:flex-row gap-4 justify-between">
          <div class="flex gap-4">
            <Button 
              onClick={() => setShowAddForm(!showAddForm())}
              class="bg-accent-green text-bg-primary"
            >
              [ADD_TOKEN]
            </Button>
            <Button 
              variant="outline"
              onClick={() => whitelistEntries.refetch()}
            >
              [REFRESH]
            </Button>
          </div>

          {/* Filters */}
          <div class="flex gap-2 text-xs">
            <select 
              class="bg-bg-primary border border-border p-2 text-text-primary font-mono"
              value={filters().enabled?.toString() || ''}
              onChange={(e) => setFilters(prev => ({ 
                ...prev, 
                enabled: e.target.value === '' ? undefined : e.target.value === 'true' 
              }))}
            >
              <option value="">ALL_STATUS</option>
              <option value="true">ENABLED_ONLY</option>
              <option value="false">DISABLED_ONLY</option>
            </select>
            
            <select 
              class="bg-bg-primary border border-border p-2 text-text-primary font-mono"
              value={filters().tier}
              onChange={(e) => setFilters(prev => ({ ...prev, tier: e.target.value as TokenTier | '' }))}
            >
              <option value="">ALL_TIERS</option>
              <option value="gold">GOLD_TIER</option>
              <option value="silver">SILVER_TIER</option>
              <option value="bronze">BRONZE_TIER</option>
            </select>

            <input 
              type="text"
              placeholder="SEARCH_TOKENS..."
              class="bg-bg-primary border border-border p-2 text-text-primary font-mono"
              value={filters().search}
              onInput={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
            />
          </div>
        </div>

        {/* Add Token Form */}
        <Show when={showAddForm()}>
          <AddTokenForm 
            onSubmit={handleAddToken}
            onCancel={() => setShowAddForm(false)}
            isLoading={addToWhitelistMutation.isPending}
          />
        </Show>

        {/* Whitelist Entries */}
        <div class="space-y-4">
          <div class="text-xs text-text-dim">WHITELIST_ENTRIES:</div>
          
          <Show 
            when={!whitelistEntries.isLoading && whitelistEntries.data?.entries} 
            fallback={
              <div class="bg-bg-secondary border border-border p-6 text-center text-text-dim">
                {whitelistEntries.isLoading ? 'LOADING_ENTRIES...' : 'NO_ENTRIES_FOUND'}
              </div>
            }
          >
            <div class="space-y-2">
              {whitelistEntries.data!.entries.map((entry) => (
                <div class={`bg-bg-secondary border p-4 ${entry.enabled ? 'border-accent-green' : 'border-accent-red'}`}>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-4">
                      <div class="flex items-center gap-2">
                        <div class={`text-sm font-bold ${getTierColor(entry.tier)}`}>
                          {entry.tier.toUpperCase()}_TIER
                        </div>
                        <div class={`text-xs px-2 py-1 border ${
                          entry.enabled 
                            ? 'border-accent-green text-accent-green' 
                            : 'border-accent-red text-accent-red'
                        }`}>
                          {entry.enabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                      </div>
                      
                      <div>
                        <div class="text-text-primary font-bold">
                          {entry.symbol || 'UNKNOWN'} - {entry.name || 'Unnamed Token'}
                        </div>
                        <div class="text-xs text-text-dim">
                          MINT: {formatAddress(entry.mint)}
                        </div>
                        <div class="text-xs text-text-secondary">
                          LTV: {entry.ltvBps / 100}% | RATE: {entry.interestRateBps / 100}%
                        </div>
                      </div>
                    </div>

                    <div class="flex gap-2">
                      <Button 
                        size="sm"
                        variant="outline"
                        onClick={() => handleToggleEnabled(entry.mint, entry.enabled)}
                        disabled={toggleEnabledMutation.isPending}
                      >
                        [{entry.enabled ? 'DISABLE' : 'ENABLE'}]
                      </Button>
                      <Button 
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedEntry(entry)}
                      >
                        [EDIT]
                      </Button>
                      <Button 
                        size="sm"
                        class="bg-accent-red text-bg-primary"
                        onClick={() => handleRemoveToken(entry.mint)}
                        disabled={removeFromWhitelistMutation.isPending}
                      >
                        [REMOVE]
                      </Button>
                    </div>
                  </div>
                  
                  <Show when={entry.reason}>
                    <div class="mt-2 text-xs text-text-secondary">
                      REASON: {entry.reason}
                    </div>
                  </Show>
                </div>
              ))}
            </div>
          </Show>
        </div>

        {/* Edit Modal */}
        <Show when={selectedEntry()}>
          <EditTokenModal 
            entry={selectedEntry()!}
            onSave={(data) => updateWhitelistMutation.mutate({ 
              mint: selectedEntry()!.mint, 
              data 
            })}
            onCancel={() => setSelectedEntry(null)}
            isLoading={updateWhitelistMutation.isPending}
          />
        </Show>
      </Show>
    </div>
  );
}

// Add Token Form Component
function AddTokenForm(props: {
  onSubmit: (data: WhitelistFormData) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = createSignal<WhitelistFormData>({
    mint: '',
    symbol: '',
    name: '',
    tier: 'bronze' as TokenTier,
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    props.onSubmit(formData());
  };

  return (
    <div class="bg-bg-secondary border-2 border-accent-green p-6">
      <div class="text-sm font-bold text-accent-green mb-4">[ADD_TOKEN_TO_WHITELIST]</div>
      
      <form onSubmit={handleSubmit} class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="text-xs text-text-dim block mb-1">MINT_ADDRESS*</label>
            <input 
              type="text"
              required
              class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
              value={formData().mint}
              onInput={(e) => setFormData(prev => ({ ...prev, mint: e.target.value }))}
            />
          </div>
          
          <div>
            <label class="text-xs text-text-dim block mb-1">SYMBOL</label>
            <input 
              type="text"
              class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
              value={formData().symbol}
              onInput={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value }))}
            />
          </div>
          
          <div>
            <label class="text-xs text-text-dim block mb-1">NAME</label>
            <input 
              type="text"
              class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
              value={formData().name}
              onInput={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>
          
          <div>
            <label class="text-xs text-text-dim block mb-1">TIER*</label>
            <select 
              required
              class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
              value={formData().tier}
              onChange={(e) => setFormData(prev => ({ ...prev, tier: e.target.value as TokenTier }))}
            >
              <option value="bronze">BRONZE (50% LTV)</option>
              <option value="silver">SILVER (60% LTV)</option>
              <option value="gold">GOLD (70% LTV)</option>
            </select>
          </div>
          
          <div>
            <label class="text-xs text-text-dim block mb-1">CUSTOM_LTV_BPS (optional)</label>
            <input 
              type="number"
              min="1000"
              max="9000"
              class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
              value={formData().ltvBps || ''}
              onInput={(e) => setFormData(prev => ({ 
                ...prev, 
                ltvBps: e.target.value ? parseInt(e.target.value) : undefined 
              }))}
            />
          </div>
          
          <div>
            <label class="text-xs text-text-dim block mb-1">REASON</label>
            <input 
              type="text"
              class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
              value={formData().reason || ''}
              onInput={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
            />
          </div>
        </div>

        <div class="flex gap-4 justify-end">
          <Button 
            type="button"
            variant="outline" 
            onClick={props.onCancel}
          >
            [CANCEL]
          </Button>
          <Button 
            type="submit"
            class="bg-accent-green text-bg-primary"
            disabled={props.isLoading}
          >
            {props.isLoading ? '[ADDING...]' : '[ADD_TOKEN]'}
          </Button>
        </div>
      </form>
    </div>
  );
}

// Edit Token Modal Component
function EditTokenModal(props: {
  entry: any;
  onSave: (data: Partial<WhitelistFormData>) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = createSignal<Partial<WhitelistFormData>>({
    symbol: props.entry.symbol,
    name: props.entry.name,
    tier: props.entry.tier,
    ltvBps: props.entry.ltvBps,
    interestRateBps: props.entry.interestRateBps,
    reason: props.entry.reason,
    notes: props.entry.notes,
  });

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    props.onSave(formData());
  };

  return (
    <div class="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center p-4 z-50">
      <div class="bg-bg-secondary border-2 border-accent-blue p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div class="text-sm font-bold text-accent-blue mb-4">[EDIT_TOKEN: {props.entry.symbol}]</div>
        
        <form onSubmit={handleSubmit} class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="text-xs text-text-dim block mb-1">SYMBOL</label>
              <input 
                type="text"
                class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
                value={formData().symbol || ''}
                onInput={(e) => setFormData(prev => ({ ...prev, symbol: e.target.value }))}
              />
            </div>
            
            <div>
              <label class="text-xs text-text-dim block mb-1">NAME</label>
              <input 
                type="text"
                class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
                value={formData().name || ''}
                onInput={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            
            <div>
              <label class="text-xs text-text-dim block mb-1">TIER</label>
              <select 
                class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
                value={formData().tier}
                onChange={(e) => setFormData(prev => ({ ...prev, tier: e.target.value as TokenTier }))}
              >
                <option value="bronze">BRONZE (50% LTV)</option>
                <option value="silver">SILVER (60% LTV)</option>
                <option value="gold">GOLD (70% LTV)</option>
              </select>
            </div>
            
            <div>
              <label class="text-xs text-text-dim block mb-1">LTV_BPS</label>
              <input 
                type="number"
                min="1000"
                max="9000"
                class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
                value={formData().ltvBps || ''}
                onInput={(e) => setFormData(prev => ({ 
                  ...prev, 
                  ltvBps: e.target.value ? parseInt(e.target.value) : undefined 
                }))}
              />
            </div>
            
            <div class="md:col-span-2">
              <label class="text-xs text-text-dim block mb-1">REASON</label>
              <input 
                type="text"
                class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
                value={formData().reason || ''}
                onInput={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
              />
            </div>
            
            <div class="md:col-span-2">
              <label class="text-xs text-text-dim block mb-1">NOTES</label>
              <textarea 
                class="w-full bg-bg-primary border border-border p-2 text-text-primary font-mono text-xs"
                rows="3"
                value={formData().notes || ''}
                onInput={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>
          </div>

          <div class="flex gap-4 justify-end">
            <Button 
              type="button"
              variant="outline" 
              onClick={props.onCancel}
            >
              [CANCEL]
            </Button>
            <Button 
              type="submit"
              class="bg-accent-blue text-bg-primary"
              disabled={props.isLoading}
            >
              {props.isLoading ? '[SAVING...]' : '[SAVE_CHANGES]'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}