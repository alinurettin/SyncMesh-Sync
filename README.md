# 🌐 SyncMesh-Sync v2.0.0

[![Engine: Node.js](https://img.shields.io/badge/Runtime-Node.js%20LTS-brightgreen.svg)](https://nodejs.org)
[![Architecture: Distributed-CRDT](https://img.shields.io/badge/Architecture-State--Based%20CvRDT-blue.svg)](#architecture)
[![Consensus: Join--Semilattice](https://img.shields.io/badge/Math-Join--Semilattice%20(LWW%2BPN)-cyan.svg)](#mathematical-foundations)
[![Tests: 28 Non-Mocked](https://img.shields.io/badge/Tests-28%2F28%20Passed%20(Zero%20Mocks)-success.svg)](#test-suite)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![GitHub: alinurettin](https://img.shields.io/badge/Author-alinurettin-purple.svg)](https://github.com/alinurettin)

> **Peer-to-Peer Conflict-Free Distributed State Synchronization Mesh with State-Based CvRDTs (LWW-Element-Set, PN-Counter), Vector Clocks, and Anti-Entropy Gossip Convergence.**

---

## 🇹🇷 Türkçe Açıklama ve Genel Bakış

**SyncMesh-Sync v2.0.0**, merkezi veritabanı veya kilit yöneticisi (distributed lock manager / master node) gerektirmeyen, uç cihazlar (edge computing), çevrimdışı çalışabilen mikroservisler ve dağıtık eşler (P2P peers) arasında güçlü nihai tutarlılık (Strong Eventual Consistency - SEC) sağlayan bir durum senkronizasyon motorudur.

### Öne Çıkan Yetenekler:
1. **Çatışmasız Çoğaltılan Veri Tipleri (CvRDT):** Matematiksel birleşme yarı-kafesleri (join-semilattices) üzerine inşa edilen Last-Write-Wins Element-Set (LWW) ve Positive-Negative Counter (PN-Counter). Güncellemelerin varış sırası veya ağ gecikmeleri ne olursa olsun çatışmasız kesin mutabakat sağlar.
2. **Vektör Saatleri (Vector Clocks):** Dağıtık sistemlerdeki nedensellik ilişkilerini (`BEFORE`, `AFTER`, `CONCURRENT`, `EQUALS`) mantıksal zaman damgalarıyla kesin olarak haritalandırır.
3. **Bölünmüş Beyin (Split-Brain) ve Ağ Kesintisi Simülasyonu:** Eşler arasındaki ağ bağlantısı kopsa dahi yerel okuma ve yazma işlemlerine kesintisiz devam edilir (CAP Teoremi AP prensibi).
4. **Anti-Entropi Dedikodu (Gossip) Protokolü:** Ağdaki kopukluklar giderildiğinde (heal), eşler karşılıklı durum özetlerini paylaşır ve veri kaybı olmadan saniyeler içinde %100 mutabakata ulaşır.
5. **Siber Karanlık Mod Operasyon Paneli:** `public/` dizininde küme topolojisini, vektör saatlerini, aktif ağ kopukluklarını ve canlı SSE akışını gösteren interaktif stüdyo.
6. **%100 Gerçek Soket Testleri:** Mock kullanılmadan, dinamik HTTP soketleri ve gerçek bölünmüş ağ koşulları üzerinden çalışan 28 ayrıntılı doğrulama testi.

---

## 🏛️ System Architecture

```mermaid
flowchart TD
    Client[Web Dashboard / REST Client] -->|HTTP / REST API| Server[HTTP Server & Mesh Gateway]
    Client <-->|SSE Stream: /api/events/stream| Server
    
    subgraph Mesh Coordinator [SyncMeshCoordinator]
        Server --> Coordinator[Coordinator Engine]
        Coordinator --> PartitionManager[Partition Controller]
        Coordinator --> GossipEngine[Anti-Entropy Gossip Sweeper]
        
        subgraph Cluster Fleet [Peer Nodes]
            NodeA[Node Alpha]
            NodeB[Node Beta]
            NodeC[Node Gamma]
        end
        
        Coordinator --- Cluster Fleet
    end
    
    subgraph Node Internal [MeshNode Subsystem]
        VC[Vector Clock]
        LWW[LWW-Element-Set CRDT]
        PNC[PN-Counter CRDT]
    end
    
    NodeA --- Node Internal
```

---

## 📐 Mathematical Foundations

### 1. CvRDT Join-Semilattice Theory
State-based CRDTs define state merges as the least upper bound ($\sqcup$) over a partially ordered set $(S, \le)$:
- **Commutative:** $x \sqcup y = y \sqcup x$
- **Associative:** $(x \sqcup y) \sqcup z = x \sqcup (y \sqcup z)$
- **Idempotent:** $x \sqcup x = x$

### 2. Vector Clock Causality
For nodes $N$, each clock $V_i$ advances monotonically:
- Local event on node $i$: $V_i[i] \leftarrow V_i[i] + 1$
- Gossip reception from node $j$: $V_i[k] \leftarrow \max(V_i[k], V_j[k]) \quad \forall k \in N$
- Causal relation:
  $$V_A < V_B \iff (\forall k, V_A[k] \le V_B[k]) \land (\exists k, V_A[k] < V_B[k])$$
  $$V_A \parallel V_B \iff \neg(V_A < V_B) \land \neg(V_B < V_A)$$

### 3. Last-Write-Wins Element-Set (LWW-Set)
Elements exist in Add-Set $A$ and Remove-Set $R$:
$$e \in S \iff \exists (e, t_a) \in A \land (\forall (e, t_r) \in R, t_a \ge t_r)$$
$$A_{\text{merged}} = A_1 \sqcup A_2 = \{ (e, \max(t_1, t_2)) \mid (e, t_1) \in A_1 \lor (e, t_2) \in A_2 \}$$

---

## 🚀 Quick Start & Installation

### Prerequisites
- **Node.js:** v18.0.0+ (Tested on v24.19.0 LTS)
- **Zero External Dependencies:** Built entirely using Node.js core standard modules (`http`, `net`, `crypto`).

### Installation
```bash
git clone https://github.com/alinurettin/SyncMesh-Sync.git
cd SyncMesh-Sync
```

### Running the Server
```bash
node src/index.js
```
The server will start on `http://localhost:6016`. Open your browser to access the distributed mesh studio.

### Running with Docker
```bash
docker-compose up -d --build
```

---

## 🧪 Comprehensive Test Suite (100% Non-Mocked)

Run the exhaustive verification suite testing vector clock causality, PN-counters, LWW-sets, partition split-brain recovery, and the REST API:

```bash
npm test
```

### Test Output Verification:
```text
====================================================
🧪 Running Verification Suite: SyncMesh-Sync v2.0.0
====================================================

[1/5] Testing Vector Clock Causality Engine...
  ✓ [PASS 1] Vector clock monotonic tick verified
  ✓ [PASS 2] Independent unmerged vector clocks identified as CONCURRENT
  ✓ [PASS 3] Direct causal ancestry (BEFORE and AFTER) verified
  ✓ [PASS 4] Forked vector clocks correctly resolve as CONCURRENT
  ✓ [PASS 5] Pointwise maximum merge preserves upper bound

[2/5] Testing PN-Counter Join-Semilattice...
  ✓ [PASS 6] Local increment and decrement compute correct net balance (8)
  ✓ [PASS 7] Independent peer counter tracks local balance (10)
  ✓ [PASS 8] Merged PN-Counter reflects unified global sum (8 + 10 = 18)
  ✓ [PASS 9] PN-Counter merge is idempotent (A * A = A)

[3/5] Testing LWW-Element-Set CRDT Engine...
  ✓ [PASS 10] Elements added to LWW-Set are queryable via .has()
  ✓ [PASS 11] Removal with later timestamp invalidates element
  ✓ [PASS 12] Re-addition with newer timestamp restores element (LWW semantics)
  ✓ [PASS 13] Bidirectional merge produces identical convergent element sets

[4/5] Testing Mesh Partition & Anti-Entropy Gossip...
  ✓ [PASS 14] Default 3-node cluster initialized in converged state
  ✓ [PASS 15] Network partition simulated, isolating node_gamma
  ✓ [PASS 16] Cluster correctly identified as DIVERGENT during active network partition
  ✓ [PASS 17] Healed cluster fully converged via anti-entropy gossip with zero data loss

[5/5] Testing Production HTTP API Gateway...
  ✓ [PASS 18] GET /api/health returned 200 UP
  ✓ [PASS 19] GET /api/stats returned mesh cluster metrics
  ✓ [PASS 20] GET /api/mesh/nodes returned active node array
  ✓ [PASS 21] POST /api/mesh/nodes successfully joined new peer node
  ✓ [PASS 22] POST /api/crdt/add committed element to node_delta LWW-Set
  ✓ [PASS 23] POST /api/crdt/counter incremented PN-Counter by 42
  ✓ [PASS 24] POST /api/mesh/gossip triggered cluster-wide synchronization round
  ✓ [PASS 25] POST /api/mesh/partition established partition between delta and alpha
  ✓ [PASS 26] POST /api/mesh/heal dissolved all partitions and triggered convergence
  ✓ [PASS 27] GET /api/events/stream established Server-Sent Events real-time sync stream
  ✓ [PASS 28] DELETE /api/mesh/nodes/:id gracefully removed peer node

====================================================
🎉 ALL 28 ASSERTIONS PASSED WITH ZERO MOCKS! (100% SUCCESS)
====================================================
```

---

## 📡 REST API Reference & cURL Examples

### 1. Add Element to a Node's LWW-Set
```bash
curl -X POST http://localhost:6016/api/crdt/add \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "node_alpha", "element": "security.firewall.rule_301"}'
```

### 2. Increment Distributed PN-Counter
```bash
curl -X POST http://localhost:6016/api/crdt/counter \
  -H "Content-Type: application/json" \
  -d '{"nodeId": "node_beta", "action": "inc", "amount": 5}'
```

### 3. Simulate Network Partition (Sever Link)
```bash
curl -X POST http://localhost:6016/api/mesh/partition \
  -H "Content-Type: application/json" \
  -d '{"nodeA": "node_alpha", "nodeB": "node_gamma", "blocked": true}'
```

### 4. Trigger Anti-Entropy Gossip Synchronization Round
```bash
curl -X POST http://localhost:6016/api/mesh/gossip
```

### 5. Heal All Partitions & Re-Converge
```bash
curl -X POST http://localhost:6016/api/mesh/heal
```

### 6. Listen to Real-Time SSE Gossip Stream
```bash
curl -N -H "Accept: text/event-stream" http://localhost:6016/api/events/stream
```

---

## 📄 License & Attribution

Distributed under the **MIT License**. Engineered with mathematical rigor by the Autonomous 7-Agent SDLC Software Factory for [Ali Nurettin Demir](https://github.com/alinurettin).
