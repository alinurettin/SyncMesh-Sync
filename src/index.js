// SyncMesh-Sync v2.0.0 - Production HTTP Server & Mesh Gateway
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { SyncMeshCoordinator } = require('./engine');

const coordinator = new SyncMeshCoordinator();
const PORT = parseInt(process.env.PORT, 10) || 6016;
const publicDir = path.join(__dirname, '..', 'public');
const startTime = Date.now();

function requestHandler(req, res) {
  const reqUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const pathname = reqUrl.pathname;

  // CORS Headers
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With'
    });
    return res.end();
  }

  // SSE Live Stream Endpoint
  if (req.method === 'GET' && pathname === '/api/events/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 3000\n\n');

    const initData = JSON.stringify({
      type: 'INIT',
      metrics: coordinator.getMetrics(),
      timestamp: Date.now()
    });
    res.write(`event: init\ndata: ${initData}\n\n`);

    coordinator.subscribe(res);
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    const jsonRes = (statusCode, data) => {
      res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify(data));
    };

    let parsedBody = {};
    if (body) {
      try { parsedBody = JSON.parse(body); } catch (e) { /* fallback empty */ }
    }

    // 1. Health API
    if (pathname === '/api/health') {
      return jsonRes(200, {
        status: 'UP',
        service: 'SyncMesh-Sync',
        version: '2.0.0',
        uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString()
      });
    }

    // 2. Stats & Telemetry API
    if (pathname === '/api/stats') {
      return jsonRes(200, {
        success: true,
        service: 'SyncMesh-Sync',
        version: '2.0.0',
        metrics: coordinator.getMetrics()
      });
    }

    // 3. List Nodes API
    if (req.method === 'GET' && pathname === '/api/mesh/nodes') {
      const nodes = Array.from(coordinator.nodes.values()).map(n => n.getState());
      return jsonRes(200, { success: true, count: nodes.length, nodes });
    }

    // 4. Add Node API
    if (req.method === 'POST' && pathname === '/api/mesh/nodes') {
      const id = parsedBody.id || `node_${Date.now().toString(36)}`;
      const name = parsedBody.name || `Peer_${id}`;
      const node = coordinator.addNode(id, name);
      return jsonRes(201, { success: true, node: node.getState() });
    }

    // 5. Delete Node API
    const nodeMatch = pathname.match(/^\/api\/mesh\/nodes\/([^/]+)$/);
    if (req.method === 'DELETE' && nodeMatch) {
      const id = nodeMatch[1];
      const deleted = coordinator.removeNode(id);
      return jsonRes(deleted ? 200 : 404, { success: deleted, id });
    }

    // 6. CRDT: Add Element to LWW-Set
    if (req.method === 'POST' && pathname === '/api/crdt/add') {
      const { nodeId, element } = parsedBody;
      const node = coordinator.nodes.get(nodeId);
      if (!node) return jsonRes(404, { success: false, error: `Node ${nodeId} not found` });
      if (!element) return jsonRes(400, { success: false, error: 'Element string is required' });

      const result = node.applyAdd(element);
      coordinator.broadcastEvent('crdt_element_added', { nodeId, element, ...result });
      return jsonRes(200, { success: true, node: node.getState(), result });
    }

    // 7. CRDT: Remove Element from LWW-Set
    if (req.method === 'POST' && pathname === '/api/crdt/remove') {
      const { nodeId, element } = parsedBody;
      const node = coordinator.nodes.get(nodeId);
      if (!node) return jsonRes(404, { success: false, error: `Node ${nodeId} not found` });
      if (!element) return jsonRes(400, { success: false, error: 'Element string is required' });

      const result = node.applyRemove(element);
      coordinator.broadcastEvent('crdt_element_removed', { nodeId, element, ...result });
      return jsonRes(200, { success: true, node: node.getState(), result });
    }

    // 8. CRDT: Update PN-Counter
    if (req.method === 'POST' && pathname === '/api/crdt/counter') {
      const { nodeId, action, amount } = parsedBody;
      const node = coordinator.nodes.get(nodeId);
      if (!node) return jsonRes(404, { success: false, error: `Node ${nodeId} not found` });

      const delta = parseInt(amount, 10) || 1;
      let newVal = 0;
      if (action === 'dec') {
        newVal = node.applyDecrement(delta);
      } else {
        newVal = node.applyIncrement(delta);
      }

      coordinator.broadcastEvent('crdt_counter_updated', { nodeId, action, delta, counter: newVal });
      return jsonRes(200, { success: true, node: node.getState(), counter: newVal });
    }

    // 9. Trigger Gossip Round
    if (req.method === 'POST' && pathname === '/api/mesh/gossip') {
      const result = coordinator.triggerGossipSweep();
      return jsonRes(200, { success: true, ...result, metrics: coordinator.getMetrics() });
    }

    // 10. Simulate Network Partition
    if (req.method === 'POST' && pathname === '/api/mesh/partition') {
      const { nodeA, nodeB, blocked } = parsedBody;
      if (!nodeA || !nodeB) return jsonRes(400, { success: false, error: 'nodeA and nodeB required' });
      coordinator.setPartition(nodeA, nodeB, blocked !== false);
      return jsonRes(200, { success: true, partitions: Array.from(coordinator.partitions) });
    }

    // 11. Heal All Partitions & Converge
    if (req.method === 'POST' && pathname === '/api/mesh/heal') {
      coordinator.clearPartitions();
      const gossipResult = coordinator.triggerGossipSweep();
      return jsonRes(200, { success: true, healed: true, ...gossipResult });
    }

    // 12. Static Web UI Files
    let filePath = path.join(publicDir, pathname === '/' ? 'index.html' : pathname);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.json': 'application/json; charset=utf-8'
      };
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
      return fs.createReadStream(filePath).pipe(res);
    }

    jsonRes(404, { error: 'Endpoint Not Found', path: pathname });
  });
}

function startServer(port = PORT, callback) {
  const server = http.createServer(requestHandler);
  server.listen(port, () => {
    if (callback) callback(server);
  });
  return server;
}

if (require.main === module) {
  startServer(PORT, () => {
    console.log(`🌐 SyncMesh-Sync v2.0.0 running on http://localhost:${PORT}`);
  });
}

module.exports = { startServer, requestHandler, coordinator };
