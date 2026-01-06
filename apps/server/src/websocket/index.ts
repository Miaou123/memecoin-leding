import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse } from 'url';
import { WebSocketEvent, WebSocketMessage, SubscriptionParams } from '@memecoin-lending/types';
import { securityMonitor } from '../services/security-monitor.service.js';
import { SECURITY_EVENT_TYPES } from '@memecoin-lending/types';
import { IncomingMessage } from 'http';
import { checkWsRateLimit, clearWsRateLimit } from '../middleware/wsRateLimit.js';

interface WebSocketConnection {
  ws: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
  ip: string;
  connectedAt: number;
  connectionId: string;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private connections = new Map<WebSocket, WebSocketConnection>();
  private userConnections = new Map<string, Set<WebSocket>>();
  
  // SECURITY: Track connections per IP for flood detection
  private connectionsByIp = new Map<string, Set<WebSocket>>();
  private readonly MAX_CONNECTIONS_PER_IP = 10;
  
  initialize(server: Server): WebSocketServer {
    this.wss = new WebSocketServer({ 
      server,
      path: '/ws',
    });
    
    this.wss.on('connection', (ws, request) => {
      this.handleConnection(ws, request);
    });
    
    return this.wss;
  }
  
  private async handleConnection(ws: WebSocket, request: IncomingMessage) {
    const ip = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
               request.headers['x-real-ip'] as string ||
               request.socket.remoteAddress ||
               'unknown';
               
    // SECURITY: Check for connection flood
    const ipConnections = this.connectionsByIp.get(ip) || new Set();
    
    if (ipConnections.size >= this.MAX_CONNECTIONS_PER_IP) {
      await securityMonitor.log({
        severity: 'MEDIUM',
        category: 'WebSocket',
        eventType: SECURITY_EVENT_TYPES.WS_CONNECTION_FLOOD,
        message: `WebSocket connection flood from ${ip}`,
        details: {
          ip,
          currentConnections: ipConnections.size,
          limit: this.MAX_CONNECTIONS_PER_IP,
          userAgent: request.headers['user-agent']?.slice(0, 200),
        },
        source: 'websocket',
        ip,
      });
      
      ws.close(1008, 'Too many connections from this IP');
      return;
    }
    
    const url = parse(request.url || '', true);
    const userId = url.query.userId as string;
    const connectionId = `${ip}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const connection: WebSocketConnection = {
      ws,
      userId,
      subscriptions: new Set(),
      ip,
      connectedAt: Date.now(),
      connectionId,
    };
    
    this.connections.set(ws, connection);
    
    // Track by IP
    ipConnections.add(ws);
    this.connectionsByIp.set(ip, ipConnections);
    
    if (userId) {
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(ws);
    }
    
    console.log(`📱 WebSocket connected: ${userId || 'anonymous'} from ${ip}`);
    
    // Send welcome message
    this.send(ws, WebSocketEvent.PROTOCOL_UPDATE, {
      message: 'Connected to Memecoin Lending Protocol',
      timestamp: Date.now(),
    });
    
    ws.on('message', (data) => {
      this.handleMessage(ws, data);
    });
    
    ws.on('close', () => {
      this.handleDisconnection(ws);
    });
    
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.handleDisconnection(ws);
    });
  }
  
  private async handleMessage(ws: WebSocket, data: any) {
    try {
      const connection = this.connections.get(ws);
      if (!connection) return;
      
      // Check rate limit
      const rateLimitResult = checkWsRateLimit(connection.connectionId);
      if (!rateLimitResult.allowed) {
        await securityMonitor.log({
          severity: rateLimitResult.reason?.includes('terminated') ? 'HIGH' : 'MEDIUM',
          category: 'WebSocket',
          eventType: SECURITY_EVENT_TYPES.WS_CONNECTION_FLOOD,
          message: `WebSocket rate limit exceeded: ${rateLimitResult.reason}`,
          details: {
            connectionId: connection.connectionId,
            userId: connection.userId,
            ip: connection.ip,
            reason: rateLimitResult.reason,
          },
          source: 'websocket',
          ip: connection.ip,
          userId: connection.userId,
        });
        
        if (rateLimitResult.reason?.includes('terminated')) {
          ws.close(1008, rateLimitResult.reason);
          return;
        }
        
        // Just drop the message if not terminating
        return;
      }
      
      const message: WebSocketMessage = JSON.parse(data.toString());
      
      if (!connection) return;
      
      // SECURITY: Validate message structure
      if (!message.event || typeof message.event !== 'string') {
        await securityMonitor.log({
          severity: 'LOW',
          category: 'WebSocket',
          eventType: SECURITY_EVENT_TYPES.WS_INVALID_MESSAGE,
          message: 'Invalid WebSocket message: missing or invalid event field',
          details: {
            dataPreview: data.toString().slice(0, 200),
            userId: connection.userId,
            ip: connection.ip,
          },
          source: 'websocket',
          ip: connection.ip,
          userId: connection.userId,
        });
        return;
      }
      
      switch (message.event) {
        case WebSocketEvent.SUBSCRIBE_LOANS:
          await this.handleSubscribeLoans(connection, message.data);
          break;
          
        case WebSocketEvent.SUBSCRIBE_PRICES:
          await this.handleSubscribePrices(connection, message.data);
          break;
          
        case WebSocketEvent.SUBSCRIBE_USER:
          await this.handleSubscribeUser(connection, message.data);
          break;
          
        case WebSocketEvent.UNSUBSCRIBE:
          await this.handleUnsubscribe(connection, message.data);
          break;
          
        default:
          console.warn('Unknown WebSocket event:', message.event);
          
          // SECURITY: Log unknown event attempts
          await securityMonitor.log({
            severity: 'LOW',
            category: 'WebSocket',
            eventType: SECURITY_EVENT_TYPES.WS_INVALID_MESSAGE,
            message: `Unknown WebSocket event: ${message.event}`,
            details: {
              event: message.event,
              dataPreview: JSON.stringify(message.data)?.slice(0, 100),
              userId: connection.userId,
              ip: connection.ip,
            },
            source: 'websocket',
            ip: connection.ip,
            userId: connection.userId,
          });
      }
      
    } catch (error: any) {
      const connection = this.connections.get(ws);
      console.error('Failed to parse WebSocket message:', error);
      
      // SECURITY: Log message parsing failures
      await securityMonitor.log({
        severity: 'LOW',
        category: 'WebSocket',
        eventType: SECURITY_EVENT_TYPES.WS_INVALID_MESSAGE,
        message: `Failed to parse WebSocket message: ${error.message}`,
        details: {
          error: error.message,
          dataPreview: data.toString().slice(0, 200),
          userId: connection?.userId,
          ip: connection?.ip,
        },
        source: 'websocket',
        ip: connection?.ip,
        userId: connection?.userId,
      });
    }
  }
  
  private async handleSubscribeLoans(connection: WebSocketConnection, params: SubscriptionParams['loans']) {
    const subscriptionKey = `loans:${JSON.stringify(params || {})}`;
    connection.subscriptions.add(subscriptionKey);
    
    this.send(connection.ws, WebSocketEvent.PROTOCOL_UPDATE, {
      message: `Subscribed to loans: ${subscriptionKey}`,
    });
  }
  
  private async handleSubscribePrices(connection: WebSocketConnection, params: SubscriptionParams['prices']) {
    if (params?.tokenMints) {
      // SECURITY: Validate token mints array
      if (!Array.isArray(params.tokenMints) || params.tokenMints.length > 50) {
        await securityMonitor.log({
          severity: 'LOW',
          category: 'WebSocket',
          eventType: SECURITY_EVENT_TYPES.WS_INVALID_MESSAGE,
          message: 'Invalid tokenMints in price subscription',
          details: {
            tokenMintsCount: params.tokenMints?.length,
            userId: connection.userId,
            ip: connection.ip,
          },
          source: 'websocket',
          ip: connection.ip,
          userId: connection.userId,
        });
        return;
      }
      
      for (const mint of params.tokenMints) {
        // SECURITY: Validate mint address format
        if (typeof mint !== 'string' || mint.length < 32 || mint.length > 44) {
          await securityMonitor.log({
            severity: 'LOW',
            category: 'WebSocket',
            eventType: SECURITY_EVENT_TYPES.WS_INVALID_MESSAGE,
            message: 'Invalid token mint address in price subscription',
            details: {
              mint: mint?.slice(0, 20) + '...',
              userId: connection.userId,
              ip: connection.ip,
            },
            source: 'websocket',
            ip: connection.ip,
            userId: connection.userId,
          });
          continue;
        }
        
        const subscriptionKey = `prices:${mint}`;
        connection.subscriptions.add(subscriptionKey);
      }
    } else {
      connection.subscriptions.add('prices:all');
    }
    
    this.send(connection.ws, WebSocketEvent.PROTOCOL_UPDATE, {
      message: 'Subscribed to price updates',
    });
  }
  
  private async handleSubscribeUser(connection: WebSocketConnection, params: SubscriptionParams['user']) {
    if (params?.wallet) {
      // SECURITY: Validate wallet address format
      if (typeof params.wallet !== 'string' || params.wallet.length < 32 || params.wallet.length > 44) {
        await securityMonitor.log({
          severity: 'LOW',
          category: 'WebSocket',
          eventType: SECURITY_EVENT_TYPES.WS_INVALID_MESSAGE,
          message: 'Invalid wallet address in user subscription',
          details: {
            wallet: params.wallet?.slice(0, 20) + '...',
            userId: connection.userId,
            ip: connection.ip,
          },
          source: 'websocket',
          ip: connection.ip,
          userId: connection.userId,
        });
        return;
      }
      
      // SECURITY: Check for unauthorized subscription attempts (user trying to subscribe to another user's data)
      if (connection.userId && connection.userId !== params.wallet) {
        await securityMonitor.log({
          severity: 'MEDIUM',
          category: 'WebSocket',
          eventType: SECURITY_EVENT_TYPES.WS_UNAUTHORIZED,
          message: `Unauthorized user subscription attempt`,
          details: {
            requestedWallet: params.wallet.slice(0, 8) + '...',
            connectionUserId: connection.userId?.slice(0, 8) + '...',
            ip: connection.ip,
          },
          source: 'websocket',
          ip: connection.ip,
          userId: connection.userId,
        });
        return;
      }
      
      connection.userId = params.wallet;
      const subscriptionKey = `user:${params.wallet}`;
      connection.subscriptions.add(subscriptionKey);
      
      // Update user connections map
      if (!this.userConnections.has(params.wallet)) {
        this.userConnections.set(params.wallet, new Set());
      }
      this.userConnections.get(params.wallet)!.add(connection.ws);
    }
  }
  
  private handleUnsubscribe(connection: WebSocketConnection, subscriptionKey: string) {
    connection.subscriptions.delete(subscriptionKey);
    
    this.send(connection.ws, WebSocketEvent.PROTOCOL_UPDATE, {
      message: `Unsubscribed from: ${subscriptionKey}`,
    });
  }
  
  private handleDisconnection(ws: WebSocket) {
    const connection = this.connections.get(ws);
    
    if (connection?.userId) {
      const userConnections = this.userConnections.get(connection.userId);
      if (userConnections) {
        userConnections.delete(ws);
        if (userConnections.size === 0) {
          this.userConnections.delete(connection.userId);
        }
      }
    }
    
    // SECURITY: Clean up IP tracking
    if (connection?.ip) {
      const ipConnections = this.connectionsByIp.get(connection.ip);
      if (ipConnections) {
        ipConnections.delete(ws);
        if (ipConnections.size === 0) {
          this.connectionsByIp.delete(connection.ip);
        }
      }
    }
    
    // Clear rate limit for this connection
    if (connection?.connectionId) {
      clearWsRateLimit(connection.connectionId);
    }
    
    this.connections.delete(ws);
    console.log(`📱 WebSocket disconnected: ${connection?.userId || 'anonymous'}`);
  }
  
  private send(ws: WebSocket, event: WebSocketEvent, data: any) {
    if (ws.readyState === WebSocket.OPEN) {
      const message: WebSocketMessage = {
        event,
        data,
        timestamp: Date.now(),
      };
      
      ws.send(JSON.stringify(message));
    }
  }
  
  // Public methods for sending messages
  
  emit(event: WebSocketEvent, data: any) {
    const message: WebSocketMessage = {
      event,
      data,
      timestamp: Date.now(),
    };
    
    for (const [ws, connection] of this.connections) {
      // Check if connection is subscribed to this event type
      const isSubscribed = this.isSubscribedToEvent(connection, event, data);
      
      if (isSubscribed && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }
  
  sendToUser(userId: string, event: WebSocketEvent | string, data: any) {
    const userConnections = this.userConnections.get(userId);
    
    if (userConnections) {
      const message: WebSocketMessage = {
        event: event as WebSocketEvent,
        data,
        timestamp: Date.now(),
      };
      
      for (const ws of userConnections) {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(message));
        }
      }
    }
  }
  
  broadcast(event: WebSocketEvent, data: any) {
    const message: WebSocketMessage = {
      event,
      data,
      timestamp: Date.now(),
    };
    
    for (const [ws] of this.connections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    }
  }
  
  private isSubscribedToEvent(connection: WebSocketConnection, event: WebSocketEvent, data: any): boolean {
    // Check specific subscriptions based on event type
    switch (event) {
      case WebSocketEvent.LOAN_CREATED:
      case WebSocketEvent.LOAN_REPAID:
      case WebSocketEvent.LOAN_LIQUIDATED:
        return connection.subscriptions.has('loans:{}') || 
               connection.subscriptions.has(`user:${data.loan?.borrower}`) ||
               connection.userId === data.loan?.borrower;
               
      case WebSocketEvent.PRICE_UPDATE:
        return connection.subscriptions.has('prices:all') ||
               connection.subscriptions.has(`prices:${data.tokenMint}`);
               
      case WebSocketEvent.PROTOCOL_UPDATE:
        return true; // Everyone gets protocol updates
        
      default:
        return false;
    }
  }
  
  getConnectionCount(): number {
    return this.connections.size;
  }
  
  getUserConnectionCount(userId: string): number {
    return this.userConnections.get(userId)?.size || 0;
  }
}

export const websocketService = new WebSocketService();

export function initializeWebSocket(server: Server): WebSocketServer {
  return websocketService.initialize(server);
}