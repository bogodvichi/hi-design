import { WebSocketServer } from 'ws';

/**
 * ws-server-startup.ts
 *
 * 内联实现 WebSocket 服务（默认端口 9528），使用 ws 包。
 *
 * 设计目标：
 * 1. 在打包环境（macOS DMG / Windows 安装包）中稳定运行
 * 2. 避免信号处理、进程管理导致 Electron sidecar 异常退出
 * 3. 端口冲突时优雅降级
 * 4. 所有未捕获异常记录到 stderr，不直接 process.exit
 */

// ==================== 常量 ====================

const WS_DEFAULT_PORT = 9528;
const HEARTBEAT_INTERVAL_MS = 30000;

/** 是否运行在打包后的 Electron 环境中 */
const IS_PACKAGED = process.env.NODE_ENV === 'production' || !!process.env.OD_PACKAGED;

// ==================== 日志工具 ====================

function log(level: 'info' | 'warn' | 'error', message: string) {
  const timestamp = new Date().toISOString();
  const prefix = `[ws-server] [${level}] ${timestamp}`;
  if (level === 'error') {
    console.error(`${prefix} ${message}`);
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}`);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// ==================== WebSocket 服务 ====================

function formatRemoteIp(addr: string | undefined): string {
  if (!addr) return 'unknown';
  return addr.startsWith('::ffff:') ? addr.slice(7) : addr;
}

function logWsListen(port: number) {
  log('info', `[ws-server] listening on ws://127.0.0.1:${port}`);
}

function broadcastHeartbeat(wss: WebSocketServer) {
  const payload = JSON.stringify({ type: 'heartbeat', t: Date.now() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      client.send(payload);
    }
  }
}

function bindHandlers(wss: WebSocketServer) {
  wss.on('connection', (ws, req) => {
    const ip = formatRemoteIp(req.socket.remoteAddress);
    log('info', `[ws-server] client connected: ${ip} (total: ${wss.clients.size})`);

    ws.on('message', (data, isBinary) => {
      const payload = isBinary ? data : data.toString();
      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(payload, { binary: isBinary });
        }
      }
    });

    ws.on('close', () => {
      log('info', `[ws-server] client disconnected: ${ip} (total: ${wss.clients.size})`);
    });
  });
}

// ==================== 导出 ====================

export type StartedWsServer = {
  url: string;
  stop(): Promise<void>;
};

/** 启动 WebSocket 服务（默认端口 9528） */
export function startWsServer(port: number = WS_DEFAULT_PORT): StartedWsServer {
  const bindHost = '127.0.0.1'//IS_PACKAGED ? '127.0.0.1' : '0.0.0.0';
  const wss = new WebSocketServer({ port, host: bindHost });

  bindHandlers(wss);

  wss.on('listening', () => {
    logWsListen(port);
    if (HEARTBEAT_INTERVAL_MS > 0) {
      broadcastHeartbeat(wss);
      setInterval(() => broadcastHeartbeat(wss), HEARTBEAT_INTERVAL_MS);
    }
  });

  wss.on('error', (err) => {
    log('error', `[ws-server] error: ${err.message}`);
  });

  return {
    url: `ws://${bindHost}:${port}`,
    async stop() {
      return new Promise<void>((resolve) => {
        wss.close(() => resolve());
      });
    },
  };
}
