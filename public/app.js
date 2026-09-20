// SyncMesh-Sync v2.0.0 - Interactive Mesh Topology Controller
document.addEventListener('DOMContentLoaded', () => {
  const kpiTotalNodes = document.getElementById('kpiTotalNodes');
  const kpiConvergenceCard = document.getElementById('kpiConvergenceCard');
  const kpiConvergence = document.getElementById('kpiConvergence');
  const kpiConvergenceSub = document.getElementById('kpiConvergenceSub');
  const kpiPartitions = document.getElementById('kpiPartitions');
  const kpiCounterSum = document.getElementById('kpiCounterSum');
  const kpiLwwElements = document.getElementById('kpiLwwElements');

  const sseLabel = document.getElementById('sseLabel');
  const btnHealCluster = document.getElementById('btnHealCluster');
  const btnGossipSweep = document.getElementById('btnGossipSweep');
  const nodesGrid = document.getElementById('nodesGrid');
  const feedContainer = document.getElementById('feedContainer');

  const partNodeA = document.getElementById('partNodeA');
  const partNodeB = document.getElementById('partNodeB');
  const btnBlockLink = document.getElementById('btnBlockLink');
  const btnUnblockLink = document.getElementById('btnUnblockLink');

  // Modals
  const addElementModal = document.getElementById('addElementModal');
  const targetNodeId = document.getElementById('targetNodeId');
  const newElementInput = document.getElementById('newElementInput');
  const btnCloseAddElemModal = document.getElementById('btnCloseAddElemModal');
  const btnConfirmAddElement = document.getElementById('btnConfirmAddElement');

  const addNodeModal = document.getElementById('addNodeModal');
  const btnOpenAddNodeModal = document.getElementById('btnOpenAddNodeModal');
  const btnCloseAddNodeModal = document.getElementById('btnCloseAddNodeModal');
  const btnConfirmAddNode = document.getElementById('btnConfirmAddNode');
  const newNodeId = document.getElementById('newNodeId');
  const newNodeName = document.getElementById('newNodeName');

  let currentMetrics = null;

  // Gossip Sweep
  btnGossipSweep.addEventListener('click', async () => {
    btnGossipSweep.disabled = true;
    btnGossipSweep.textContent = '⏳ Gossiping...';
    try {
      await fetch('/api/mesh/gossip', { method: 'POST' });
      await refreshData();
    } catch (e) {
      console.error(e);
    } finally {
      btnGossipSweep.disabled = false;
      btnGossipSweep.textContent = '⚡ Trigger Gossip Sweep';
    }
  });

  // Heal Cluster
  btnHealCluster.addEventListener('click', async () => {
    try {
      await fetch('/api/mesh/heal', { method: 'POST' });
      await refreshData();
    } catch (e) {
      console.error(e);
    }
  });

  // Partition Link
  btnBlockLink.addEventListener('click', async () => {
    const a = partNodeA.value;
    const b = partNodeB.value;
    if (a === b) return alert('Cannot partition a node from itself');
    try {
      await fetch('/api/mesh/partition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeA: a, nodeB: b, blocked: true })
      });
      await refreshData();
    } catch (e) {
      console.error(e);
    }
  });

  btnUnblockLink.addEventListener('click', async () => {
    const a = partNodeA.value;
    const b = partNodeB.value;
    try {
      await fetch('/api/mesh/partition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeA: a, nodeB: b, blocked: false })
      });
      await refreshData();
    } catch (e) {
      console.error(e);
    }
  });

  // Add Element Modal
  btnCloseAddElemModal.addEventListener('click', () => {
    addElementModal.style.display = 'none';
  });

  btnConfirmAddElement.addEventListener('click', async () => {
    const nodeId = targetNodeId.value;
    const element = newElementInput.value.trim();
    if (!element) return;

    try {
      await fetch('/api/crdt/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId, element })
      });
      addElementModal.style.display = 'none';
      newElementInput.value = '';
      await refreshData();
    } catch (e) {
      alert('Failed to add element: ' + e.message);
    }
  });

  // Join Node Modal
  btnOpenAddNodeModal.addEventListener('click', () => {
    addNodeModal.style.display = 'flex';
  });

  btnCloseAddNodeModal.addEventListener('click', () => {
    addNodeModal.style.display = 'none';
  });

  btnConfirmAddNode.addEventListener('click', async () => {
    const id = newNodeId.value.trim();
    const name = newNodeName.value.trim();
    if (!id) return;

    try {
      await fetch('/api/mesh/nodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name })
      });
      addNodeModal.style.display = 'none';
      newNodeId.value = '';
      newNodeName.value = '';
      await refreshData();
    } catch (e) {
      alert('Failed to join node: ' + e.message);
    }
  });

  // Data Refresh
  async function refreshData() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success && data.metrics) {
        currentMetrics = data.metrics;
        renderMetrics(currentMetrics);
      }
    } catch (e) {
      console.error('Refresh error:', e);
    }
  }

  function renderMetrics(metrics) {
    kpiTotalNodes.textContent = metrics.totalNodes;
    kpiPartitions.textContent = (metrics.activePartitions ? metrics.activePartitions.length / 2 : 0);

    if (metrics.isConverged) {
      kpiConvergence.textContent = 'CONVERGED';
      kpiConvergence.style.color = 'var(--accent-emerald)';
      kpiConvergenceSub.textContent = 'Strong eventual consistency';
      kpiConvergenceCard.className = 'kpi-card converged';
    } else {
      kpiConvergence.textContent = 'DIVERGENT';
      kpiConvergence.style.color = 'var(--accent-amber)';
      kpiConvergenceSub.textContent = metrics.convergenceDetails?.divergenceReason || 'Partitions active';
      kpiConvergenceCard.className = 'kpi-card diverged';
    }

    const firstNode = metrics.nodes && metrics.nodes[0];
    kpiCounterSum.textContent = firstNode ? firstNode.counter : 0;
    kpiLwwElements.textContent = firstNode ? firstNode.elements.length : 0;

    renderNodes(metrics.nodes || []);
    updatePartitionSelects(metrics.nodes || []);
  }

  function renderNodes(nodes) {
    if (nodes.length === 0) {
      nodesGrid.innerHTML = '<div class="feed-empty">No active mesh nodes found.</div>';
      return;
    }

    nodesGrid.innerHTML = nodes.map(n => {
      const vcPills = Object.entries(n.vectorClock || {}).map(([k, v]) => {
        return `<span class="vc-pill">${escapeHtml(k)}: ${v}</span>`;
      }).join('');

      const elemPills = (n.elements || []).map(elem => {
        return `<span class="elem-pill"><span>${escapeHtml(elem)}</span><span class="elem-del" data-node="${n.id}" data-elem="${escapeHtml(elem)}">&times;</span></span>`;
      }).join('');

      return `
        <div class="node-card" data-id="${n.id}">
          <div class="node-card-header">
            <div class="node-title-group">
              <h4>${escapeHtml(n.name)}</h4>
              <span class="node-id-lbl">${escapeHtml(n.id)} &bull; ${n.gossipRounds} syncs</span>
            </div>
          </div>

          <div class="node-crdt-strip">
            <span style="font-size:11px; color:var(--text-muted);">PN-Counter:</span>
            <span class="crdt-counter-val">${n.counter}</span>
            <div class="crdt-btns">
              <button class="btn btn-secondary btn-sm btn-counter-dec" data-id="${n.id}">-1</button>
              <button class="btn btn-secondary btn-sm btn-counter-inc" data-id="${n.id}">+1</button>
            </div>
          </div>

          <div class="node-vc-box">
            <span class="vc-title">VECTOR CLOCK</span>
            <div class="vc-pills">${vcPills || '<span style="color:var(--text-muted);font-size:10px;">Empty</span>'}</div>
          </div>

          <div class="node-elements-box">
            <span class="vc-title">LWW-SET ELEMENTS (${n.elements.length})</span>
            <div class="elements-list">${elemPills || '<span style="color:var(--text-muted);font-size:11px;">Empty set</span>'}</div>
          </div>

          <div class="node-actions">
            <button class="btn btn-primary btn-sm btn-add-elem" data-id="${n.id}">+ Add Element</button>
          </div>
        </div>
      `;
    }).join('');

    // Wire Node Buttons
    document.querySelectorAll('.btn-add-elem').forEach(btn => {
      btn.addEventListener('click', () => {
        targetNodeId.value = btn.dataset.id;
        addElementModal.style.display = 'flex';
      });
    });

    document.querySelectorAll('.btn-counter-inc').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch('/api/crdt/counter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: btn.dataset.id, action: 'inc', amount: 1 })
        });
        await refreshData();
      });
    });

    document.querySelectorAll('.btn-counter-dec').forEach(btn => {
      btn.addEventListener('click', async () => {
        await fetch('/api/crdt/counter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId: btn.dataset.id, action: 'dec', amount: 1 })
        });
        await refreshData();
      });
    });

    document.querySelectorAll('.elem-del').forEach(span => {
      span.addEventListener('click', async () => {
        const nodeId = span.dataset.node;
        const element = span.dataset.elem;
        await fetch('/api/crdt/remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nodeId, element })
        });
        await refreshData();
      });
    });
  }

  function updatePartitionSelects(nodes) {
    const currentA = partNodeA.value;
    const currentB = partNodeB.value;

    partNodeA.innerHTML = nodes.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
    partNodeB.innerHTML = nodes.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

    if (currentA && nodes.some(n => n.id === currentA)) partNodeA.value = currentA;
    if (currentB && nodes.some(n => n.id === currentB)) partNodeB.value = currentB;
  }

  function appendFeed(type, title, desc) {
    const empty = feedContainer.querySelector('.feed-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = `feed-item ${type}`;
    item.innerHTML = `
      <div class="feed-item-top">
        <span class="feed-item-title">${escapeHtml(title)}</span>
        <span>${new Date().toLocaleTimeString()}</span>
      </div>
      <div style="color: var(--text-secondary);">${escapeHtml(desc)}</div>
    `;

    feedContainer.prepend(item);
    while (feedContainer.children.length > 25) {
      feedContainer.removeChild(feedContainer.lastChild);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // SSE Stream
  function initSSE() {
    const evt = new EventSource('/api/events/stream');

    evt.addEventListener('init', (e) => {
      sseLabel.textContent = 'SSE Live Connected';
      const parsed = JSON.parse(e.data);
      if (parsed.metrics) renderMetrics(parsed.metrics);
    });

    evt.addEventListener('crdt_element_added', (e) => {
      const data = JSON.parse(e.data);
      appendFeed('gossip', `Add: ${data.element}`, `Node: ${data.nodeId}`);
      refreshData();
    });

    evt.addEventListener('crdt_element_removed', (e) => {
      const data = JSON.parse(e.data);
      appendFeed('partition', `Remove: ${data.element}`, `Node: ${data.nodeId}`);
      refreshData();
    });

    evt.addEventListener('crdt_counter_updated', (e) => {
      const data = JSON.parse(e.data);
      appendFeed('gossip', `Counter: ${data.action} ${data.delta}`, `Node: ${data.nodeId} (val: ${data.counter})`);
      refreshData();
    });

    evt.addEventListener('gossip_sweep_completed', (e) => {
      const data = JSON.parse(e.data);
      appendFeed('gossip', 'Gossip Sync Round', `${data.syncCount} pairs synchronized. Converged: ${data.isConverged}`);
      refreshData();
    });

    evt.addEventListener('partition_created', (e) => {
      const data = JSON.parse(e.data);
      appendFeed('partition', 'Partition Severed', `Blocked: ${data.nodeA} <-> ${data.nodeB}`);
      refreshData();
    });

    evt.addEventListener('partition_healed', (e) => {
      const data = JSON.parse(e.data);
      appendFeed('gossip', 'Partition Healed', `Restored: ${data.nodeA} <-> ${data.nodeB}`);
      refreshData();
    });

    evt.onopen = () => { sseLabel.textContent = 'SSE Live Stream Active'; };
    evt.onerror = () => { sseLabel.textContent = 'SSE Reconnecting...'; };
  }

  // Initial Load
  refreshData();
  initSSE();
});
