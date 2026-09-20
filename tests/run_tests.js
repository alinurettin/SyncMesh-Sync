// SyncMesh-Sync v2.0.0 - Exhaustive Verification Suite
// Vector Clocks, CvRDT (LWW-Element-Set, PN-Counter), Split-Brain Convergence & HTTP Mesh Gateway
const assert = require('assert');
const http = require('http');

const { VectorClock, PNCounter, LWWElementSet, MeshNode, SyncMeshCoordinator } = require('../src/engine');
const { startServer } = require('../src/index');

console.log('====================================================');
console.log('🧪 Running Verification Suite: SyncMesh-Sync v2.0.0');
console.log('====================================================');

let totalPassed = 0;
function pass(desc) {
  totalPassed++;
  console.log(`  ✓ [PASS ${totalPassed}] ${desc}`);
}

async function runAllTests() {
  // -------------------------------------------------------------
  // 1. Vector Clock Causal Partial Ordering Engine
  // -------------------------------------------------------------
  console.log('\n[1/5] Testing Vector Clock Causality Engine...');

  const vcA = new VectorClock('nodeA');
  const vcB = new VectorClock('nodeB');

  assert.strictEqual(vcA.clock['nodeA'], 0);
  vcA.tick();
  assert.strictEqual(vcA.clock['nodeA'], 1);
  pass('Vector clock monotonic tick verified');

  vcB.tick();
  // vcA = {nodeA: 1, nodeB: 0}, vcB = {nodeA: 0, nodeB: 1}
  assert.strictEqual(vcA.compare(vcB), 'CONCURRENT');
  pass('Independent unmerged vector clocks identified as CONCURRENT');

  // Sync B with A, then tick B: vcB should be AFTER vcA
  vcB.merge(vcA);
  assert.strictEqual(vcB.clock['nodeA'], 1);
  vcB.tick(); // vcB = {nodeA: 1, nodeB: 1}
  assert.strictEqual(vcB.compare(vcA), 'AFTER');
  assert.strictEqual(vcA.compare(vcB), 'BEFORE');
  pass('Direct causal ancestry (BEFORE and AFTER) verified');

  // Forked concurrent states
  const vcC = vcB.clone().tick(); // {nodeA: 1, nodeB: 2}
  vcA.tick().tick(); // {nodeA: 3}
  assert.strictEqual(vcA.compare(vcC), 'CONCURRENT');
  pass('Forked vector clocks correctly resolve as CONCURRENT');

  // Merge pointwise max
  vcA.merge(vcC);
  assert.strictEqual(vcA.clock['nodeA'], 3);
  assert.strictEqual(vcA.clock['nodeB'], 3);
  pass('Pointwise maximum merge preserves upper bound');

  // -------------------------------------------------------------
  // 2. Positive-Negative Counter CRDT (PN-Counter)
  // -------------------------------------------------------------
  console.log('\n[2/5] Testing PN-Counter Join-Semilattice...');

  const counter1 = new PNCounter();
  const counter2 = new PNCounter();

  counter1.increment('nodeA', 10);
  counter1.decrement('nodeA', 2);
  assert.strictEqual(counter1.value(), 8);
  pass('Local increment and decrement compute correct net balance (8)');

  counter2.increment('nodeB', 15);
  counter2.decrement('nodeB', 5);
  assert.strictEqual(counter2.value(), 10);
  pass('Independent peer counter tracks local balance (10)');

  // Merge counter1 into counter2
  counter1.merge(counter2);
  assert.strictEqual(counter1.value(), 18);
  pass('Merged PN-Counter reflects unified global sum (8 + 10 = 18)');

  // Idempotence: merge self produces identical state
  counter1.merge(counter1);
  assert.strictEqual(counter1.value(), 18);
  pass('PN-Counter merge is idempotent (A * A = A)');

  // -------------------------------------------------------------
  // 3. Last-Write-Wins Element Set CRDT (LWW-Element-Set)
  // -------------------------------------------------------------
  console.log('\n[3/5] Testing LWW-Element-Set CRDT Engine...');

  const setA = new LWWElementSet();
  const setB = new LWWElementSet();

  setA.add('config_key_1', 100);
  setA.add('config_key_2', 100);
  assert.strictEqual(setA.has('config_key_1'), true);
  assert.strictEqual(setA.has('config_key_2'), true);
  pass('Elements added to LWW-Set are queryable via .has()');

  // Remove element with later timestamp
  setA.remove('config_key_1', 150);
  assert.strictEqual(setA.has('config_key_1'), false);
  pass('Removal with later timestamp invalidates element');

  // Re-add element with even later timestamp (Last-Write-Wins)
  setA.add('config_key_1', 200);
  assert.strictEqual(setA.has('config_key_1'), true);
  pass('Re-addition with newer timestamp restores element (LWW semantics)');

  // Replicate to SetB and assert convergence
  setB.add('config_key_3', 250);
  setA.merge(setB);
  setB.merge(setA);

  assert.deepStrictEqual(setA.read(), ['config_key_1', 'config_key_2', 'config_key_3']);
  assert.deepStrictEqual(setB.read(), ['config_key_1', 'config_key_2', 'config_key_3']);
  pass('Bidirectional merge produces identical convergent element sets');

  // -------------------------------------------------------------
  // 4. Split-Brain Partition Simulation & Gossip Convergence
  // -------------------------------------------------------------
  console.log('\n[4/5] Testing Mesh Partition & Anti-Entropy Gossip...');

  const coordinator = new SyncMeshCoordinator();
  assert.strictEqual(coordinator.nodes.size, 3);
  assert.strictEqual(coordinator.checkConvergence().converged, true);
  pass('Default 3-node cluster initialized in converged state');

  // Simulate network partition: isolate node_gamma from node_alpha and node_beta
  coordinator.setPartition('node_alpha', 'node_gamma', true);
  coordinator.setPartition('node_beta', 'node_gamma', true);
  assert.strictEqual(coordinator.isPartitioned('node_alpha', 'node_gamma'), true);
  pass('Network partition simulated, isolating node_gamma');

  // Make concurrent writes on both sides of the network partition
  const alpha = coordinator.nodes.get('node_alpha');
  const gamma = coordinator.nodes.get('node_gamma');

  alpha.applyAdd('alpha_exclusive_doc');
  alpha.applyIncrement(50);

  gamma.applyAdd('gamma_exclusive_doc');
  gamma.applyDecrement(20);

  // Gossip sweep during partition
  coordinator.triggerGossipSweep();

  // Alpha and Beta should converge with each other, but diverge from Gamma
  const convDuringPartition = coordinator.checkConvergence();
  assert.strictEqual(convDuringPartition.converged, false);
  pass('Cluster correctly identified as DIVERGENT during active network partition');

  // Heal partition and run gossip sweep
  coordinator.clearPartitions();
  const healResult = coordinator.triggerGossipSweep();
  assert.strictEqual(healResult.convergence.converged, true);
  assert.strictEqual(coordinator.checkConvergence().converged, true);

  // Verify all 3 nodes have both documents
  for (const node of coordinator.nodes.values()) {
    const elems = node.lwwSet.read();
    assert(elems.includes('alpha_exclusive_doc'));
    assert(elems.includes('gamma_exclusive_doc'));
  }
  pass('Healed cluster fully converged via anti-entropy gossip with zero data loss');

  // -------------------------------------------------------------
  // 5. Production HTTP API Gateway Integration
  // -------------------------------------------------------------
  console.log('\n[5/5] Testing Production HTTP API Gateway...');

  const apiServer = await new Promise(resolve => {
    const s = startServer(0, () => resolve(s));
  });
  const apiPort = apiServer.address().port;

  const makeReq = (options, postData) => new Promise((resolve, reject) => {
    const opts = {
      hostname: '127.0.0.1',
      port: apiPort,
      ...options
    };
    const req = http.request(opts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, json: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, headers: res.headers, body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    req.end();
  });

  // GET /api/health
  const healthRes = await makeReq({ path: '/api/health', method: 'GET' });
  assert.strictEqual(healthRes.status, 200);
  assert.strictEqual(healthRes.json.status, 'UP');
  assert.strictEqual(healthRes.json.service, 'SyncMesh-Sync');
  pass('GET /api/health returned 200 UP');

  // GET /api/stats
  const statsRes = await makeReq({ path: '/api/stats', method: 'GET' });
  assert.strictEqual(statsRes.status, 200);
  assert.strictEqual(statsRes.json.success, true);
  assert(statsRes.json.metrics.totalNodes >= 3);
  pass('GET /api/stats returned mesh cluster metrics');

  // GET /api/mesh/nodes
  const nodesRes = await makeReq({ path: '/api/mesh/nodes', method: 'GET' });
  assert.strictEqual(nodesRes.status, 200);
  assert(Array.isArray(nodesRes.json.nodes));
  pass('GET /api/mesh/nodes returned active node array');

  // POST /api/mesh/nodes (add new peer)
  const addNodeRes = await makeReq({
    path: '/api/mesh/nodes',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { id: 'node_delta', name: 'Dynamic Edge Delta' });
  assert.strictEqual(addNodeRes.status, 201);
  assert.strictEqual(addNodeRes.json.node.id, 'node_delta');
  pass('POST /api/mesh/nodes successfully joined new peer node');

  // POST /api/crdt/add
  const crdtAddRes = await makeReq({
    path: '/api/crdt/add',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { nodeId: 'node_delta', element: 'auth.jwt.secret.rotated' });
  assert.strictEqual(crdtAddRes.status, 200);
  assert.strictEqual(crdtAddRes.json.success, true);
  pass('POST /api/crdt/add committed element to node_delta LWW-Set');

  // POST /api/crdt/counter
  const counterRes = await makeReq({
    path: '/api/crdt/counter',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { nodeId: 'node_delta', action: 'inc', amount: 42 });
  assert.strictEqual(counterRes.status, 200);
  assert.strictEqual(counterRes.json.counter, 42);
  pass('POST /api/crdt/counter incremented PN-Counter by 42');

  // POST /api/mesh/gossip
  const gossipRes = await makeReq({
    path: '/api/mesh/gossip',
    method: 'POST'
  });
  assert.strictEqual(gossipRes.status, 200);
  assert(gossipRes.json.syncCount > 0);
  pass('POST /api/mesh/gossip triggered cluster-wide synchronization round');

  // POST /api/mesh/partition
  const partRes = await makeReq({
    path: '/api/mesh/partition',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { nodeA: 'node_delta', nodeB: 'node_alpha', blocked: true });
  assert.strictEqual(partRes.status, 200);
  assert.strictEqual(partRes.json.success, true);
  pass('POST /api/mesh/partition established partition between delta and alpha');

  // POST /api/mesh/heal
  const healRes = await makeReq({
    path: '/api/mesh/heal',
    method: 'POST'
  });
  assert.strictEqual(healRes.status, 200);
  assert.strictEqual(healRes.json.healed, true);
  pass('POST /api/mesh/heal dissolved all partitions and triggered convergence');

  // Test SSE Stream Handshake
  const sseHandshake = await new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: apiPort,
      path: '/api/events/stream',
      method: 'GET'
    }, (res) => {
      assert.strictEqual(res.statusCode, 200);
      assert.strictEqual(res.headers['content-type'], 'text/event-stream');
      res.on('data', chunk => {
        const text = chunk.toString();
        if (text.includes('event: init')) {
          req.destroy();
          resolve(true);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
  assert.strictEqual(sseHandshake, true);
  pass('GET /api/events/stream established Server-Sent Events real-time sync stream');

  // DELETE /api/mesh/nodes/:id
  const deleteRes = await makeReq({
    path: '/api/mesh/nodes/node_delta',
    method: 'DELETE'
  });
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.json.success, true);
  pass('DELETE /api/mesh/nodes/:id gracefully removed peer node');

  // Teardown
  await new Promise(resolve => apiServer.close(resolve));

  console.log('\n====================================================');
  console.log(`🎉 ALL ${totalPassed} ASSERTIONS PASSED WITH ZERO MOCKS! (100% SUCCESS)`);
  console.log('====================================================\n');
  process.exit(0);
}

runAllTests().catch(err => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
