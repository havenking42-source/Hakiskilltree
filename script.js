/* ===========================================================
   One Piece Haki Skill Trees - Unified Viewport Version
   =========================================================== */

const trees = [
  { id: "armament-tree", file: "data/armament.json", title: "Armament Haki" },
  { id: "observation-tree", file: "data/observation.json", title: "Observation Haki" },
  { id: "conqueror-tree", file: "data/conqueror.json", title: "Conqueror's Haki" }
];

const descBox = document.getElementById("desc-box");
const totalInput = document.getElementById("totalPoints");
const remainingDisplay = document.getElementById("remaining");
const saveBtn = document.getElementById("saveBtn");
const loadBtn = document.getElementById("loadBtn");
const wrapper = document.getElementById("tree-wrapper");

// Elements for character stats UI (populated after DOM changes)
let statsToggle = null;
let charStatsBox = null;

let totalPoints = Number(totalInput?.value || 10);
let selected = new Set();
window.__treeDataStore = [];

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* -----------------------------------------------------------
   INITIAL LOAD
----------------------------------------------------------- */
async function loadTrees() {
  window.__treeDataStore = [];

  // Create viewport layer inside wrapper
  let viewport = document.createElement("div");
  viewport.id = "viewport";
  viewport.style.position = "absolute";
  viewport.style.left = "0";
  viewport.style.top = "0";
  viewport.style.width = "100%";
  viewport.style.height = "100%";
  viewport.style.transformOrigin = "0 0";
  viewport.style.overflow = "visible";
  wrapper.appendChild(viewport);

  // Fetch and place each tree
  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    let data = [];
    try {
      const res = await fetch(tree.file);
      data = await res.json();
    } catch {
      console.warn(`Missing ${tree.file}`);
    }

    data.forEach(s => {
      s.id = s.id || s.name.toLowerCase().replace(/\s+/g, "_");
      s.type = (s.type || "shared").toLowerCase();
      s.requires = Array.isArray(s.requires) ? s.requires : (s.requires ? [s.requires] : []);
    });

    const treeEl = document.getElementById(tree.id);
    const canvas = treeEl.querySelector(".tree-canvas");

    // Move this tree into viewport
    viewport.appendChild(treeEl);
    treeEl.style.position = "absolute";
  treeEl.style.left = `${i * window.innerWidth * 1.25}px`; // wider spacing between trees
    treeEl.style.top = "0";
    treeEl.style.width = "1000px";
    treeEl.style.height = "700px";

    const container = canvas;
    window.__treeDataStore.push({ treeId: tree.id, data, container, treeEl });
    layoutAndRender(tree.id, data, container, treeEl);
  }

  updateRemainingUI();
  setupGlobalInteractions();
  attachGlobalPanZoom(viewport);

  // Restore auto-saved progress after trees are loaded and DOM is ready
  const autoRaw = localStorage.getItem("hakiTreeAuto_v2");
  if (autoRaw) {
    try {
      const data = JSON.parse(autoRaw);
      selected = new Set(data.selected || []);
      if (data.totalPoints && totalInput) totalInput.value = data.totalPoints;
      if (data.charName) document.getElementById("charName").value = data.charName;
      const poolChoices = data.poolChoices || {};
      const awakeningValues = data.awakeningValues || {};
      window.__treeDataStore.forEach(store => {
        store.data.forEach(s => {
          const key = `${store.treeId}::${s.id}`;
          if (poolChoices[s.id] != null) s._poolChoiceValue = poolChoices[s.id];
          if (awakeningValues[s.id]) s._awakening = awakeningValues[s.id];
          if (s._el) s._el.classList.toggle("selected", selected.has(key));
        });
        updateAvailabilityAll(store.data, store.treeId);
        updateConnectorsActiveAll(store.data, store.treeId);
      });
      updateRemainingUI();
      if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
    } catch (e) { console.warn("Failed to restore auto progress", e); }
  }

  // wire character stats toggle (elements exist after DOM updates)
  statsToggle = document.getElementById('statsToggle');
  charStatsBox = document.getElementById('char-stats-box');
  if (statsToggle && charStatsBox) {
    statsToggle.addEventListener('click', () => {
      if (charStatsBox.style.display === 'block') {
        charStatsBox.style.display = 'none';
      } else {
        renderCharStats();
        charStatsBox.style.display = 'block';
      }
    });
  }
}

function renderCharStats() {
  // compute from base inputs + selected skills
  if (!charStatsBox) return;
  const name = document.getElementById('charName')?.value || '';
  // Determine base pool/cap from Armament Awakening selection (if present)
  let basePool = 0;
  let baseCap = 0;
  try {
    const armStore = (window.__treeDataStore || []).find(s => s.treeId === 'armament-tree');
    if (armStore) {
      const awaken = armStore.data.find(n => n.id === 'armament_awakening');
      if (awaken && awaken._awakening) {
        basePool = Number(awaken._awakening.pool || 0);
        baseCap = Number(awaken._awakening.cap || 0);
      }
    }
  } catch (e) {}

  const stats = computeCharStats(basePool, baseCap);

  charStatsBox.innerHTML = `
    <h3>Character Stats</h3>
    <div class="stat-row"><span class="stat-label">Name:</span> <span class="stat-value">${name}</span></div>
    <div class="stat-row"><span class="stat-label">Haki Pool:</span> <span class="stat-value" id="currentPool">${stats.pool}</span></div>
    <div class="stat-row"><span class="stat-label">Haki Cap:</span>
      <div class="cap-sub">
        <div>While attacking: <span id="capAttack">${stats.capAttack}</span></div>
        <div>While defending: <span id="capDefend">${stats.capDefend}</span></div>
        </div> <br>
    <div class="stat-row"><span class="stat-label">Haki Dice:</span>
      <div class="dice-sub">
        <div>While attacking: <span id="diceAttack">${stats.diceAttack}</span></div>
        <div>While defending: <span id="diceDefend">${stats.diceDefend}</span></div>
        </div> <br>
    <div class="stat-row"><span class="stat-label">Observation Focus Modifier:</span> <span class="stat-value" id="currentFocus">${stats.FocusMod}</span></div>
    <div class="stat-row"><span class="stat-label">Observation Range:</span> <span class="stat-value" id="currentRange">${stats.ObsRange}</span></div>
     </div>
    </div>
  `;
}

// Compute derived character stats from base inputs plus selected skills' effects
function computeCharStats(basePool = 0, baseCap = 0) {
  // helper to flatten all nodes
  const allNodes = (window.__treeDataStore || []).flatMap(s => s.data || []);

  let pool = Number(basePool || 0);
  let capAttack = Number(baseCap || 0);
  let capDefend = Number(baseCap || 0);
  let focusMod = 0;
  let obsRange = 0;

  // dice defaults — start at 0 (no dice selected yet)
  const dieRank = { d1: 1, d2: 2, d4: 4, d6: 6, d8: 8, d10: 10 };
  const rankToDie = v => {
    if (v === 0) return '-';
    for (const k of Object.keys(dieRank)) if (dieRank[k] === v) return k;
    return '-';
  };

  let bestAttack = 0;
  let bestDefend = 0;

  Array.from(selected).forEach(key => {
    const parts = key.split('::');
    const sid = parts[1];
    const node = allNodes.find(n => n.id === sid);
    if (!node) return;
    const effects = node.effects || [];
    effects.forEach(e => {
      if (!e || !e.type) return;
      const t = (e.type || '').toString().toLowerCase();
      // pool_choice: a selectable numeric increase stored on the node as _poolChoiceValue
      if (t === 'pool_choice') {
        const chosen = (node._poolChoiceValue != null) ? Number(node._poolChoiceValue) : Number(e.default || 5);
        pool += Number(chosen || 0);
        return;
      }
      if (t === 'pool') {
        pool += Number(e.delta || 0);
      } else if (t === 'cap') {
        capAttack += Number(e.delta || 0);
        capDefend += Number(e.delta || 0);
      } else if (t === 'cap_attack') {
        capAttack += Number(e.delta || 0);
      } else if (t === 'cap_defend') {
        capDefend += Number(e.delta || 0);
      } else if (t === 'dice') {
        
        // expected shape: { type: 'dice', slot: 'attack'|'defend'|'both', value: 'd4' }
        const slot = (e.slot || 'both').toString().toLowerCase();
        const val = (e.value || e.value === 0) ? e.value.toString() : '';
        const rank = dieRank[val] || (parseInt(val.replace(/[^0-9]/g, '')) || 1);
        if (slot === 'attack' || slot === 'both') bestAttack = Math.max(bestAttack, rank);
        if (slot === 'defend' || slot === 'both') bestDefend = Math.max(bestDefend, rank);
      } else if (t === 'dice_attack') {
        const val = (e.value || e.value === 0) ? e.value.toString() : '';
        const rank = dieRank[val] || (parseInt(val.replace(/[^0-9]/g, '')) || 1);
        bestAttack = Math.max(bestAttack, rank);
      } else if (t === 'dice_defend') {
        const val = (e.value || e.value === 0) ? e.value.toString() : '';
        const rank = dieRank[val] || (parseInt(val.replace(/[^0-9]/g, '')) || 1);
        bestDefend = Math.max(bestDefend, rank);
      } else if (t === 'focus_modifier') {
        focusMod += Number(e.delta || 0);
      } else if (t === 'observation_range') {
        obsRange += Number(e.delta || 0);
      }
    });
  });

  return {
    pool,
    capAttack,
    capDefend,
    diceAttack: rankToDie(bestAttack),
    diceDefend: rankToDie(bestDefend),
    FocusMod: focusMod,
    ObsRange: obsRange
  };
}

/* -----------------------------------------------------------
   LAYOUT & RENDER
----------------------------------------------------------- */
function computeDepths(data) {
  const byId = {};
  data.forEach(s => byId[s.id] = s);
  const memo = {};
  function depth(id, stack = new Set()) {
    if (memo[id] !== undefined) return memo[id];
    const s = byId[id];
    if (!s || !s.requires || s.requires.length === 0) return (memo[id] = 0);
    if (stack.has(id)) return 0;
    stack.add(id);
    const vals = s.requires.map(r => depth(r, new Set(stack)));
    return (memo[id] = 1 + Math.max(...vals));
  }
  data.forEach(s => depth(s.id));
  return memo;
}

function layoutAndRender(treeId, data, container, treeEl) {
  const depths = computeDepths(data);
  const groups = {};
  let maxDepth = 0;
  data.forEach(s => {
    const d = depths[s.id] || 0;
    if (!groups[d]) groups[d] = [];
    groups[d].push(s);
    if (d > maxDepth) maxDepth = d;
  });

  const W = 1200;
  const H = 700;
  const levelGap = 250
  const baseY = H - 200;
  const typeCols = { offense: 0.18, shared: 0.5, defense: 0.82 };

  // spacing constants used for grouping offsets (shared scope)
  const horizontalSpacing = 70; // enough to avoid overlap (node width 90)
  const verticalSpacing = 110;
  const baseOffset = 150;
  const tier2Extra = 500; // extra vertical lift for Tier 2 nodes to create larger separation
  const tier3Extra = 500; // extra vertical lift for Tier 3 nodes to match Tier 2 spacing
  const tier4Extra = 500; // extra vertical lift for Tier 4 nodes to match Tier 2 spacing
 
  // --- Grouping map: keys by sorted requires + normalized positionTag
  const siblingGroups = {};
  data.forEach(n => {
    const reqsKey = (n.requires || []).slice().sort().join('|');
    const tag = (n.positionTag || '').toLowerCase();
    const key = `${reqsKey}::${tag}`;
    if (!siblingGroups[key]) siblingGroups[key] = [];
    siblingGroups[key].push(n);
  });

  for (let depth = 0; depth <= maxDepth; depth++) {
    const nodes = groups[depth] || [];
    const byType = { offense: [], shared: [], defense: [] };
    nodes.forEach(n => {
      const t = (n.type === "offense" || n.type === "defense") ? n.type : "shared";
      byType[t].push(n);
    });

    for (const [typeKey, arr] of Object.entries(byType)) {
      if (arr.length === 0) continue;
      const cx = W * typeCols[typeKey];
      const groupW = Math.min(W * 0.5, 300 * arr.length);
      const spacing = groupW / (arr.length + 1);
      const startX = cx - groupW / 2;
      arr.forEach((node, i) => {
        let stackY = 0;
          // The original shared-column stacking applied a Y offset per index. That
          // causes diagonal placement for 'between' nodes when combined with our
          // grouping logic. Skip the automatic shared stack for 'between' nodes
          // so they are positioned strictly by the grouping rules.
          const maybeTag = (node.positionTag || '').toLowerCase();
          if (typeKey === "shared" && arr.length > 1 && maybeTag !== 'between') stackY = (i * 90);

      // Determine parents (support multiple parents). If any parents exist and have
      // positions, prefer parent-relative placement (so we place between parents
      // or above a single parent). Only fall back to column/tier layout when no
      // parent positions are available.
      const parents = (node.requires || [])
        .map(id => data.find(s => s.id === id))
        .filter(Boolean)
        .filter(p => p._pos);

      let x, y;
      if (parents.length > 0) {
        const tag = (node.positionTag || '').toLowerCase();
        const reqsKey = (node.requires || []).slice().sort().join('|');
        const groupKey = `${reqsKey}::${tag}`;
        const groupArr = siblingGroups[groupKey] || [];
        const groupIdx = groupArr.indexOf(node);

  if (tag === 'between' && parents.length > 1) {
          // Center between parent Xs and vertically center between their Ys so
          // the first 'between' node sits horizontally between the two parents.
          // Additional 'between' nodes will be stacked above by grouping pass.
          const avgX = parents.reduce((sum, p) => sum + (p._pos.x || 0), 0) / parents.length;
          const avgY = parents.reduce((sum, p) => sum + (p._pos.y || 0), 0) / parents.length;
          x = avgX;
          // If this node is Tier 2-4, lift it further from the parents' avg Y
          const selfTier = node.tier || node.Tier || 1;
          const tierExtra = selfTier === 2 ? tier2Extra : (selfTier === 3 ? tier3Extra : (selfTier === 4 ? tier4Extra : 0));
          y = Math.round(avgY - tierExtra);

          // vertical stacking will be applied later in grouping pass
        } else {
          // Single parent case (or fallback): position relative to the first parent
          const p = parents[0];
          // default: above parent
          x = p._pos.x;
          const selfTier = node.tier || node.Tier || 1;
          const tierExtra = selfTier === 2 ? tier2Extra : (selfTier === 3 ? tier3Extra : (selfTier === 4 ? tier4Extra : 0));
          const yAbove = p._pos.y - levelGap - tierExtra;
          y = yAbove;

          // Apply offsets for various position tags. Left/right place horizontally
          // from the parent (same Y), upleft/upright keep above parent, and
          // downleft/downright place below the parent.
          const tagLower = (node.positionTag || '').toLowerCase();
          const sideOffset = (groupIdx > 0 ? groupIdx * horizontalSpacing : 0);
          switch (tagLower) {
            case 'upleft':
              x = p._pos.x - baseOffset - sideOffset;
              y = yAbove;
              break;
            case 'up':
              // already above parent
              break;
            case 'left':
              x = p._pos.x - baseOffset - sideOffset;
              y = selfTier > 1 ? yAbove : p._pos.y; // same vertical level unless Tier 2-4
              break;
            case 'downleft':
              x = p._pos.x - baseOffset - sideOffset;
              y = selfTier > 1 ? yAbove : p._pos.y + levelGap; // below parent unless Tier 2-4
              break;
            case 'upright':
              x = p._pos.x + baseOffset + sideOffset;
              y = yAbove;
              break;
            case 'right':
              x = p._pos.x + baseOffset + sideOffset;
              y = selfTier > 1 ? yAbove : p._pos.y; // same vertical level unless Tier 2-4
              break;
            case 'downright':
              x = p._pos.x + baseOffset + sideOffset;
              y = selfTier > 1 ? yAbove : p._pos.y + levelGap; // below parent unless Tier 2-4
              break;
            default:
              // keep centered above parent
              break;
          }
        }
      } else {
        // If no parents with positions, fall back to column layout
        x = Math.round(startX + spacing * (i + 1));
        y = baseY;

        // If grouped by same requires + positionTag even without a parent, spread them
        const tag = (node.positionTag || '').toLowerCase();
        const reqsKey = (node.requires || []).slice().sort().join('|');
        const groupKey = `${reqsKey}::${tag}`;
        const groupArr = siblingGroups[groupKey] || [];
        const groupIdx = groupArr.indexOf(node);
        if (groupArr.length > 1 && groupIdx > 0) {
          if (tag === 'up' || tag === 'between') {
            // If this node itself is Tier 2-4, it should be lifted further from its
            // base position (and its grouping still stacks additional siblings).
            const selfTier = node.tier || node.Tier || 1;
            const extra = selfTier === 2 ? tier2Extra : (selfTier === 3 ? tier3Extra : (selfTier === 4 ? tier4Extra : 0));
            y -= groupIdx * verticalSpacing + extra;
          } else if (tag === 'upright' || tag === 'right') {
            x += groupIdx * horizontalSpacing;
          } else if (tag === 'upleft' || tag === 'left') {
            x -= groupIdx * horizontalSpacing;
          } else {
            // default spread horizontally
            x += (groupIdx * horizontalSpacing);
          }
        }
      }

      node._pos = { x, y };

      // --- Tier Anchoring adjustment (only apply when node has NO parents) ---
      if (!((node.requires || []).length > 0 && parents.length > 0)) {
        let tierBase = 0;
        if (node.tier) {
          // Base tier anchoring uses larger gap for Tier 2
          tierBase = (node.tier - 1) * 200;
          if (node.tier === 2 || node.Tier === 2) tierBase += tier2Extra;
        } else if (node.requires?.length) {
          // infer tier from requirements
          const parentTiers = node.requires
            .map(rid => {
              const parent = data.find(s => s.id === rid);
              return parent?.tier || 0;
            });
          tierBase = Math.max(...parenttiers) * 200;
        }

        y = Math.round(baseY - tierBase - depth * (levelGap / 2) + stackY);
        node._pos = { x, y };
      }

      // --- Apply grouping post-tier adjustments: vertical stacking for 'up' and 'between',
      // and horizontal offsets for left/right variants ---
      try {
        const tagPost = (node.positionTag || '').toLowerCase();
        const reqsKeyPost = (node.requires || []).slice().sort().join('|');
        const groupKeyPost = `${reqsKeyPost}::${tagPost}`;
        const groupArrPost = siblingGroups[groupKeyPost] || [];
        const idxPost = groupArrPost.indexOf(node);
        if (groupArrPost.length > 1 && idxPost > 0) {
          const hSpacing = horizontalSpacing;
          const vSpacing = verticalSpacing;
          if (tagPost === 'up' || tagPost === 'between') {
            node._pos.y -= idxPost * vSpacing;
          } else if (tagPost === 'upleft' || tagPost === 'left') {
            node._pos.x -= idxPost * hSpacing;
          } else if (tagPost === 'upright' || tagPost === 'right') {
            node._pos.x += idxPost * hSpacing;
          }
        }
      } catch (err) {
        // be defensive; grouping is optional
      }

      // --- Final positionOffset application after all positioning is done ---
      // Supports: `positionOffset` (Y), `positionOffsetY` (Y), and `positionOffsetX` (X)
      const offY = Number((node.positionOffsetY ?? node.positionOffset) || 0);
      const offX = Number(node.positionOffsetX || 0);
      if (offY !== 0) node._pos.y += offY;
      if (offX !== 0) node._pos.x += offX;

      });
    }
  }

  container.querySelectorAll(".skill, .connector").forEach(n => n.remove());
  data.forEach(skill => createSkillNode(skill, container, treeId));

  // connectors
  data.forEach(skill => {
    if (!skill.requires?.length) return;
    skill.requires.forEach(reqId => {
      const from = data.find(s => s.id === reqId);
      const to = skill;
      if (!from?._pos || !to?._pos) return;
      const dx = to._pos.x - from._pos.x;
      const dy = to._pos.y - from._pos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * 180 / Math.PI;
      const line = document.createElement("div");
      line.classList.add("connector");
      line.style.width = `${dist}px`;
      line.style.left = `${from._pos.x}px`;
      line.style.top = `${from._pos.y}px`;
      line.style.transform = `rotate(${angle}deg) translateY(-50%)`;
      container.appendChild(line);
      from._outs = from._outs || [];
      from._outs.push({ toId: to.id, el: line, treeId });
    });
  });

  // Render tier divider lines and labels (only for skills with explicit tier values)
  const tierBoundaries = {};
  data.forEach(skill => {
    // Only include skills that have an explicit tier field
    if (skill.tier === undefined || skill.tier === null) return;
    const t = skill.tier;
    if (!tierBoundaries[t]) tierBoundaries[t] = { minY: Infinity, maxY: -Infinity };
    tierBoundaries[t].minY = Math.min(tierBoundaries[t].minY, skill._pos.y);
    tierBoundaries[t].maxY = Math.max(tierBoundaries[t].maxY, skill._pos.y);
  });
  
  // Sort tiers and render dividers below each tier
  const tierNumbers = Object.keys(tierBoundaries).map(Number).sort((a, b) => a - b);
  tierNumbers.forEach((tier) => {
    const boundary = tierBoundaries[tier];
    // Position line 60px below the bottom-most skill of this tier (to account for node radius + padding)
    const lineY = boundary.maxY + 60;
    
    // Create divider line
    const dividerLine = document.createElement('div');
    dividerLine.classList.add('tier-divider');
    dividerLine.style.top = `${lineY}px`;
    container.appendChild(dividerLine);
    
    // Create tier label
    const tierLabel = document.createElement('div');
    tierLabel.classList.add('tier-label');
    tierLabel.textContent = `Tier ${tier}`;
    tierLabel.style.top = `${lineY - 18}px`;
    container.appendChild(tierLabel);
  });

  updateAvailabilityAll(data, treeId);
  updateConnectorsActiveAll(data, treeId);
  positionTreeTitle(treeEl, data, container);
}

function createSkillNode(skill, container, treeId) {
  const node = document.createElement("div");
  node.classList.add("skill", skill.type || "shared");
  node.textContent = skill.name;
  node.dataset.skillId = skill.id;
  node.dataset.treeId = treeId;
  node.style.left = `${skill._pos.x}px`;
  node.style.top = `${skill._pos.y}px`;

  node.addEventListener("click", e => handleSkillClick(e, skill, treeId));
  node.addEventListener("mouseenter", e => {
    hoverOverSkill = true;
    if (hideDescTimer) { clearTimeout(hideDescTimer); hideDescTimer = null; }
    showDesc(skill, e, treeId);
  });
  node.addEventListener("mouseleave", () => {
    hoverOverSkill = false;
    scheduleHideDesc();
  });

  skill._el = node;
  container.appendChild(node);
  return node;
}

/* -----------------------------------------------------------
   HOVER BOX
----------------------------------------------------------- */
// persistent box element (created on click) - only one at a time
let persistentBoxEl = null;
let persistentBoxKey = null;
// hover tracking so the desc box stays while pointer is over the skill or the box
let hoverOverSkill = false;
let hoverOverDesc = false;
let hideDescTimer = null;

function scheduleHideDesc() {
  if (hideDescTimer) clearTimeout(hideDescTimer);
  hideDescTimer = setTimeout(() => {
    if (!hoverOverSkill && !hoverOverDesc && !persistentBoxEl) {
      descBox.style.display = 'none';
    }
  }, 180);
}

function showDesc(skill, ev, treeId) {
  // ephemeral hover box: position to the right of the skill element
  const pinId = `desc-pin-${Date.now()}`;
  // Build a human-friendly "Requires" line using skill names and type tags
  let requiresDisplay = 'None';
  try {
    const reqs = Array.isArray(skill.requires) ? skill.requires : (skill.requires ? [skill.requires] : []);
    if (reqs.length > 0) {
      const store = (window.__treeDataStore || []).find(s => s.treeId === treeId) || {};
      const nodes = store.data || [];
      const reqNames = reqs.map(rid => {
        const node = nodes.find(n => n.id === rid) || {};
        const name = node.name || rid;
        return `${name}`;
      });
      const opRaw = (skill.requires_operator || skill.requiresOperator || '').toString().toLowerCase();
      let joiner = ', ';
      if (opRaw === 'or') joiner = ' or ';
      else if (opRaw === 'and') joiner = ' and ';
      requiresDisplay = reqNames.join(joiner);
    }
  } catch (e) { requiresDisplay = (skill.requires || []).join(', ') || 'None'; }

  descBox.innerHTML = `
    <button class="desc-pin" id="${pinId}" title="Pin">📌</button>
    <div class="desc-inner">
      <strong>${skill.name}</strong><br>
      Cost: ${skill.cost ?? 0}<br>
      Requires: ${requiresDisplay}<br><br>
      ${(skill.description || "").replace(/\n/g, "<br>")}
    </div>
  `;
  // Position the ephemeral hover box at the middle-left of the screen by default,
  // but if the skill is below center, align the bottom of the hover box with the
  // bottom edge of the skill so it feels attached to lower nodes.
  descBox.style.display = "block";
  // hint to the browser that we'll change transform/position for smoother updates
  try { descBox.style.willChange = 'transform, top, left'; } catch (e) {}
  try {
    const descRect = descBox.getBoundingClientRect();
    const descW = Math.min(descRect.width || 300, 520);
    const descH = descRect.height || 160;
    const gap = 8;
    if (skill && skill._el && skill._el.getBoundingClientRect) {
      const rect = skill._el.getBoundingClientRect();
      // prefer to place to the right of the skill if there's room
      let left = rect.right + gap;
      let top = rect.top; // align top edges by default
      // if right side would overflow, place to the left
      if (left + descW > window.innerWidth - 8) {
        left = rect.left - gap - descW;
      }
      // if still offscreen on left, clamp
      left = Math.max(8, Math.min(left, window.innerWidth - descW - 8));

      // vertical adjustments: if box would go below viewport, move it up so box bottom aligns with skill bottom
      if (top + descH > window.innerHeight - 8) {
        top = rect.bottom - descH;
      }
      // if box would go above viewport, clamp
      top = Math.max(8, Math.min(top, window.innerHeight - descH - 8));

      descBox.style.left = `${Math.round(left)}px`;
      descBox.style.top = `${Math.round(top)}px`;
    } else {
      // fallback: center-left
      const left = 12;
      const top = Math.max(8, Math.round(window.innerHeight / 2 - descH / 2));
      descBox.style.left = `${left}px`;
      descBox.style.top = `${top}px`;
    }
  } catch (e) {}
  // wire pin button to create a persistent box; stop event propagation
  try {
    const pin = document.getElementById(pinId);
    if (pin) {
      pin.addEventListener('click', ev => {
        ev.stopPropagation();
        // create persistent box for this skill
        createPersistentBox(skill, treeId);
      });
    }
  } catch (e) {}
  // keep the hover box visible if pointer moves from skill to the box
  // add these listeners only once to avoid duplication
  try {
    if (!descBox.dataset.hoverHandlers) {
      descBox.addEventListener('pointerenter', () => {
        hoverOverDesc = true;
        if (hideDescTimer) { clearTimeout(hideDescTimer); hideDescTimer = null; }
      });
      descBox.addEventListener('pointerleave', () => {
        hoverOverDesc = false;
        scheduleHideDesc();
      });
      descBox.dataset.hoverHandlers = '1';
    }
  } catch (e) {}
}

function createPersistentBox(skill, treeId) {
  // remove existing persistent box if any
  removePersistentBox();
  const box = document.createElement('div');
  box.className = 'persist-desc-box';
  // set border color based on skill type
  let requiresDisplay = 'None';
  try {
    const reqs = Array.isArray(skill.requires) ? skill.requires : (skill.requires ? [skill.requires] : []);
    if (reqs.length > 0) {
      const store = (window.__treeDataStore || []).find(s => s.treeId === treeId) || {};
      const nodes = store.data || [];
      const reqNames = reqs.map(rid => {
        const node = nodes.find(n => n.id === rid) || {};
        const name = node.name || rid;
        return `${name}`;
      });
      const opRaw = (skill.requires_operator || skill.requiresOperator || '').toString().toLowerCase();
      let joiner = ', ';
      if (opRaw === 'or') joiner = ' or ';
      else if (opRaw === 'and') joiner = ' and ';
      requiresDisplay = reqNames.join(joiner);
    }
  } catch (e) { requiresDisplay = (skill.requires || []).join(', ') || 'None'; }

  try {
    const t = (skill.type || 'shared').toLowerCase();
    let color = '#a00';
    if (t === 'offense') color = 'red';
    else if (t === 'defense') color = 'royalblue';
    else if (t === 'shared') color = 'purple';
    box.style.borderColor = color;
    box.style.background = 'rgba(0,0,0,0.98)'; // less transparent
  } catch (e) {}
  const closeId = `persist-close-${Date.now()}`;
  box.innerHTML = `
    <button class="persist-close" id="${closeId}" aria-label="Close">×</button>
    <div class="persist-content">
      <strong>${skill.name}</strong><br>
      Cost: ${skill.cost ?? 0}<br>
  Requires: ${requiresDisplay}<br><br>
     ${(skill.description || "").replace(/\n/g, "<br>")}
    </div>
  `;
  document.body.appendChild(box);
  // wire close
  const btn = document.getElementById(closeId);
  if (btn) btn.addEventListener('click', () => removePersistentBox());
  // make the persistent box draggable
  try {
    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;
    const onMove = (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let nx = origLeft + dx;
      let ny = origTop + dy;
      // clamp to viewport
      const bw = box.offsetWidth;
      const bh = box.offsetHeight;
      nx = Math.max(8, Math.min(nx, window.innerWidth - bw - 8));
      ny = Math.max(8, Math.min(ny, window.innerHeight - bh - 8));
      box.style.left = nx + 'px';
      box.style.top = ny + 'px';
    };
    const onUp = (ev) => {
      if (!dragging) return;
      dragging = false;
      try { box.releasePointerCapture(ev.pointerId); } catch (e) {}
      try { document.body.style.userSelect = ''; } catch (e) {}
      box.classList.remove('dragging');
    };
    box.addEventListener('pointerdown', ev => {
      // ignore clicks on the close button
      if (ev.target.closest('.persist-close')) return;
      ev.preventDefault();
      dragging = true;
      startX = ev.clientX;
      startY = ev.clientY;
      const rect = box.getBoundingClientRect();
      origLeft = rect.left;
      origTop = rect.top;
      try { box.setPointerCapture(ev.pointerId); } catch (e) {}
      try { document.body.style.userSelect = 'none'; } catch (e) {}
      box.classList.add('dragging');
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    // store cleanup so removePersistentBox can remove listeners
    box._dragCleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  } catch (e) {}
  persistentBoxEl = box;
  persistentBoxKey = `${treeId}::${skill.id}`;
}

function removePersistentBox() {
  if (persistentBoxEl) {
    try { persistentBoxEl.remove(); } catch (e) {}
    try { if (persistentBoxEl._dragCleanup) persistentBoxEl._dragCleanup(); } catch(e) {}
    persistentBoxEl = null;
    persistentBoxKey = null;
  }
}

/* -----------------------------------------------------------
   SKILL CLICK
----------------------------------------------------------- */
async function handleSkillClick(e, skill, treeId) {
  e.stopPropagation();
  const key = `${treeId}::${skill.id}`;
  const el = skill._el;
  const cost = Number(skill.cost || 0);
  const remaining = totalPoints - getSpent();

  if (selected.has(key)) {
    // can't deselect if children depend on it — but allow deselection when
    // the dependent uses an OR operator and another required parent is still selected
    const store = window.__treeDataStore.find(s => s.treeId === treeId);
    const dependents = store.data.filter(s => s.requires?.includes(skill.id));
    for (const d of dependents) {
      const depKey = `${treeId}::${d.id}`;
      if (!selected.has(depKey)) continue; // only care about selected dependents
      const opRaw = (d.requires_operator || d.requiresOperator || '').toString().toLowerCase();
      const reqs = Array.isArray(d.requires) ? d.requires : (d.requires ? [d.requires] : []);
      if (opRaw === 'or') {
        // if any other required parent is still selected, it's safe to deselect this parent
        const otherSelected = reqs
          .filter(rid => rid !== skill.id)
          .some(rid => selected.has(`${treeId}::${rid}`));
        if (otherSelected) continue; // safe for this dependent
        // otherwise, this is the last selected required parent -> block
        showAlert("You must deselect dependent skills first.");
        return;
      } else {
        // AND or unspecified behavior: block deselecting while dependent is selected
        showAlert("You must deselect dependent skills first.");
        return;
      }
    }

    selected.delete(key);
    el.classList.remove("selected");
    descBox.style.display = "none";
    // if a persistent box exists for this skill, remove it
    if (persistentBoxKey === key) removePersistentBox();
    // clear awakening values if this was the armament awakening
    try { if ((skill.id || '') === 'armament_awakening') { skill._awakening = null; } } catch (e) {}
  } else {
    const reqs = skill.requires || [];
    if (reqs.length) {
      const opRaw = (skill.requires_operator || skill.requiresOperator || '').toString().toLowerCase();
      if (opRaw === 'or') {
        if (!reqs.some(rid => selected.has(`${treeId}::${rid}`))) {
          showAlert("This skill requires one of its prerequisites to be selected.");
          return;
        }
      } else if (opRaw === 'and') {
        if (!reqs.every(rid => selected.has(`${treeId}::${rid}`))) {
          showAlert("Missing required skills.");
          return;
        }
      } else {
        // fallback: preserve previous behavior (shared-type acts like OR, others like AND)
        if ((skill.type || 'shared') === 'shared') {
          if (!reqs.some(rid => selected.has(`${treeId}::${rid}`))) {
            showAlert("This skill requires one of its prerequisites to be selected.");
            return;
          }
        } else {
          if (!reqs.every(rid => selected.has(`${treeId}::${rid}`))) {
            showAlert("Missing required skills.");
            return;
          }
        }
      }
    }
    if (remaining < cost) {
      showAlert("Not enough Haki points.");
      return;
    }
    selected.add(key);
    el.classList.add("selected");
    // still show ephemeral hover box to the right
    showDesc(skill, null, treeId);
    // If this skill has a pool_choice effect, prompt the user for the chosen value
    try {
      const effects = skill.effects || [];
      const hasChoice = effects.some(x => (x.type || '').toString().toLowerCase() === 'pool_choice');
      if (hasChoice) {
        const chosen = await promptPoolChoice(skill);
        // If user cancelled (null), deselect the skill
        if (chosen == null) {
          selected.delete(key);
          el.classList.remove('selected');
          // refresh availability/connectors
          const store = window.__treeDataStore.find(s => s.treeId === treeId);
          if (store) {
            updateAvailabilityAll(store.data, treeId);
            updateConnectorsActiveAll(store.data, treeId);
          }
          updateRemainingUI();
          if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
          return;
        }
        // store chosen value on the skill for computeCharStats
        skill._poolChoiceValue = Number(chosen || 0);
      }
        // If this is Armament Awakening, prompt for initial pool/cap
        if ((skill.id || '') === 'armament_awakening') {
          const awak = await promptAwakeningChoice(skill);
          if (awak == null) {
            // user cancelled -> deselect
            selected.delete(key);
            el.classList.remove('selected');
            const store = window.__treeDataStore.find(s => s.treeId === treeId);
            if (store) {
              updateAvailabilityAll(store.data, treeId);
              updateConnectorsActiveAll(store.data, treeId);
            }
            updateRemainingUI();
            if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
            return;
          }
          // store on the node for persistence and stat computation
          skill._awakening = { pool: Number(awak.pool || 0), cap: Number(awak.cap || 0) };
        }
    } catch (err) {
      console.warn('pool choice handling failed', err);
    }
  }

  const store = window.__treeDataStore.find(s => s.treeId === treeId);
  if (store) {
    updateAvailabilityAll(store.data, treeId);
    updateConnectorsActiveAll(store.data, treeId);
  }
  updateRemainingUI();
  // Update character stats display whenever selection changes
  if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
  // --- Persist current progress to localStorage on every change ---
  persistCurrentProgress();
}

/* -----------------------------------------------------------
   AVAILABILITY & CONNECTORS
----------------------------------------------------------- */
function updateAvailabilityAll(data, treeId) {
  const selSet = new Set(
    Array.from(selected)
      .filter(k => k.startsWith(`${treeId}::`))
      .map(k => k.split("::")[1])
  );
  for (const s of data) {
    if (!s._el) continue;
    s._el.classList.remove("available");
    if (s._el.classList.contains("selected")) continue;
    const reqs = s.requires || [];
    if (reqs.length === 0) {
      s._el.classList.add("available");
    } else {
      const opRaw = (s.requires_operator || s.requiresOperator || '').toString().toLowerCase();
      if (opRaw === 'or') {
        if (reqs.some(rid => selSet.has(rid))) s._el.classList.add('available');
      } else if (opRaw === 'and') {
        if (reqs.every(rid => selSet.has(rid))) s._el.classList.add('available');
      } else {
        // fallback: shared acts like OR, others act like AND
        if ((s.type || 'shared') === 'shared') {
          if (reqs.some(rid => selSet.has(rid))) s._el.classList.add('available');
        } else {
          if (reqs.every(rid => selSet.has(rid))) s._el.classList.add('available');
        }
      }
    }
  }

  // Also update connector visuals: connectors that lead to an available node
  try {
    data.forEach(from => {
      if (!from._outs) return;
      from._outs.forEach(o => {
        try {
          const target = data.find(n => n.id === o.toId);
          const isAvailable = !!(target && target._el && target._el.classList.contains('available'));
          o.el.classList.toggle('available', isAvailable);
        } catch (e) {
          // defensive: ignore connector update errors
        }
      });
    });
  } catch (e) {
    // defensive: ignore
  }
}

function updateConnectorsActiveAll(data, treeId) {
  data.forEach(s => {
    if (!s._outs) return;
    s._outs.forEach(o => {
      const fromSel = selected.has(`${treeId}::${s.id}`);
      const toSel = selected.has(`${treeId}::${o.toId}`);
      o.el.classList.toggle("active", fromSel && toSel);
    });
  });
}

/* -----------------------------------------------------------
   TITLES, REMAINING, SAVE/LOAD
----------------------------------------------------------- */
function positionTreeTitle(treeEl, data) {
  const heading = treeEl.querySelector("h2");
  if (!heading) return;
  let bottomNode = null;
  data.forEach(s => {
    if (!bottomNode || s._pos.y > bottomNode._pos.y) bottomNode = s;
  });
  if (bottomNode) heading.style.left = `${bottomNode._pos.x}px`;
}

function getSpent() {
  let sum = 0;
  window.__treeDataStore.forEach(store =>
    store.data.forEach(s => {
      if (selected.has(`${store.treeId}::${s.id}`)) sum += Number(s.cost || 0);
    })
  );
  return sum;
}
function updateRemainingUI() {
  totalPoints = Number(totalInput?.value || 10);
  const remaining = totalPoints - getSpent();
  remainingDisplay.textContent = remaining < 0 ? 0 : remaining;
}

function saveProgress() {
  // Persist current selection and awakening/pool choices to localStorage for reload (not Save)
  function persistCurrentProgress() {
    const save = {
      selected: Array.from(selected),
      totalPoints,
      charName: document.getElementById("charName")?.value || ""
    };
    // include any pool choice selections per node
    const poolChoices = {};
    window.__treeDataStore.forEach(store => store.data.forEach(s => {
      if (s._poolChoiceValue != null) poolChoices[s.id] = s._poolChoiceValue;
    }));
    // include awakening values (initial pool/cap) if set
    const awakeningValues = {};
    window.__treeDataStore.forEach(store => store.data.forEach(s => {
      if (s._awakening) awakeningValues[s.id] = s._awakening;
    }));
    save.poolChoices = poolChoices;
    save.awakeningValues = awakeningValues;
    localStorage.setItem("hakiTreeAuto_v2", JSON.stringify(save));
  }
    // On page load, restore auto-saved progress if present
    const autoRaw = localStorage.getItem("hakiTreeAuto_v2");
    if (autoRaw) {
      try {
        const data = JSON.parse(autoRaw);
        selected = new Set(data.selected || []);
        if (data.totalPoints && totalInput) totalInput.value = data.totalPoints;
        if (data.charName) document.getElementById("charName").value = data.charName;
        const poolChoices = data.poolChoices || {};
        const awakeningValues = data.awakeningValues || {};
        window.__treeDataStore.forEach(store => {
          store.data.forEach(s => {
            const key = `${store.treeId}::${s.id}`;
            if (poolChoices[s.id] != null) s._poolChoiceValue = poolChoices[s.id];
            if (awakeningValues[s.id]) s._awakening = awakeningValues[s.id];
            if (s._el) s._el.classList.toggle("selected", selected.has(key));
          });
          updateAvailabilityAll(store.data, store.treeId);
          updateConnectorsActiveAll(store.data, store.treeId);
        });
        updateRemainingUI();
        if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
      } catch (e) { console.warn("Failed to restore auto progress", e); }
    }
  const save = {
    selected: Array.from(selected),
    totalPoints,
    charName: document.getElementById("charName")?.value || ""
  };
  // include any pool choice selections per node
  const poolChoices = {};
  window.__treeDataStore.forEach(store => store.data.forEach(s => {
    if (s._poolChoiceValue != null) poolChoices[s.id] = s._poolChoiceValue;
  }));
  // include awakening values (initial pool/cap) if set
  const awakeningValues = {};
  window.__treeDataStore.forEach(store => store.data.forEach(s => {
    if (s._awakening) awakeningValues[s.id] = s._awakening;
  }));
  save.poolChoices = poolChoices;
  save.awakeningValues = awakeningValues;
  localStorage.setItem("hakiTreeSave_v2", JSON.stringify(save));
  showAlert("Save complete.");
}

function loadProgress() {
  const raw = localStorage.getItem("hakiTreeSave_v2");
  if (!raw) return showAlert("No save found.");
  const data = JSON.parse(raw);
  selected = new Set(data.selected || []);
  if (data.totalPoints && totalInput) totalInput.value = data.totalPoints;
  if (data.charName) document.getElementById("charName").value = data.charName;
  const poolChoices = data.poolChoices || {};
  const awakeningValues = data.awakeningValues || {};

  window.__treeDataStore.forEach(store => {
    store.data.forEach(s => {
      const key = `${store.treeId}::${s.id}`;
      // restore pool choice values if present
      if (poolChoices[s.id] != null) s._poolChoiceValue = poolChoices[s.id];
          // restore awakening values if present
          if (awakeningValues[s.id]) s._awakening = awakeningValues[s.id];
      s._el.classList.toggle("selected", selected.has(key));
    });
    updateAvailabilityAll(store.data, store.treeId);
    updateConnectorsActiveAll(store.data, store.treeId);
  });
  updateRemainingUI();
  if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
  showAlert("Loaded save.");
}

async function resetAllSkills() {
  const ok = await showConfirm("Are you sure you want to reset all selected skills?");
  if (!ok) return;
  selected.clear();
  window.__treeDataStore.forEach(store => {
    store.data.forEach(s => {
      if (s._el) s._el.classList.remove("selected");
      s._poolChoiceValue = null;
      // clear awakening values too
      if (s.id === 'armament_awakening') s._awakening = null;
    });
    updateAvailabilityAll(store.data, store.treeId);
    updateConnectorsActiveAll(store.data, store.treeId);
  });
  // Clear character name field
  const nameInput = document.getElementById("charName");
  if (nameInput) nameInput.value = "";
  updateRemainingUI();
  if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
  showAlert("All skills and character name reset.");
}

function randomizeSkills(mode = 'all') {
  // mode: 'all', 'arm-offense', 'arm-defense', 'obs-offense', 'obs-defense'
  let filteredNodes = (window.__treeDataStore || []).flatMap(s => s.data || []);
  
  // Filter by tree and type based on mode
  if (mode !== 'all') {
    const parts = mode.split('-');
    const treePrefix = parts[0]; // 'arm' or 'obs'
    const roleType = parts[1]; // 'offense' or 'defense'
    
    const treeMap = { 'arm': 'armament-tree', 'obs': 'observation-tree' };
    const targetTreeId = treeMap[treePrefix];
    
    filteredNodes = filteredNodes.filter(skill => {
      // Find the tree this skill belongs to
      const store = window.__treeDataStore.find(s => s.data.find(n => n.id === skill.id));
      if (!store) return false;
      
      // Must be from target tree
      if (store.treeId !== targetTreeId) return false;
      
      // Must match the role type (offense, defense) or be shared
      const skillType = (skill.type || 'shared').toLowerCase();
      return skillType === roleType || skillType === 'shared';
    });
  }
  
  let remaining = totalPoints - getSpent();
  
  if (remaining <= 0) {
    showAlert("No Haki Points remaining!");
    return;
  }
  
  // Get all available skills from filtered nodes
  const availableSkills = filteredNodes.filter(skill => {
    const key = `${skill.type}::${skill.id}`;
    if (selected.has(key)) return false; // already selected
    
    const cost = Number(skill.cost || 0);
    if (cost > remaining) return false; // too expensive
    
    // Check if requirements are met
    const reqs = skill.requires || [];
    if (reqs.length === 0) return true;
    
    const opRaw = (skill.requires_operator || '').toString().toLowerCase();
    if (opRaw === 'or') {
      return reqs.some(rid => {
        const store = window.__treeDataStore.find(s => s.data.find(n => n.id === rid));
        return store && selected.has(`${store.treeId}::${rid}`);
      });
    } else {
      return reqs.every(rid => {
        const store = window.__treeDataStore.find(s => s.data.find(n => n.id === rid));
        return store && selected.has(`${store.treeId}::${rid}`);
      });
    }
  });
  
  if (availableSkills.length === 0) {
    showAlert("No available skills can be selected with remaining points!");
    return;
  }
  
  // Randomly select skills until we can't afford more
  while (availableSkills.length > 0 && remaining > 0) {
    const randomIndex = Math.floor(Math.random() * availableSkills.length);
    const skill = availableSkills[randomIndex];
    const cost = Number(skill.cost || 0);
    
    if (cost > remaining) {
      availableSkills.splice(randomIndex, 1);
      continue;
    }
    
    // Find the tree this skill belongs to
    const store = window.__treeDataStore.find(s => s.data.find(n => n.id === skill.id));
    if (!store) {
      availableSkills.splice(randomIndex, 1);
      continue;
    }
    
    const key = `${store.treeId}::${skill.id}`;
    selected.add(key);
    if (skill._el) skill._el.classList.add("selected");
    remaining -= cost;
    
    // Update availability for all stores
    window.__treeDataStore.forEach(s => {
      updateAvailabilityAll(s.data, s.treeId);
      updateConnectorsActiveAll(s.data, s.treeId);
    });
    
    // Re-check available skills (filtered)
    availableSkills.length = 0;
    filteredNodes.forEach(s => {
      const sk = `${s.type}::${s.id}`;
      if (selected.has(sk)) return;
      const scost = Number(s.cost || 0);
      if (scost > remaining) return;
      
      const sreqs = s.requires || [];
      if (sreqs.length === 0) {
        availableSkills.push(s);
        return;
      }
      
      const sopRaw = (s.requires_operator || '').toString().toLowerCase();
      if (sopRaw === 'or') {
        if (sreqs.some(rid => {
          const sstore = window.__treeDataStore.find(ss => ss.data.find(n => n.id === rid));
          return sstore && selected.has(`${sstore.treeId}::${rid}`);
        })) availableSkills.push(s);
      } else {
        if (sreqs.every(rid => {
          const sstore = window.__treeDataStore.find(ss => ss.data.find(n => n.id === rid));
          return sstore && selected.has(`${sstore.treeId}::${rid}`);
        })) availableSkills.push(s);
      }
    });
  }
  
  updateRemainingUI();
  if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
  showAlert(`Randomly selected skills! ${remaining} points remaining.`);
}

function exportCharacter() {
  const charName = document.getElementById("charName")?.value || "character";
  // derive initial pool/cap from armament awakening if present
  let basePool = 0, baseCap = 0;
  try {
    const armStore = (window.__treeDataStore || []).find(s => s.treeId === 'armament-tree');
    if (armStore) {
      const awaken = armStore.data.find(n => n.id === 'armament_awakening');
      if (awaken && awaken._awakening) {
        basePool = Number(awaken._awakening.pool || 0);
        baseCap = Number(awaken._awakening.cap || 0);
      }
    }
  } catch (e) {}
  const stats = computeCharStats(basePool, baseCap);
  
  const poolChoices = {};
  window.__treeDataStore.forEach(store => store.data.forEach(s => {
    if (s._poolChoiceValue != null) poolChoices[s.id] = s._poolChoiceValue;
  }));
  
  const exportData = {
    charName,
    initialPool: basePool,
    initialCap: baseCap,
    totalPoints,
    selected: Array.from(selected),
    poolChoices,
    stats
  };
  
  const jsonStr = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${charName.replace(/\s+/g, "_")}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showAlert("Character exported successfully.");
}

function importCharacter(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result);
      
      // Load character data
      if (data.charName) document.getElementById("charName").value = data.charName;
      // restore awakening initial pool/cap into the armament awakening node if present
      try {
        if (data.initialPool != null || data.initialCap != null) {
          const armStore = (window.__treeDataStore || []).find(s => s.treeId === 'armament-tree');
          if (armStore) {
            const awaken = armStore.data.find(n => n.id === 'armament_awakening');
            if (awaken) {
              awaken._awakening = { pool: Number(data.initialPool || 0), cap: Number(data.initialCap || 0) };
            }
          }
        }
      } catch (e) {}
      if (data.totalPoints != null) totalInput.value = data.totalPoints;
      
      // Load selected skills
      selected = new Set(data.selected || []);
      const poolChoices = data.poolChoices || {};
      
      window.__treeDataStore.forEach(store => {
        store.data.forEach(s => {
          const key = `${store.treeId}::${s.id}`;
          if (poolChoices[s.id] != null) s._poolChoiceValue = poolChoices[s.id];
          if (s._el) s._el.classList.toggle("selected", selected.has(key));
        });
        updateAvailabilityAll(store.data, store.treeId);
        updateConnectorsActiveAll(store.data, store.treeId);
      });
      
      updateRemainingUI();
      if (charStatsBox && charStatsBox.style.display === 'block') renderCharStats();
      showAlert("Character imported successfully.");
    } catch (err) {
      showAlert(`Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
  // reset file input so same file can be selected again
  ev.target.value = "";
}

// Show pool chooser modal and return chosen number or null if cancelled
function promptPoolChoice(skill) {
  return new Promise((resolve) => {
    try {
      const modal = document.getElementById('pool-chooser');
      const input = document.getElementById('pool-chooser-value');
      const title = document.getElementById('pool-chooser-title');
      const ok = document.getElementById('pool-chooser-ok');
      const cancel = document.getElementById('pool-chooser-cancel');
      const close = document.getElementById('pool-chooser-close');
      if (!modal || !input || !ok) return resolve(null);
      // set defaults
      const eff = (skill.effects || []).find(e => (e.type || '').toString().toLowerCase() === 'pool_choice');
      const def = eff && (eff.default != null) ? Number(eff.default) : 5;
      input.value = (skill._poolChoiceValue != null) ? skill._poolChoiceValue : def;
  // keep a simple static title set in the DOM
  title.textContent = `Haki Pool Increase`;
      modal.style.display = 'flex';

      const cleanup = () => {
        modal.style.display = 'none';
        ok.onclick = null; cancel.onclick = null; close.onclick = null;
      };

      ok.onclick = () => {
        const val = Number(input.value || 0);
        cleanup();
        resolve(val);
      };
      const doCancel = () => { cleanup(); resolve(null); };
      cancel.onclick = doCancel;
      close.onclick = doCancel;
    } catch (e) { resolve(null); }
  });
}

// Prompt for Armament Awakening initial pool/cap
function promptAwakeningChoice(skill) {
  return new Promise((resolve) => {
    try {
      const modal = document.getElementById('awakening-modal');
      const inputPool = document.getElementById('awakening-pool');
      const inputCap = document.getElementById('awakening-cap');
      const ok = document.getElementById('awakening-ok');
      const cancel = document.getElementById('awakening-cancel');
      const close = document.getElementById('awakening-close');
      if (!modal || !inputPool || !inputCap || !ok) return resolve(null);
      // set defaults from any previously stored values on the node
      // default to 5 pool / 2 cap if not previously set (faster workflow)
      inputPool.value = (skill._awakening && skill._awakening.pool != null) ? skill._awakening.pool : 5;
      inputCap.value = (skill._awakening && skill._awakening.cap != null) ? skill._awakening.cap : 2;
      modal.style.display = 'flex';

      const cleanup = () => {
        modal.style.display = 'none';
        ok.onclick = null; cancel.onclick = null; close.onclick = null;
      };

      ok.onclick = () => {
        const pool = Number(inputPool.value || 0);
        const cap = Number(inputCap.value || 0);
        cleanup();
        resolve({ pool, cap });
      };
      const doCancel = () => { cleanup(); resolve(null); };
      cancel.onclick = doCancel;
      close.onclick = doCancel;
    } catch (e) { resolve(null); }
  });
}

// Custom alert modal
function showAlert(msg) {
  const modal = document.getElementById('app-alert');
  const content = document.getElementById('app-alert-content');
  const ok = document.getElementById('app-alert-ok');
  if (!modal || !content || !ok) {
    try { alert(msg); } catch(e) {}
    return;
  }
  content.textContent = msg;
  modal.style.display = 'flex';
  ok.focus();
  ok.onclick = () => closeAlert();
  // wire the extra 'Fuck you' and top-close buttons
  const fu = document.getElementById('app-alert-fuck');
  if (fu) fu.onclick = () => closeAlert();
  const topc = document.getElementById('app-alert-close');
  if (topc) topc.onclick = () => closeAlert();
  // keyboard closing: Esc or Enter
  const keyHandler = (ev) => {
    if (ev.key === 'Escape' || ev.key === 'Enter') {
      closeAlert();
    }
  };
  modal._keyHandler = keyHandler;
  window.addEventListener('keydown', keyHandler);
}

// Custom confirm modal that matches the app-alert style. Returns a Promise<boolean>
function showConfirm(msg) {
  return new Promise((resolve) => {
    const modal = document.getElementById('app-alert');
    const content = document.getElementById('app-alert-content');
    const ok = document.getElementById('app-alert-ok');
    const fu = document.getElementById('app-alert-fuck');
    const topc = document.getElementById('app-alert-close');
    if (!modal || !content || !ok || !fu) {
      try { resolve(confirm(msg)); } catch (e) { resolve(false); }
      return;
    }

    // Save old labels so we can restore them
    const oldOkText = ok.textContent;
    const oldFuText = fu.textContent;

    content.textContent = msg;
    ok.textContent = 'Yes';
    fu.textContent = 'No';
    modal.style.display = 'flex';
    ok.focus();

    const cleanup = (val) => {
      modal.style.display = 'none';
      ok.textContent = oldOkText;
      fu.textContent = oldFuText;
      try { window.removeEventListener('keydown', keyHandler); } catch (e) {}
      ok.onclick = null; fu.onclick = null; if (topc) topc.onclick = null;
      resolve(Boolean(val));
    };

    const keyHandler = (ev) => {
      if (ev.key === 'Escape') cleanup(false);
      if (ev.key === 'Enter') cleanup(true);
    };

    ok.onclick = () => cleanup(true);
    fu.onclick = () => cleanup(false);
    if (topc) topc.onclick = () => cleanup(false);
    window.addEventListener('keydown', keyHandler);
  });
}

function closeAlert() {
  const modal = document.getElementById('app-alert');
  if (modal) modal.style.display = 'none';
  // remove keyboard handler if set
  try {
    if (modal && modal._keyHandler) window.removeEventListener('keydown', modal._keyHandler);
  } catch (e) {}
}

/* -----------------------------------------------------------
   GLOBAL INTERACTIONS & PAN/ZOOM
----------------------------------------------------------- */
function setupGlobalInteractions() {
  saveBtn.addEventListener("click", saveProgress);
  loadBtn.addEventListener("click", loadProgress);
  totalInput.addEventListener("input", updateRemainingUI);
  
  // Wire dropdown toggle and mode selection
  const randomBtn = document.getElementById("randomBtn");
  const randomMenu = document.getElementById("randomMenu");
  
  if (randomBtn && randomMenu) {
    // Toggle menu on button click — position with fixed placement to avoid stacking/transform issues
    randomBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      // If already visible, hide it
      if (randomMenu._visible) {
        randomMenu.style.display = 'none';
        randomMenu._visible = false;
        return;
      }

      // Show menu temporarily hidden to measure
      randomMenu.style.position = 'fixed';
      randomMenu.style.display = 'block';
      randomMenu.style.visibility = 'hidden';
      randomMenu.style.left = '0px';
      randomMenu.style.top = '0px';

      // Measure button and menu sizes
      const btnRect = randomBtn.getBoundingClientRect();
      const menuRect = randomMenu.getBoundingClientRect();

      // Calculate drop-up position: place menu above the button, aligned left
      const left = Math.max(6, btnRect.left);
      const top = btnRect.top - menuRect.height - 80; // large gap to move up significantly

      // If there's not enough space above, push menu to top with safe margin
      const finalTop = (top < 50) ? 50 : top;
      // Clamp to viewport height to ensure menu doesn't go off-screen
      const clampedTop = Math.min(finalTop, window.innerHeight - menuRect.height - 50);

      randomMenu.style.left = `${left}px`;
      randomMenu.style.top = `${clampedTop}px`;
      randomMenu.style.visibility = 'visible';
      randomMenu._visible = true;
    });
    
    // Handle mode selection
    document.querySelectorAll('.random-option').forEach(option => {
      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = option.dataset.mode || 'all';
        randomizeSkills(mode);
        randomMenu.style.display = 'none'; // close menu
      });
    });
    
    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.random-dropdown')) {
        randomMenu.style.display = 'none';
      }
    });
  }
  
  const resetBtn = document.getElementById("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", resetAllSkills);
  
  const exportBtn = document.getElementById("exportBtn");
  if (exportBtn) exportBtn.addEventListener("click", exportCharacter);
  
  const importBtn = document.getElementById("importBtn");
  if (importBtn) importBtn.addEventListener("click", () => {
    const fileInput = document.getElementById("fileImport");
    if (fileInput) fileInput.click();
  });
  
  const fileImport = document.getElementById("fileImport");
  if (fileImport) fileImport.addEventListener("change", importCharacter);

  // Credits button (floating) wiring
  const creditsBtn = document.getElementById('creditsBtn');
  if (creditsBtn) creditsBtn.addEventListener('click', () => {
    // toggle credits animation
    if (window.__creditsRunning) stopCredits(); else startCredits();
  });

  // tree toggle buttons (collapse/expand)
  document.querySelectorAll('.tree-toggle').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.tree;
      if (!id) return;
      toggleTree(id);
    });
  });
  
  document.addEventListener("click", ev => {
    if (ev.target.closest(".skill")) return;
    descBox.style.display = "none";
    // clicking outside should close ephemeral hover, but not persistent boxes
  });

  // pool chooser keyboard support (Escape to cancel)
  window.addEventListener('keydown', ev => {
    const modal = document.getElementById('pool-chooser');
    if (!modal || modal.style.display !== 'flex') return;
    if (ev.key === 'Escape') {
      const close = document.getElementById('pool-chooser-close');
      if (close && close.onclick) close.onclick();
    }
  });
}

function attachGlobalPanZoom(viewport) {
  // Move view much lower and to the right: increase ty (down), increase tx (right)
  const state = { tx: 100, ty: 400, scale: 0.6, dragging: false, lastX: 0, lastY: 0 };

  function apply() {
    viewport.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  }
  // Apply initial transform immediately so the zoomed-out view is set on page load
  apply();
  // --- Zoom Button Support ---
  const zoomInBtn = document.getElementById("zoomInBtn");
  const zoomOutBtn = document.getElementById("zoomOutBtn");
  const zoomSlider = document.getElementById('zoom-slider');
  const zoomThumb = document.getElementById('zoom-thumb');
  const sliderHeight = zoomSlider ? zoomSlider.clientHeight : 100;
  if (zoomInBtn && zoomOutBtn) {
    zoomInBtn.addEventListener("click", () => {
      state.scale = clamp(state.scale * 1.15, 0.3, 3.5);
      apply();
        syncThumb();
    });
    zoomOutBtn.addEventListener("click", () => {
      state.scale = clamp(state.scale * 0.85, 0.3, 3.5);
      apply();
        syncThumb();
    });
  }

  wrapper.addEventListener("wheel", ev => {
    ev.preventDefault();
    const delta = -ev.deltaY;
    const zoomFactor = delta > 0 ? 1.08 : 0.92;
    const newScale = clamp(state.scale * zoomFactor, 0.3, 3.5);
    const rect = wrapper.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const oldScale = state.scale;
    state.tx = cx - ((cx - state.tx) * newScale / oldScale);
    state.ty = cy - ((cy - state.ty) * newScale / oldScale);
    state.scale = newScale;
    apply();
    syncThumb();
  }, { passive: false });

  // Slider sync helpers
  function scaleToThumb(scale) {
    // map scale range [0.3,3.5] to slider Y (0..height)
    const minS = 0.3, maxS = 3.5;
    const pct = (scale - minS) / (maxS - minS);
    return Math.round((1 - pct) * (zoomSlider.clientHeight || sliderHeight));
  }
  function thumbToScale(y) {
    const minS = 0.3, maxS = 3.5;
    const h = zoomSlider.clientHeight || sliderHeight;
    const pct = 1 - clamp(y / h, 0, 1);
    return minS + pct * (maxS - minS);
  }
  function syncThumb() {
    if (!zoomSlider || !zoomThumb) return;
    const y = scaleToThumb(state.scale);
    zoomThumb.style.top = `${y}px`;
  }

  // Thumb dragging
  let draggingThumb = false;
  let thumbOffsetY = 0;
  if (zoomThumb) {
    zoomThumb.addEventListener('pointerdown', ev => {
      ev.stopPropagation();
      draggingThumb = true;
      zoomThumb.setPointerCapture(ev.pointerId);
      thumbOffsetY = ev.clientY - zoomThumb.getBoundingClientRect().top;
      try { document.body.style.userSelect = 'none'; } catch (e) {}
    });
    window.addEventListener('pointermove', ev => {
      if (!draggingThumb || !zoomSlider) return;
      const rect = zoomSlider.getBoundingClientRect();
      const y = ev.clientY - rect.top - thumbOffsetY + (zoomThumb.clientHeight/2 || 9);
      const clamped = clamp(y, 0, rect.height);
      zoomThumb.style.top = `${clamped}px`;
      state.scale = thumbToScale(clamped);
      apply();
    });
    window.addEventListener('pointerup', ev => {
      if (!draggingThumb) return;
      draggingThumb = false;
      try { zoomThumb.releasePointerCapture(ev.pointerId); } catch (e) {}
      try { document.body.style.userSelect = ''; } catch (e) {}
      syncThumb();
    });
  }

  // initialize thumb position
  setTimeout(syncThumb, 0);

  wrapper.addEventListener("pointerdown", ev => {
    if (ev.button !== 0 || ev.target.closest(".skill")) return;
    state.dragging = true;
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
    wrapper.setPointerCapture(ev.pointerId);
    // Prevent the browser from selecting text while dragging
    try { document.body.style.userSelect = 'none'; } catch (e) {}
    // show grabbing cursor while dragging
    try { document.body.style.cursor = 'grabbing'; } catch (e) {}
  });
  wrapper.addEventListener("pointermove", ev => {
    if (!state.dragging) return;
    const dx = ev.clientX - state.lastX;
    const dy = ev.clientY - state.lastY;
    state.lastX = ev.clientX;
    state.lastY = ev.clientY;
    state.tx += dx;
    state.ty += dy;
    apply();
  });
  wrapper.addEventListener("pointerup", ev => {
    state.dragging = false;
    wrapper.releasePointerCapture(ev.pointerId);
    // restore text selection and cursor
    try { document.body.style.userSelect = ''; } catch (e) {}
    try { document.body.style.cursor = ''; } catch (e) {}
  });
  wrapper.addEventListener("pointercancel", () => state.dragging = false);
}

/* -----------------------------------------------------------
   INIT
----------------------------------------------------------- */
loadTrees();

// ---------------------------
// Credits bouncing words
// ---------------------------
function randRange(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(randRange(a, b + 1)); }
function randColor() { return `hsl(${Math.floor(Math.random()*360)} ${60 + Math.random()*40}% ${50 + Math.random()*20}%)`; }

function createBouncer(text) {
  const el = document.createElement('div');
  el.className = 'credits-word';
  el.textContent = text;
  document.body.appendChild(el);
  const w = el.offsetWidth || 120;
  const h = el.offsetHeight || 40;
  // start position: random but away from bottom controls
  const padding = 40;
  const vw = Math.max(window.innerWidth, 320);
  const vh = Math.max(window.innerHeight, 240);
  const x = randRange(padding, vw - w - padding);
  const y = randRange(padding, Math.max(80, vh - 220));
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  const vx = randRange(-3.2, 3.2) || 1.6;
  const vy = randRange(-2.6, 2.6) || 1.2;
  return { el, x, y, vx, vy, w, h };
}

function spawnConfetti(x, y, count = 18, sizeMult = 1) {
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'confetti-piece';
    const color = randColor();
    c.style.background = color;
    // size variation
    const s = Math.max(4, Math.round((4 + Math.random() * 8) * sizeMult));
    c.style.width = s + 'px'; c.style.height = s + 'px';
    document.body.appendChild(c);
    let vx = randRange(-8 * sizeMult, 8 * sizeMult);
    let vy = randRange(-14 * sizeMult, -3 * sizeMult);
    let px = x; let py = y;
    c.style.left = px + 'px'; c.style.top = py + 'px';
    const life = 1400 + Math.random() * 1200;
    const start = performance.now();
    const raf = (ts) => {
      const t = ts - start;
      px += vx; py += vy; vy += 0.45 * sizeMult; // gravity
      c.style.left = px + 'px'; c.style.top = py + 'px';
      c.style.opacity = String(1 - t / life);
      if (t < life) requestAnimationFrame(raf); else try { c.remove(); } catch(e){}
    };
    requestAnimationFrame(raf);
  }
}

function spawnFirework(x, y, scale = 1) {
  const ring = document.createElement('div');
  ring.className = 'firework-ring';
  ring.style.left = (x - 2) + 'px';
  ring.style.top = (y - 2) + 'px';
  ring.style.width = '6px'; ring.style.height = '6px';
  ring.style.border = `3px solid ${randColor()}`;
  ring.style.mixBlendMode = 'screen';
  document.body.appendChild(ring);
  const start = performance.now();
  const dur = Math.max(600, 900 * scale + Math.random()*400);
  const raf = (ts) => {
    const t = ts - start;
    const p = Math.min(1, t / dur);
    const size = 12 * scale + p * (220 * scale);
    ring.style.width = size + 'px'; ring.style.height = size + 'px';
    ring.style.left = (x - size/2) + 'px'; ring.style.top = (y - size/2) + 'px';
    ring.style.opacity = String(1 - p);
    if (t < dur) requestAnimationFrame(raf); else try { ring.remove(); } catch(e){}
  };
  requestAnimationFrame(raf);
}

function startCredits() {
  if (window.__creditsRunning) return;
  window.__creditsRunning = true;
  window.__creditsBouncers = [createBouncer('Sink'), createBouncer('SlopGPT'), createBouncer('Thats so Haven')];
  // assign different initial colors
  window.__creditsBouncers[0].el.style.background = 'linear-gradient(0deg,#222,#511)';
  window.__creditsBouncers[1].el.style.background = 'linear-gradient(180deg,#004,#06F)';
  window.__creditsBouncers[2].el.style.background = 'linear-gradient(90deg,#401b63,#2a0f4a)';
  function step() {
    if (!window.__creditsRunning) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const b = window.__creditsBouncers;
    b.forEach(obj => {
      obj.x += obj.vx; obj.y += obj.vy;
      // bounds
      let hitX = false, hitY = false;
      if (obj.x <= 4) { obj.x = 4; obj.vx = Math.abs(obj.vx); hitX = true; }
      if (obj.x + obj.w >= vw - 4) { obj.x = vw - obj.w - 4; obj.vx = -Math.abs(obj.vx); hitX = true; }
      if (obj.y <= 4) { obj.y = 4; obj.vy = Math.abs(obj.vy); hitY = true; }
      // avoid overlapping the bottom controls area
      const controlsTop = Math.max(0, vh - 82);
      if (obj.y + obj.h >= controlsTop) { obj.y = controlsTop - obj.h - 4; obj.vy = -Math.abs(obj.vy); hitY = true; }

      // color change when hitting side (left/right) only
      if (hitX && !hitY) {
        obj.el.style.color = randColor();
      }

      // corner detection (hit both X and Y at same frame) -> explode box + big effects
      if (hitX && hitY) {
        // explode the text box: scale up + fade, then remove
        try {
          obj.removed = true;
          obj.el.style.transition = 'transform 520ms ease-out, opacity 520ms ease-out';
          obj.el.style.transform = 'scale(2.2) rotate(360deg)';
          obj.el.style.opacity = '0';
          setTimeout(() => { try { obj.el.remove(); } catch(e){} }, 560);
        } catch (e) {}

        // big confetti at corner
        spawnConfetti(obj.x + obj.w/2, obj.y + obj.h/2, 60, 1.6);

        // three big fireworks at the corner (slightly offset)
        for (let i = 0; i < 3; i++) {
          const ox = obj.x + obj.w/2 + randRange(-20, 20);
          const oy = obj.y + obj.h/2 + randRange(-20, 20);
          spawnFirework(ox, oy, 2.2 + Math.random()*0.6);
        }

        // ten big fireworks at center of screen
        const cx = Math.round(window.innerWidth / 2);
        const cy = Math.round(window.innerHeight / 2);
        for (let j = 0; j < 10; j++) {
          const ox = cx + randRange(-120, 120);
          const oy = cy + randRange(-80, 80);
          spawnFirework(ox, oy, 1.6 + Math.random()*1.2);
        }
      }

      obj.el.style.left = obj.x + 'px';
      obj.el.style.top = obj.y + 'px';
    });
    // remove any removed bouncers from list so they no longer get processed
    window.__creditsBouncers = window.__creditsBouncers.filter(o => !o.removed);
    window.__creditsAnimId = requestAnimationFrame(step);
  }
  window.__creditsAnimId = requestAnimationFrame(step);
}

function stopCredits() {
  window.__creditsRunning = false;
  if (window.__creditsAnimId) { try { cancelAnimationFrame(window.__creditsAnimId); } catch(e){} window.__creditsAnimId = null; }
  if (window.__creditsBouncers) {
    window.__creditsBouncers.forEach(b => { try { b.el.remove(); } catch(e){} });
    window.__creditsBouncers = null;
  }
}


