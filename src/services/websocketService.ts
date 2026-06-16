import { WebSocket } from 'ws';
import logger from '../utils/logger.js';

export interface AuthenticatedWebSocket extends WebSocket {
  user?: {
    id: string;
    email: string;
    role: 'STUDENT' | 'ADMIN';
  };
  isAlive?: boolean;
}

class WebSocketService {
  // Map of userId -> Set of active authenticated sockets
  private connections = new Map<string, Set<AuthenticatedWebSocket>>();

  /**
   * Register a new active WebSocket connection for a user.
   */
  public registerConnection(userId: string, socket: AuthenticatedWebSocket): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(socket);
    logger.debug(`Registered WebSocket connection for user: ${userId}. Total user connections: ${this.connections.get(userId)!.size}`);
  }

  /**
   * Remove an active WebSocket connection.
   */
  public removeConnection(userId: string, socket: AuthenticatedWebSocket): void {
    const userSockets = this.connections.get(userId);
    if (userSockets) {
      userSockets.delete(socket);
      logger.debug(`Removed WebSocket connection for user: ${userId}. Remaining user connections: ${userSockets.size}`);
      if (userSockets.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  /**
   * Get active connection count for a user ID.
   */
  public getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size || 0;
  }

  /**
   * Send a real-time message to a specific user (across all their active sockets).
   */
  public sendMessageToUser(userId: string, event: string, data: any): boolean {
    const userSockets = this.connections.get(userId);
    if (!userSockets || userSockets.size === 0) {
      logger.debug(`Attempted to send message to user ${userId}, but no active connections were found.`);
      return false;
    }

    const messageString = this.formatMessage(event, data);
    let sentCount = 0;

    for (const socket of userSockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(messageString);
        sentCount++;
      }
    }

    logger.debug(`Sent message '${event}' to user ${userId} across ${sentCount} sockets.`);
    return sentCount > 0;
  }

  /**
   * Broadcast a message to all connected clients.
   */
  public broadcast(event: string, data: any): void {
    const messageString = this.formatMessage(event, data);
    let totalCount = 0;

    for (const userSockets of this.connections.values()) {
      for (const socket of userSockets) {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(messageString);
          totalCount++;
        }
      }
    }

    logger.info(`Broadcasted event '${event}' to ${totalCount} connections.`);
  }

  /**
   * Broadcast a message to all connected clients with a specific role.
   */
  public broadcastToRole(role: 'STUDENT' | 'ADMIN', event: string, data: any): void {
    const messageString = this.formatMessage(event, data);
    let roleCount = 0;

    for (const userSockets of this.connections.values()) {
      for (const socket of userSockets) {
        if (socket.user?.role === role && socket.readyState === WebSocket.OPEN) {
          socket.send(messageString);
          roleCount++;
        }
      }
    }

    logger.info(`Broadcasted event '${event}' to ${roleCount} clients with role '${role}'.`);
  }

  /**
   * Formats event data into standard JSON payload.
   */
  private formatMessage(event: string, data: any): string {
    return JSON.stringify({
      event,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get all active connections map (for debugging/testing).
   */
  public getConnectionsMap(): Map<string, Set<AuthenticatedWebSocket>> {
    return this.connections;
  }

  /**
   * Reset the connections map (useful for test isolation).
   */
  public clearAllConnections(): void {
    this.connections.clear();
  }
}

export const webSocketService = new WebSocketService();
