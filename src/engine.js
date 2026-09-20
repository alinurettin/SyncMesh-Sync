// SyncMesh-Sync v2.0.0 - Distributed Conflict-Free Replicated Data Types & Mesh Sync
// State-based CvRDT (LWW-Element-Set, PN-Counter), Vector Clocks & Gossip Convergence

const crypto = require('crypto');

/**
 * 1. Vector Clock Engine
 * Monotonically increasing logical timestamps establishing causal partial ordering.
 */
class VectorClock {
  constructor(nodeId, clockMap = {}) {
    this.nodeId = nodeId;
    this.clock = { ...clockMap };
    if (this.nodeId && !this.clock[this.nodeId]) {
      this.clock[this.nodeId] = 0;
    }
  }

  tick() {
    if (!this.nodeId) return this;
    this.clock[this.nodeId] = (this.clock[this.nodeId] || 0) + 1;
    return this;
  }

  clone() {
    return new VectorClock(this.nodeId, { ...this.clock });
  }

  merge(otherClock) {
    const other = otherClock instanceof VectorClock ? otherClock.clock : otherClock;
    const allKeys = new Set([...Object.keys(this.clock), ...Object.keys(other || {})]);
    for (const k of allKeys) {
      this.clock[k] = Math.max(this.clock[k] || 0, other[k] || 0);
    }
    return this;
  }

  /**
   * Compares causality between this and other:
   * 'EQUALS', 'BEFORE', 'AFTER', 'CONCURRENT'
   */
  compare(otherClock) {
    const other = otherClock instanceof VectorClock ? otherClock.clock : otherClock;
    const allKeys = new Set([...Object.keys(this.clock), ...Object.keys(other || {})]);

    let thisGreater = false;
    let otherGreater = false;

    for (const k of allKeys) {
      const v1 = this.clock[k] || 0;
      const v2 = other[k] || 0;
      if (v1 > v2) thisGreater = true;
      if (v2 > v1) otherGreater = true;
    }

    if (!thisGreater && !otherGreater) return 'EQUALS';
    if (thisGreater && !otherGreater) return 'AFTER';
    if (!thisGreater && otherGreater) return 'BEFORE';
    return 'CONCURRENT';
  }

  toJSON() {
    return { ...this.clock };
  }
}

/**
 * 2. Positive-Negative Counter CRDT (PN-Counter)
 * Join-semilattice supporting monotonic increments and decrements.
 */
class PNCounter {
  constructor(pMap = {}, nMap = {}) {
    this.p = { ...pMap }; // increments
    this.n = { ...nMap }; // decrements
  }

  increment(nodeId, amount = 1) {
    if (amount <= 0) return;
    this.p[nodeId] = (this.p[nodeId] || 0) + amount;
  }

  decrement(nodeId, amount = 1) {
    if (amount <= 0) return;
    this.n[nodeId] = (this.n[nodeId] || 0) + amount;
  }

  value() {
    const sumP = Object.values(this.p).reduce((acc, v) => acc + v, 0);
    const sumN = Object.values(this.n).reduce((acc, v) => acc + v, 0);
    return sumP - sumN;
  }

  merge(other) {
    const otherP = other.p || other.increments || {};
    const otherN = other.n || other.decrements || {};
    const pKeys = new Set([...Object.keys(this.p), ...Object.keys(otherP)]);
    const nKeys = new Set([...Object.keys(this.n), ...Object.keys(otherN)]);

    for (const k of pKeys) {
      this.p[k] = Math.max(this.p[k] || 0, otherP[k] || 0);
    }
    for (const k of nKeys) {
      this.n[k] = Math.max(this.n[k] || 0, otherN[k] || 0);
    }
    return this;
  }

  clone() {
    return new PNCounter({ ...this.p }, { ...this.n });
  }

  toJSON() {
    return {
      value: this.value(),
      p: { ...this.p },
      n: { ...this.n },
      increments: { ...this.p },
      decrements: { ...this.n }
    };
  }
}

/**
 * 3. Last-Write-Wins Element Set CRDT (LWW-Element-Set)
 * Convergent replicated data type utilizing wall-clock timestamps and vector clocks.
 */
class LWWElementSet {
  constructor(addMap = {}, removeMap = {}) {
    // element -> { timestamp, vectorClock: {} }
    this.addSet = new Map();
    this.removeSet = new Map();

    if (addMap) {
      for (const [k, v] of Object.entries(addMap)) this.addSet.set(k, v);
    }
    if (removeMap) {
      for (const [k, v] of Object.entries(removeMap)) this.removeSet.set(k, v);
    }
  }

  add(element, timestamp = Date.now(), vectorClock = null) {
    const existing = this.addSet.get(element);
    if (!existing || timestamp >= existing.timestamp) {
      this.addSet.set(element, {
        timestamp,
        vectorClock: vectorClock ? (vectorClock.toJSON ? vectorClock.toJSON() : vectorClock) : {}
      });
    }
  }

  remove(element, timestamp = Date.now(), vectorClock = null) {
    const existing = this.removeSet.get(element);
    if (!existing || timestamp >= existing.timestamp) {
      this.removeSet.set(element, {
        timestamp,
        vectorClock: vectorClock ? (vectorClock.toJSON ? vectorClock.toJSON() : vectorClock) : {}
      });
    }
  }

  has(element) {
    const addEntry = this.addSet.get(element);
    if (!addEntry) return false;

    const removeEntry = this.removeSet.get(element);
    if (!removeEntry) return true;

    // Last-Write-Wins bias: if timestamps equal, add wins
    return addEntry.timestamp >= removeEntry.timestamp;
  }

  read() {
    const elements = [];
    for (const [element] of this.addSet) {
      if (this.has(element)) {
        elements.push(element);
      }
    }
    return elements.sort();
  }

  merge(otherSet) {
    const otherAdds = otherSet instanceof LWWElementSet ? otherSet.addSet : new Map(Object.entries(otherSet.addSet || {}));
    const otherRemoves = otherSet instanceof LWWElementSet ? otherSet.removeSet : new Map(Object.entries(otherSet.removeSet || {}));

    for (const [elem, entry] of otherAdds) {
      const existing = this.addSet.get(elem);
      if (!existing || entry.timestamp > existing.timestamp) {
        this.addSet.set(elem, { ...entry });
      }
    }

    for (const [elem, entry] of otherRemoves) {
      const existing = this.removeSet.get(elem);
      if (!existing || entry.timestamp > existing.timestamp) {
        this.removeSet.set(elem, { ...entry });
      }
    }

    return this;
  }

  clone() {
    const cloned = new LWWElementSet();
    for (const [k, v] of this.addSet) cloned.addSet.set(k, { ...v });
    for (const [k, v] of this.removeSet) cloned.removeSet.set(k, { ...v });
    return cloned;
  }

  toJSON() {
    const addObj = {};
    const remObj = {};
    for (const [k, v] of this.addSet) addObj[k] = v;
    for (const [k, v] of this.removeSet) remObj[k] = v;
    return {
      elements: this.read(),
      addSet: addObj,
      removeSet: remObj
    };
  }
}

/**
 * 4. Mesh Peer Node
 * Encapsulates an individual distributed node with its local CRDT state and Vector Clock.
 */
class MeshNode {
  constructor(id, name = null) {
    this.id = id;
    this.name = name || `Node_${id}`;
    this.vectorClock = new VectorClock(this.id);
    this.lwwSet = new LWWElementSet();
    this.pnCounter = new PNCounter();
    this.gossipRounds = 0;
    this.lastGossipAt = null;
  }

  applyAdd(element) {
    this.vectorClock.tick();
    const ts = Date.now();
    this.lwwSet.add(element, ts, this.vectorClock);
    return { element, timestamp: ts, vectorClock: this.vectorClock.toJSON() };
  }

  applyRemove(element) {
    this.vectorClock.tick();
    const ts = Date.now();
    this.lwwSet.remove(element, ts, this.vectorClock);
    return { element, timestamp: ts, vectorClock: this.vectorClock.toJSON() };
  }

  applyIncrement(amount = 1) {
    this.vectorClock.tick();
    this.pnCounter.increment(this.id, amount);
    return this.pnCounter.value();
  }

  applyDecrement(amount = 1) {
    this.vectorClock.tick();
    this.pnCounter.decrement(this.id, amount);
    return this.pnCounter.value();
  }

  prepareGossip() {
    return {
      nodeId: this.id,
      vectorClock: this.vectorClock.toJSON(),
      lwwSet: this.lwwSet.toJSON(),
      pnCounter: this.pnCounter.toJSON(),
      timestamp: Date.now()
    };
  }

  receiveGossip(payload) {
    this.vectorClock.merge(payload.vectorClock);
    this.lwwSet.merge(payload.lwwSet);
    this.pnCounter.merge(payload.pnCounter);
    this.gossipRounds++;
    this.lastGossipAt = Date.now();
  }

  getState() {
    return {
      id: this.id,
      name: this.name,
      vectorClock: this.vectorClock.toJSON(),
      counter: this.pnCounter.value(),
      elements: this.lwwSet.read(),
      gossipRounds: this.gossipRounds,
      lastGossipAt: this.lastGossipAt
    };
  }
}

/**
 * 5. SyncMeshCoordinator
 * Orchestrates multi-peer mesh network, network partitions, and anti-entropy gossip convergence.
 */
class SyncMeshCoordinator {
  constructor() {
    this.nodes = new Map(); // id -> MeshNode
    this.partitions = new Set(); // set of blocked pairs e.g. "nodeA:nodeB"
    this.subscribers = new Set();
    this.startTime = Date.now();

    this.initDefaultCluster();
  }

  initDefaultCluster() {
    this.addNode('node_alpha', 'Cluster Leader (Alpha)');
    this.addNode('node_beta', 'Replica (Beta)');
    this.addNode('node_gamma', 'Edge Gateway (Gamma)');

    // Seed initial synchronized state
    const alpha = this.nodes.get('node_alpha');
    alpha.applyAdd('system.config.init');
    alpha.applyAdd('cluster.token.v1');
    alpha.applyIncrement(10);

    // Initial convergence gossip round
    this.triggerGossipSweep();
  }

  addNode(id, name) {
    if (this.nodes.has(id)) return this.nodes.get(id);
    const node = new MeshNode(id, name);
    this.nodes.set(id, node);
    this.broadcastEvent('node_joined', { id, name });
    return node;
  }

  removeNode(id) {
    const deleted = this.nodes.delete(id);
    if (deleted) {
      this.broadcastEvent('node_left', { id });
    }
    return deleted;
  }

  setPartition(nodeA, nodeB, blocked = true) {
    const key1 = `${nodeA}:${nodeB}`;
    const key2 = `${nodeB}:${nodeA}`;
    if (blocked) {
      this.partitions.add(key1);
      this.partitions.add(key2);
      this.broadcastEvent('partition_created', { nodeA, nodeB });
    } else {
      this.partitions.delete(key1);
      this.partitions.delete(key2);
      this.broadcastEvent('partition_healed', { nodeA, nodeB });
    }
  }

  isPartitioned(nodeA, nodeB) {
    return this.partitions.has(`${nodeA}:${nodeB}`) || this.partitions.has(`${nodeB}:${nodeA}`);
  }

  clearPartitions() {
    this.partitions.clear();
    this.broadcastEvent('partitions_cleared', {});
  }

  /**
   * Performs an anti-entropy pairwise gossip round across all unpartitioned nodes
   */
  triggerGossipSweep() {
    const nodeIds = Array.from(this.nodes.keys());
    let syncCount = 0;

    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const idA = nodeIds[i];
        const idB = nodeIds[j];

        if (this.isPartitioned(idA, idB)) continue;

        const nodeA = this.nodes.get(idA);
        const nodeB = this.nodes.get(idB);

        // Bi-directional gossip sync
        const payloadA = nodeA.prepareGossip();
        const payloadB = nodeB.prepareGossip();

        nodeA.receiveGossip(payloadB);
        nodeB.receiveGossip(payloadA);
        syncCount++;
      }
    }

    this.broadcastEvent('gossip_sweep_completed', {
      syncCount,
      isConverged: this.checkConvergence().converged
    });

    return { syncCount, convergence: this.checkConvergence() };
  }

  checkConvergence() {
    const nodeArray = Array.from(this.nodes.values());
    if (nodeArray.length <= 1) return { converged: true, commonElements: nodeArray[0]?.lwwSet.read() || [], counter: nodeArray[0]?.pnCounter.value() || 0 };

    const firstElems = JSON.stringify(nodeArray[0].lwwSet.read());
    const firstCounter = nodeArray[0].pnCounter.value();

    for (let i = 1; i < nodeArray.length; i++) {
      const elems = JSON.stringify(nodeArray[i].lwwSet.read());
      const counter = nodeArray[i].pnCounter.value();
      if (elems !== firstElems || counter !== firstCounter) {
        return { converged: false, divergenceReason: `Node ${nodeArray[i].id} differs from ${nodeArray[0].id}` };
      }
    }

    return {
      converged: true,
      commonElements: nodeArray[0].lwwSet.read(),
      counter: firstCounter
    };
  }

  subscribe(res) {
    this.subscribers.add(res);
    res.on('close', () => this.subscribers.delete(res));
  }

  broadcastEvent(eventType, payload) {
    const data = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of this.subscribers) {
      try { res.write(data); } catch (e) { this.subscribers.delete(res); }
    }
  }

  getMetrics() {
    const nodeStates = Array.from(this.nodes.values()).map(n => n.getState());
    const convergence = this.checkConvergence();

    return {
      totalNodes: this.nodes.size,
      activePartitions: Array.from(this.partitions),
      isConverged: convergence.converged,
      convergenceDetails: convergence,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      nodes: nodeStates
    };
  }
}

module.exports = {
  VectorClock,
  PNCounter,
  LWWElementSet,
  MeshNode,
  SyncMeshCoordinator
};
