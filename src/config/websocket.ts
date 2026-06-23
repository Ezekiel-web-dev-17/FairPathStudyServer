import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import { JWT_SECRET, SESSION_SECRET } from './config.js';
import { redisClient } from './redis.js';
import { webSocketService, AuthenticatedWebSocket } from '../services/websocketService.js';
import logger from '../utils/logger.js';
import { isTokenBlacklisted } from '../services/tokenService.js';

const MAX_CONNECTIONS_PER_USER = 5;

/**
 * Custom cookie parser helper for WebSocket requests.
 */
const parseCookies = (cookieHeader: string | undefined): Record<string, string> => {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const name = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      cookies[name] = decodeURIComponent(val);
    }
  });
  return cookies;
};

/**
 * Authenticates the WebSocket upgrade request.
 * Returns the authenticated user object or null if authentication fails.
 */
const authenticateUpgrade = async (
  request: http.IncomingMessage,
): Promise<AuthenticatedWebSocket['user'] | null> => {
  try {
    const urlObj = new URL(request.url || '', `http://${request.headers.host || 'localhost'}`);
    
    // 1. Try JWT token authentication (from query params or cookie)
    let token = urlObj.searchParams.get('token') || undefined;

    const cookies = parseCookies(request.headers.cookie);
    if (!token && cookies.token) {
      token = cookies.token;
    }

    if (token) {
      const secret = JWT_SECRET!;
      // Enforce HS256 algorithm as per safety instructions
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as any;
      if (decoded && decoded.id && decoded.email && decoded.role) {
        if (decoded.jti) {
          const blacklisted = await isTokenBlacklisted(decoded.jti);
          if (blacklisted) {
            logger.warn(`WebSocket upgrade rejected: Token jti ${decoded.jti} is blacklisted`);
            return null;
          }
        }
        return {
          id: decoded.id,
          email: decoded.email,
          role: decoded.role,
        };
      }
    }

    // 2. Try Redis Session authentication (from session_id cookie)
    const rawSessionId = cookies.session_id;
    if (rawSessionId && SESSION_SECRET) {
      const sessionId = cookieParser.signedCookie(rawSessionId, SESSION_SECRET);
      if (sessionId && typeof sessionId === 'string') {
        const sessionKey = `sess:${sessionId}`;
        const sessionDataStr = await redisClient.get(sessionKey);
        if (sessionDataStr) {
          const sessionData = JSON.parse(sessionDataStr);
          if (sessionData && sessionData.user) {
            return {
              id: sessionData.user.id,
              email: sessionData.user.email,
              role: sessionData.user.role,
            };
          }
        }
      }
    }
  } catch (err) {
    logger.error('WebSocket upgrade authentication error: %o', err);
  }

  return null;
};

/**
 * Initializes the WebSocket server and handles HTTP upgrade requests.
 */
export const initWebSocketServer = (server: http.Server): WebSocketServer => {
  const wss = new WebSocketServer({ noServer: true });

  logger.info('Initializing WebSocket Server...');

  // Set up connection upgrade listener on the main HTTP server
  server.on('upgrade', async (request, socket, head) => {
    logger.debug(`Received upgrade request for: ${request.url}`);

    // Authenticate the connection
    const user = await authenticateUpgrade(request);
    if (!user) {
      logger.warn(`WebSocket upgrade rejected: Unauthorized request from origin: ${request.headers.origin}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{"error":"Unauthorized"}\r\n');
      socket.destroy();
      return;
    }

    // DoS / Rate limit check: Cap concurrent connections per user
    const activeConnections = webSocketService.getConnectionCount(user.id);
    if (activeConnections >= MAX_CONNECTIONS_PER_USER) {
      logger.warn(`WebSocket upgrade rejected: User ${user.id} has reached maximum connection limit (${MAX_CONNECTIONS_PER_USER})`);
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Type: application/json\r\n\r\n{"error":"Too Many Concurrent Connections"}\r\n');
      socket.destroy();
      return;
    }

    // Upgrade the connection
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, user);
    });
  });

  // Handle successful connection upgrades
  wss.on('connection', (ws: AuthenticatedWebSocket, request: http.IncomingMessage, user: AuthenticatedWebSocket['user']) => {
    if (!user) {
      ws.close(1008, 'Authentication Required');
      return;
    }

    ws.user = user;
    ws.isAlive = true;

    // Register active connection
    webSocketService.registerConnection(user.id, ws);
    logger.info(`WebSocket connection established for user: ${user.email} (${user.role})`);

    // Broadcast online status to fellow admins if connecting user is an ADMIN
    if (user.role === 'ADMIN') {
      webSocketService.broadcastToRole('ADMIN', 'admin-presence', {
        userId: user.id,
        email: user.email,
        status: 'online',
      });
    }

    // Setup ping/pong heartbeat to detect dead connections
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', (message) => {
      logger.debug(`Received message from user ${user.id}: ${message}`);
    });

    ws.on('close', (code, reason) => {
      webSocketService.removeConnection(user.id, ws);
      logger.info(`WebSocket connection closed for user ${user.email}. Code: ${code}, Reason: ${reason}`);

      // Broadcast offline status if no active connections remain for this admin
      if (user.role === 'ADMIN' && webSocketService.getConnectionCount(user.id) === 0) {
        webSocketService.broadcastToRole('ADMIN', 'admin-presence', {
          userId: user.id,
          email: user.email,
          status: 'offline',
        });
      }
    });

    ws.on('error', (err) => {
      webSocketService.removeConnection(user.id, ws);
      logger.error(`WebSocket connection error for user ${user.email}: %o`, err);

      // Broadcast offline status if no active connections remain for this admin
      if (user.role === 'ADMIN' && webSocketService.getConnectionCount(user.id) === 0) {
        webSocketService.broadcastToRole('ADMIN', 'admin-presence', {
          userId: user.id,
          email: user.email,
          status: 'offline',
        });
      }
    });
  });

  // Start the heartbeat checking interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((client) => {
      const ws = client as AuthenticatedWebSocket;
      if (ws.isAlive === false) {
        logger.info(`Terminating inactive WebSocket client connection for user: ${ws.user?.email}`);
        return ws.terminate();
      }

      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  // Clear heartbeat check interval when server shuts down
  wss.on('close', () => {
    clearInterval(heartbeatInterval);
    logger.info('WebSocket server closed. Heartbeat interval cleared.');
  });

  logger.info('✅ WebSocket Server successfully initialized and attached to HTTP Server.');
  return wss;
};
