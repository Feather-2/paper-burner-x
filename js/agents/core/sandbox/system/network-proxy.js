/**
 * Network Proxy — HTTP/HTTPS 代理服务器
 *
 * 在宿主侧运行，拦截沙箱内的 HTTP/HTTPS 请求，
 * 通过 filterRequest 回调实现域名级出站控制。
 *
 * 参考 Anthropic sandbox-runtime http-proxy.ts 设计。
 *
 * @module core/sandbox/system/network-proxy
 */

import { createServer } from 'node:http';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { connect } from 'node:net';
import { URL } from 'node:url';
import { createLogger } from '../../../../shared/index.js';

const logger = createLogger('core/sandbox/system/network-proxy');

/**
 * @typedef {Object} NetworkProxyOptions
 * @property {(port: number, host: string) => Promise<boolean>|boolean} filter
 *   域名过滤回调，返回 true 允许，false 拒绝
 */

/**
 * @typedef {Object} NetworkProxyServer
 * @property {import('node:http').Server} server
 * @property {(port?: number, hostname?: string) => Promise<number>} listen
 * @property {() => number|undefined} getPort
 * @property {() => Promise<void>} close
 */

/**
 * 创建 HTTP/HTTPS 代理服务器
 * @param {NetworkProxyOptions} options
 * @returns {NetworkProxyServer}
 */
export function createNetworkProxy(options) {
  const server = createServer();

  // CONNECT 隧道 — HTTPS 流量
  server.on('connect', async (req, socket) => {
    socket.on('error', (err) => {
      logger.debug(`Client socket error: ${err.message}`);
    });

    try {
      const [hostname, portStr] = req.url.split(':');
      const port = portStr ? parseInt(portStr, 10) : undefined;

      if (!hostname || !port) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }

      const allowed = await options.filter(port, hostname);
      if (!allowed) {
        logger.debug(`CONNECT blocked: ${hostname}:${port}`);
        socket.end(
          'HTTP/1.1 403 Forbidden\r\n' +
          'Content-Type: text/plain\r\n' +
          'X-Proxy-Error: blocked-by-allowlist\r\n' +
          '\r\n' +
          'Connection blocked by network allowlist',
        );
        return;
      }

      const remote = connect(port, hostname, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        remote.pipe(socket);
        socket.pipe(remote);
      });

      remote.on('error', (err) => {
        logger.debug(`CONNECT tunnel failed: ${err.message}`);
        socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
      });
      socket.on('error', () => remote.destroy());
      socket.on('end', () => remote.end());
      remote.on('end', () => socket.end());
    } catch (err) {
      logger.error(`CONNECT handler error: ${err}`);
      socket.end('HTTP/1.1 500 Internal Server Error\r\n\r\n');
    }
  });

  // 普通 HTTP 请求转发
  server.on('request', async (req, res) => {
    try {
      const url = new URL(req.url);
      const hostname = url.hostname;
      const port = url.port
        ? parseInt(url.port, 10)
        : url.protocol === 'https:' ? 443 : 80;

      const allowed = await options.filter(port, hostname);
      if (!allowed) {
        logger.debug(`HTTP blocked: ${req.method} ${hostname}:${port}`);
        res.writeHead(403, {
          'Content-Type': 'text/plain',
          'X-Proxy-Error': 'blocked-by-allowlist',
        });
        res.end('Connection blocked by network allowlist');
        return;
      }

      const requestFn = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const proxyReq = requestFn(
        {
          hostname,
          port,
          path: url.pathname + url.search,
          method: req.method,
          headers: { ...req.headers, host: url.host },
        },
        (proxyRes) => {
          res.writeHead(proxyRes.statusCode, proxyRes.headers);
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('error', (err) => {
        logger.debug(`Proxy request failed: ${err.message}`);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Bad Gateway');
        }
      });

      req.pipe(proxyReq);
    } catch (err) {
      logger.error(`HTTP handler error: ${err}`);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  return {
    server,

    /**
     * @param {number} [port=0] - 0 = 随机端口
     * @param {string} [hostname='127.0.0.1']
     * @returns {Promise<number>}
     */
    listen(port = 0, hostname = '127.0.0.1') {
      return new Promise((resolve, reject) => {
        server.listen(port, hostname, () => {
          const addr = server.address();
          resolve(typeof addr === 'object' ? addr.port : port);
        });
        server.once('error', reject);
      });
    },

    getPort() {
      const addr = server.address();
      return typeof addr === 'object' ? addr?.port : undefined;
    },

    close() {
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}
