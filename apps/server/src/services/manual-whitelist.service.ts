import { PrismaClient } from '@prisma/client';
import {
  ManualWhitelistEntry,
  CreateWhitelistEntryRequest,
  UpdateWhitelistEntryRequest,
  GetWhitelistEntriesRequest,
  GetWhitelistEntriesResponse,
  WhitelistStats,
  WhitelistAction,
  WhitelistAuditLog,
  TokenTier,
} from '@memecoin-lending/types';

export class ManualWhitelistService {
  private prisma: PrismaClient;
  private readonly defaultLtvBps = {
    [TokenTier.Bronze]: 5000, // 50%
    [TokenTier.Silver]: 6000, // 60%
    [TokenTier.Gold]: 7000,   // 70%
  };
  
  private readonly defaultLiquidationBonusBps = {
    [TokenTier.Bronze]: 500,  // 5%
    [TokenTier.Silver]: 400,  // 4%
    [TokenTier.Gold]: 300,    // 3%
  };

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async addToWhitelist(
    request: CreateWhitelistEntryRequest, 
    adminAddress: string
  ): Promise<ManualWhitelistEntry> {
    // Check if token already exists
    const existing = await this.prisma.manualWhitelist.findUnique({
      where: { mint: request.mint }
    });

    if (existing) {
      throw new Error(`Token ${request.mint} is already whitelisted`);
    }

    // Validate mint address format
    if (!this.isValidMintAddress(request.mint)) {
      throw new Error('Invalid mint address format');
    }

    const now = Date.now();
    const tier = request.tier as string;
    
    const entry = await this.prisma.manualWhitelist.create({
      data: {
        mint: request.mint,
        symbol: request.symbol,
        name: request.name,
        tier,
        ltvBps: request.ltvBps || this.defaultLtvBps[request.tier],
        liquidationBonusBps: request.liquidationBonusBps || this.defaultLiquidationBonusBps[request.tier],
        minLoanAmount: request.minLoanAmount || '1000000000', // 1 SOL in lamports
        maxLoanAmount: request.maxLoanAmount || '100000000000000', // 100,000 SOL in lamports
        enabled: true,
        addedBy: adminAddress,
        reason: request.reason,
        notes: request.notes,
        externalUrl: request.externalUrl,
        logoUrl: request.logoUrl,
        tags: request.tags || [],
      }
    });

    // Create audit log
    await this.createAuditLog(
      entry.id,
      WhitelistAction.ADD,
      adminAddress,
      { entry },
      request.reason || 'Added to whitelist'
    );

    return this.mapToWhitelistEntry(entry);
  }

  async updateWhitelistEntry(
    mint: string,
    request: UpdateWhitelistEntryRequest,
    adminAddress: string
  ): Promise<ManualWhitelistEntry> {
    const existing = await this.prisma.manualWhitelist.findUnique({
      where: { mint }
    });

    if (!existing) {
      throw new Error(`Token ${mint} not found in whitelist`);
    }

    const updateData: any = {
      updatedAt: new Date(),
    };

    const changes: Record<string, any> = {};

    // Track changes for audit log
    if (request.symbol !== undefined && request.symbol !== existing.symbol) {
      updateData.symbol = request.symbol;
      changes.symbol = { from: existing.symbol, to: request.symbol };
    }
    
    if (request.name !== undefined && request.name !== existing.name) {
      updateData.name = request.name;
      changes.name = { from: existing.name, to: request.name };
    }
    
    if (request.tier !== undefined && request.tier !== existing.tier) {
      updateData.tier = request.tier as string;
      changes.tier = { from: existing.tier, to: request.tier };
      
      // Auto-update LTV and interest rate if tier changed and not explicitly set
      if (request.ltvBps === undefined) {
        updateData.ltvBps = this.defaultLtvBps[request.tier];
        changes.ltvBps = { from: existing.ltvBps, to: updateData.ltvBps };
      }
      
      if (request.liquidationBonusBps === undefined) {
        updateData.liquidationBonusBps = this.defaultLiquidationBonusBps[request.tier];
        changes.liquidationBonusBps = { from: existing.liquidationBonusBps, to: updateData.liquidationBonusBps };
      }
    }
    
    if (request.ltvBps !== undefined && request.ltvBps !== existing.ltvBps) {
      updateData.ltvBps = request.ltvBps;
      changes.ltvBps = { from: existing.ltvBps, to: request.ltvBps };
    }
    
    if (request.liquidationBonusBps !== undefined && request.liquidationBonusBps !== existing.liquidationBonusBps) {
      updateData.liquidationBonusBps = request.liquidationBonusBps;
      changes.liquidationBonusBps = { from: existing.liquidationBonusBps, to: request.liquidationBonusBps };
    }
    
    if (request.minLoanAmount !== undefined && request.minLoanAmount !== existing.minLoanAmount) {
      updateData.minLoanAmount = request.minLoanAmount;
      changes.minLoanAmount = { from: existing.minLoanAmount, to: request.minLoanAmount };
    }
    
    if (request.maxLoanAmount !== undefined && request.maxLoanAmount !== existing.maxLoanAmount) {
      updateData.maxLoanAmount = request.maxLoanAmount;
      changes.maxLoanAmount = { from: existing.maxLoanAmount, to: request.maxLoanAmount };
    }
    
    if (request.enabled !== undefined && request.enabled !== existing.enabled) {
      updateData.enabled = request.enabled;
      changes.enabled = { from: existing.enabled, to: request.enabled };
    }
    
    if (request.reason !== undefined && request.reason !== existing.reason) {
      updateData.reason = request.reason;
      changes.reason = { from: existing.reason, to: request.reason };
    }
    
    if (request.notes !== undefined && request.notes !== existing.notes) {
      updateData.notes = request.notes;
      changes.notes = { from: existing.notes, to: request.notes };
    }
    
    if (request.externalUrl !== undefined && request.externalUrl !== existing.externalUrl) {
      updateData.externalUrl = request.externalUrl;
      changes.externalUrl = { from: existing.externalUrl, to: request.externalUrl };
    }
    
    if (request.logoUrl !== undefined && request.logoUrl !== existing.logoUrl) {
      updateData.logoUrl = request.logoUrl;
      changes.logoUrl = { from: existing.logoUrl, to: request.logoUrl };
    }
    
    if (request.tags !== undefined) {
      updateData.tags = request.tags;
      changes.tags = { from: existing.tags, to: request.tags };
    }

    if (Object.keys(changes).length === 0) {
      return this.mapToWhitelistEntry(existing);
    }

    const updated = await this.prisma.manualWhitelist.update({
      where: { mint },
      data: updateData
    });

    // Create audit log
    await this.createAuditLog(
      existing.id,
      WhitelistAction.UPDATE,
      adminAddress,
      changes,
      'Updated whitelist entry'
    );

    return this.mapToWhitelistEntry(updated);
  }

  async enableEntry(mint: string, adminAddress: string): Promise<void> {
    await this.updateWhitelistEntry(
      mint,
      { enabled: true },
      adminAddress
    );

    // Create specific audit log for enable action
    const entry = await this.prisma.manualWhitelist.findUnique({
      where: { mint }
    });

    if (entry) {
      await this.createAuditLog(
        entry.id,
        WhitelistAction.ENABLE,
        adminAddress,
        { enabled: { from: false, to: true } },
        'Enabled token'
      );
    }
  }

  async disableEntry(mint: string, adminAddress: string, reason?: string): Promise<void> {
    await this.updateWhitelistEntry(
      mint,
      { enabled: false, reason },
      adminAddress
    );

    // Create specific audit log for disable action
    const entry = await this.prisma.manualWhitelist.findUnique({
      where: { mint }
    });

    if (entry) {
      await this.createAuditLog(
        entry.id,
        WhitelistAction.DISABLE,
        adminAddress,
        { enabled: { from: true, to: false } },
        reason || 'Disabled token'
      );
    }
  }

  async removeFromWhitelist(mint: string, adminAddress: string, reason?: string): Promise<void> {
    const existing = await this.prisma.manualWhitelist.findUnique({
      where: { mint }
    });

    if (!existing) {
      throw new Error(`Token ${mint} not found in whitelist`);
    }

    // Create audit log before deletion
    await this.createAuditLog(
      existing.id,
      WhitelistAction.REMOVE,
      adminAddress,
      { removedEntry: existing },
      reason || 'Removed from whitelist'
    );

    await this.prisma.manualWhitelist.delete({
      where: { mint }
    });
  }

  async getWhitelistEntry(mint: string): Promise<ManualWhitelistEntry | null> {
    const entry = await this.prisma.manualWhitelist.findUnique({
      where: { mint }
    });

    return entry ? this.mapToWhitelistEntry(entry) : null;
  }

  async isWhitelisted(mint: string): Promise<boolean> {
    const entry = await this.prisma.manualWhitelist.findFirst({
      where: { mint, enabled: true }
    });

    return !!entry;
  }

  async getWhitelistEntries(request: GetWhitelistEntriesRequest): Promise<GetWhitelistEntriesResponse> {
    const { filters = {}, sortBy = 'addedAt', sortOrder = 'desc', page = 1, limit = 50 } = request;
    
    const where: any = {};
    
    if (filters.mint) {
      where.mint = { contains: filters.mint, mode: 'insensitive' };
    }
    
    if (filters.tier) {
      where.tier = filters.tier;
    }
    
    if (filters.enabled !== undefined) {
      where.enabled = filters.enabled;
    }
    
    if (filters.addedBy) {
      where.addedBy = filters.addedBy;
    }
    
    if (filters.tags && filters.tags.length > 0) {
      where.tags = { hasSome: filters.tags };
    }
    
    if (filters.search) {
      where.OR = [
        { symbol: { contains: filters.search, mode: 'insensitive' } },
        { name: { contains: filters.search, mode: 'insensitive' } },
        { mint: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const orderBy: any = {};
    orderBy[sortBy] = sortOrder;

    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      this.prisma.manualWhitelist.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.manualWhitelist.count({ where })
    ]);

    return {
      entries: entries.map(this.mapToWhitelistEntry),
      total,
      page,
      limit,
      hasMore: skip + entries.length < total,
    };
  }

  async getWhitelistStats(): Promise<WhitelistStats> {
    const [total, enabled, byTier, recentlyAdded] = await Promise.all([
      this.prisma.manualWhitelist.count(),
      this.prisma.manualWhitelist.count({ where: { enabled: true } }),
      this.prisma.manualWhitelist.groupBy({
        by: ['tier'],
        _count: { tier: true },
      }),
      this.prisma.manualWhitelist.count({
        where: {
          addedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
          }
        }
      })
    ]);

    const entriesByTier = {
      bronze: 0,
      silver: 0,
      gold: 0,
    };

    byTier.forEach(item => {
      if (item.tier in entriesByTier) {
        (entriesByTier as any)[item.tier] = item._count.tier;
      }
    });

    return {
      totalEntries: total,
      enabledEntries: enabled,
      entriesByTier,
      recentlyAdded,
    };
  }

  async getAuditLogs(entryId?: string, adminAddress?: string, limit = 50): Promise<WhitelistAuditLog[]> {
    const where: any = {};
    
    if (entryId) {
      where.entryId = entryId;
    }
    
    if (adminAddress) {
      where.adminAddress = adminAddress;
    }

    const logs = await this.prisma.whitelistAuditLog.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit,
    });

    return logs.map(log => ({
      id: log.id,
      entryId: log.entryId,
      action: log.action as WhitelistAction,
      adminAddress: log.adminAddress,
      changes: log.changes as Record<string, any>,
      timestamp: log.timestamp.getTime(),
      reason: log.reason ?? undefined,
    }));
  }

  private async createAuditLog(
    entryId: string,
    action: WhitelistAction,
    adminAddress: string,
    changes?: Record<string, any>,
    reason?: string
  ): Promise<void> {
    await this.prisma.whitelistAuditLog.create({
      data: {
        entryId,
        action: action as string,
        adminAddress,
        changes: changes || {},
        reason,
      }
    });
  }

  private mapToWhitelistEntry(entry: any): ManualWhitelistEntry {
    return {
      id: entry.id,
      mint: entry.mint,
      symbol: entry.symbol,
      name: entry.name,
      tier: entry.tier as TokenTier,
      ltvBps: entry.ltvBps,
      liquidationBonusBps: entry.liquidationBonusBps,
      minLoanAmount: entry.minLoanAmount,
      maxLoanAmount: entry.maxLoanAmount,
      enabled: entry.enabled,
      addedBy: entry.addedBy,
      addedAt: entry.addedAt.getTime(),
      updatedAt: entry.updatedAt.getTime(),
      reason: entry.reason,
      notes: entry.notes,
      externalUrl: entry.externalUrl,
      logoUrl: entry.logoUrl,
      tags: entry.tags,
    };
  }

  private isValidMintAddress(mint: string): boolean {
    // Basic validation for Solana mint addresses
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(mint);
  }
}

export const manualWhitelistService = new ManualWhitelistService(new PrismaClient());