import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { parse } from 'url';
import { WebSocketEvent, WebSocketMessage, SubscriptionParams } from '@memecoin-lending/types';

interface WebSocketConnection {
  ws: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private connections = new Map<WebSocket, WebSocketConnection>();
  private userConnections = new Map<string, Set<WebSocket>>();
  
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
  
  private handleConnection(ws: WebSocket, request: any) {
    const url = parse(request.url, true);
    const userId = url.query.userId as string;
    
    const connection: WebSocketConnection = {
      ws,
      userId,
      subscriptions: new Set(),
    };
    
    this.connections.set(ws, connection);
    
    if (userId) {
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(ws);
    }
    
    console.log(`📱 WebSocket connected: ${userId || 'anonymous'}`);
    
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
  
  private handleMessage(ws: WebSocket, data: any) {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      const connection = this.connections.get(ws);
      
      if (!connection) return;
      
      switch (message.event) {
        case WebSocketEvent.SUBSCRIBE_LOANS:
          this.handleSubscribeLoans(connection, message.data);
          break;
          
        case WebSocketEvent.SUBSCRIBE_PRICES:
          this.handleSubscribePrices(connection, message.data);
          break;
          
        case WebSocketEvent.SUBSCRIBE_USER:
          this.handleSubscribeUser(connection, message.data);
          break;
          
        case WebSocketEvent.UNSUBSCRIBE:
          this.handleUnsubscribe(connection, message.data);
          break;
          
        default:
          console.warn('Unknown WebSocket event:', message.event);
      }
      
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
  }
  
  private handleSubscribeLoans(connection: WebSocketConnection, params: SubscriptionParams['loans']) {
    const subscriptionKey = `loans:${JSON.stringify(params || {})}`;
    connection.subscriptions.add(subscriptionKey);
    
    this.send(connection.ws, WebSocketEvent.PROTOCOL_UPDATE, {
      message: `Subscribed to loans: ${subscriptionKey}`,
    });
  }
  
  private handleSubscribePrices(connection: WebSocketConnection, params: SubscriptionParams['prices']) {
    if (params?.tokenMints) {
      for (const mint of params.tokenMints) {
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
  
  private handleSubscribeUser(connection: WebSocketConnection, params: SubscriptionParams['user']) {
    if (params?.wallet) {
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