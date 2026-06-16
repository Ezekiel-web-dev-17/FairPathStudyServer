import http from 'http';
import { AddressInfo } from 'net';
import crypto from 'crypto';
import WebSocket from 'ws';
import jwt from 'jsonwebtoken';
import app from '../app.js';
import { JWT_SECRET, SESSION_SECRET } from '../config/config.js';
import { connectRedis, redisClient } from '../config/redis.js';
import { initWebSocketServer } from '../config/websocket.js';
import { webSocketService } from '../services/websocketService.js';

/**
 * Helper to sign session ID cookie mimicking cookie-signature.
 */
const signSessionCookie = (val: string, secret: string): string => {
  const hmac = crypto.createHmac('sha256', secret).update(val).digest('base64').replace(/\=+$/, '');
  return `s:${val}.${hmac}`;
};

describe('WebSocket Server Integration Tests', () => {
  let server: http.Server;
  let wss: any;
  let port: number;
  const activeClients: WebSocket[] = [];

  const createClient = (url: string, options?: WebSocket.ClientOptions): Promise<WebSocket> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, options);
      activeClients.push(ws);
      
      ws.on('open', () => resolve(ws));
      ws.on('error', (err) => reject(err));
    });
  };

  beforeAll(async () => {
    // Create server and listen on localhost
    server = http.createServer(app);
    wss = initWebSocketServer(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as AddressInfo;
        port = addr.port;
        resolve();
      });
    });

    // Connect to Redis for session storing
    await connectRedis();
  }, 30000);

  afterAll(async () => {
    // Terminate all remaining active test clients
    for (const ws of activeClients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }

    // Close WebSocket server first to clear the heartbeat interval
    if (wss) {
      wss.close();
    }

    // Close servers safely
    if (server) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }

    // Close BullMQ handles to release Redis connection handles
    try {
      const { cleanupQueue, cleanupWorker } = await import('../config/scheduler.js');
      await cleanupQueue.close();
      await cleanupWorker.close();
    } catch (err) {
      // Ignore
    }

    // Disconnect DB client and pool
    try {
      const { prisma, pool } = await import('../config/db.js');
      await prisma.$disconnect();
      await pool.end();
    } catch (err) {
      // Ignore
    }

    // Disconnect Redis
    if (redisClient.isOpen) {
      await redisClient.quit();
    }
  });

  afterEach(async () => {
    // Clean up active connections in the service
    webSocketService.clearAllConnections();
  });

  it('should authenticate and connect successfully with a valid JWT token in query params', async () => {
    const payload = { id: 'user-jwt-1', email: 'jwt1@test.com', role: 'STUDENT' };
    const token = jwt.sign(payload, JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });

    const wsUrl = `ws://127.0.0.1:${port}?token=${token}`;
    const ws = await createClient(wsUrl);

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(webSocketService.getConnectionCount('user-jwt-1')).toBe(1);
    ws.close();
  });

  it('should reject connection with an invalid JWT token', async () => {
    const wsUrl = `ws://127.0.0.1:${port}?token=invalid-signature-token`;
    
    await expect(createClient(wsUrl)).rejects.toThrow();
    expect(webSocketService.getConnectionCount('user-jwt-1')).toBe(0);
  });

  it('should authenticate and connect successfully with a valid Redis session cookie', async () => {
    const user = { id: 'user-session-1', email: 'session1@test.com', role: 'ADMIN' };
    const sessionId = 'test-session-id-123';
    
    // Store mock session in Redis
    await redisClient.set(`sess:${sessionId}`, JSON.stringify({ user }));

    const signedCookie = signSessionCookie(sessionId, SESSION_SECRET!);
    const wsUrl = `ws://127.0.0.1:${port}`;
    const ws = await createClient(wsUrl, {
      headers: {
        cookie: `session_id=${signedCookie}`,
      },
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect(webSocketService.getConnectionCount('user-session-1')).toBe(1);
    ws.close();

    // Cleanup session from Redis
    await redisClient.del(`sess:${sessionId}`);
  });

  it('should reject connection with invalid or unsigned session cookie', async () => {
    const wsUrl = `ws://127.0.0.1:${port}`;
    
    // Invalid signature
    const ws1Promise = createClient(wsUrl, {
      headers: {
        cookie: `session_id=s:someSessionId.invalidSig`,
      },
    });
    await expect(ws1Promise).rejects.toThrow();

    // Non-existent session
    const signedCookie = signSessionCookie('nonexistent-session-id', SESSION_SECRET!);
    const ws2Promise = createClient(wsUrl, {
      headers: {
        cookie: `session_id=${signedCookie}`,
      },
    });
    await expect(ws2Promise).rejects.toThrow();
  });

  it('should enforce connection rate limits by rejecting a 6th concurrent connection for the same user', async () => {
    const payload = { id: 'user-ratelimit-1', email: 'ratelimit@test.com', role: 'STUDENT' };
    const token = jwt.sign(payload, JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });
    const wsUrl = `ws://127.0.0.1:${port}?token=${token}`;

    const connections: WebSocket[] = [];
    
    // Open 5 concurrent connections successfully
    for (let i = 0; i < 5; i++) {
      const ws = await createClient(wsUrl);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      connections.push(ws);
    }
    
    expect(webSocketService.getConnectionCount('user-ratelimit-1')).toBe(5);

    // 6th connection should be rejected
    await expect(createClient(wsUrl)).rejects.toThrow();

    // Close connections
    for (const ws of connections) {
      ws.close();
    }
  });

  it('should receive messages sent directly to a user', async () => {
    const payload = { id: 'user-msg-1', email: 'msg1@test.com', role: 'STUDENT' };
    const token = jwt.sign(payload, JWT_SECRET!, { algorithm: 'HS256', expiresIn: '1h' });

    const wsUrl = `ws://127.0.0.1:${port}?token=${token}`;
    const ws = await createClient(wsUrl);

    const messagePromise = new Promise<any>((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    const testEvent = 'match-update';
    const testData = { scholarshipId: 'scholarship-123', score: 95 };

    const sent = webSocketService.sendMessageToUser('user-msg-1', testEvent, testData);
    expect(sent).toBe(true);

    const receivedMessage = await messagePromise;
    expect(receivedMessage.event).toBe(testEvent);
    expect(receivedMessage.data).toEqual(testData);
    expect(receivedMessage.timestamp).toBeDefined();
    
    ws.close();
  });

  it('should support broadcasting messages to all users or specific roles', async () => {
    // User 1: Student
    const token1 = jwt.sign({ id: 'student-1', email: 's1@test.com', role: 'STUDENT' }, JWT_SECRET!, { algorithm: 'HS256' });
    const ws1 = await createClient(`ws://127.0.0.1:${port}?token=${token1}`);

    // User 2: Admin
    const token2 = jwt.sign({ id: 'admin-1', email: 'a1@test.com', role: 'ADMIN' }, JWT_SECRET!, { algorithm: 'HS256' });
    const ws2 = await createClient(`ws://127.0.0.1:${port}?token=${token2}`);

    const ws1Messages: any[] = [];
    ws1.on('message', (data) => ws1Messages.push(JSON.parse(data.toString())));

    const ws2Messages: any[] = [];
    ws2.on('message', (data) => ws2Messages.push(JSON.parse(data.toString())));

    // Test Role Broadcast (Only Admin should receive)
    webSocketService.broadcastToRole('ADMIN', 'admin-announcement', { msg: 'Hello Admins' });
    
    // Wait a brief moment for delivery
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ws1Messages.length).toBe(0);
    expect(ws2Messages.length).toBe(1);
    expect(ws2Messages[0].event).toBe('admin-announcement');

    // Test Global Broadcast
    webSocketService.broadcast('global-alert', { msg: 'System shutdown in 5m' });
    
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(ws1Messages.length).toBe(1);
    expect(ws1Messages[0].event).toBe('global-alert');
    expect(ws2Messages.length).toBe(2);
    expect(ws2Messages[1].event).toBe('global-alert');

    ws1.close();
    ws2.close();
  });
});
