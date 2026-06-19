import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  collection,
  doc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { allEntries, eventInfo, schedule } from "./data.js?v=20260619-2";

const firebaseConfig = {
  apiKey: "AIzaSyBno2LpCgrLdr1yhYZlZ0WAYKf-u-Iezrw",
  authDomain: "federado1-2026.firebaseapp.com",
  projectId: "federado1-2026",
  storageBucket: "federado1-2026.firebasestorage.app",
  messagingSenderId: "594161167408",
  appId: "1:594161167408:web:d6b25d99938b13f82091f5"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const entryItems = allEntries.filter((item) => item.kind === "entry");
const scoresStore = new Map();
const refsById = new Map();
let currentView = "orden";
let repaintTimer = null;
let orderRenderToken = 0;

const els = {
  syncStatus: document.querySelector("#syncStatus"),
  eventTitle: document.querySelector("#eventTitle"),
  totalEntries: document.querySelector("#totalEntries"),
  passedCount: document.querySelector("#passedCount"),
  scoredCount: document.querySelector("#scoredCount"),
  dayLabel: document.querySelector("#dayLabel"),
  visibleCount: document.querySelector("#visibleCount"),
  orderPanel: document.querySelector("#orderPanel"),
  rankingPanel: document.querySelector("#rankingPanel"),
  orderList: document.querySelector("#orderList"),
  rankingList: document.querySelector("#rankingList"),
  template: document.querySelector("#entryTemplate"),
  tabs: [...document.querySelectorAll(".view-tab")],
  dayFilter: document.querySelector("#dayFilter"),
  benchFilter: document.querySelector("#benchFilter"),
  clubFilter: document.querySelector("#clubFilter"),
  categoryFilter: document.querySelector("#categoryFilter"),
  searchFilter: document.querySelector("#searchFilter"),
  rankingDayFilter: document.querySelector("#rankingDayFilter"),
  rankingBenchFilter: document.querySelector("#rankingBenchFilter"),
  rankingCategoryFilter: document.querySelector("#rankingCategoryFilter")
};

const emptyScore = {
  score: "",
  difficulty: "",
  artistry: "",
  execution: "",
  penalty: "",
  notes: "",
  passed: false
};

function normalizeScore(raw) {
  const cleaned = String(raw ?? "").replace(/[^0-9.,-]/g, "").replace(",", ".");
  if (!cleaned || cleaned === "-") return "";
  const value = Number(cleaned);
  if (Number.isNaN(value)) return "";
  return value.toFixed(2);
}

function sanitizeScoreInput(input) {
  input.value = input.value.replace(/[^0-9.,-]/g, "");
}

function scoreNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getScore(id) {
  return { ...emptyScore, ...(scoresStore.get(id) || {}) };
}

function dayName(day) {
  return day === "sabado" ? "Sábado" : "Domingo";
}

function getOpenModality(item) {
  const source = [item.club, item.name, item.category, item.apparatus].join(" ");
  const match = source.match(/(D[ÚU]O|TR[ÍI]O|CONJUNTO|GRUPO)\s+OPEN/i);
  return match ? match[0].toUpperCase().replace("DUO", "DÚO").replace("TRIO", "TRÍO") : "";
}

function getCompetitionCategory(item) {
  const modality = getOpenModality(item);
  return modality ? `${modality} ${item.category}` : item.category;
}

function getDocId(item) {
  return `federado1-2026-${item.id}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[char]);
}

function buildSelectOptions(select, values, firstLabel) {
  const current = select.value;
  select.innerHTML = `<option value="todos">${firstLabel}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  if (values.includes(current)) select.value = current;
}

function updateFilterOptions() {
  const activeDay = els.dayFilter.value;
  const dayItems = entryItems.filter((item) => item.day === activeDay);
  const clubs = [...new Set(dayItems.map((item) => item.club).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  const categories = [...new Set(dayItems.map(getCompetitionCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  buildSelectOptions(els.clubFilter, clubs, "Todos");
  buildSelectOptions(els.categoryFilter, categories, "Todas");
}

function updateRankingOptions() {
  const day = els.rankingDayFilter.value;
  const bench = els.rankingBenchFilter.value;
  const categories = [...new Set(entryItems
    .filter((item) => day === "todos" || item.day === day)
    .filter((item) => bench === "todos" || item.banca === bench)
    .map(getCompetitionCategory)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
  buildSelectOptions(els.rankingCategoryFilter, categories, "Todas");
}

function getFilteredOrderItems() {
  const day = els.dayFilter.value;
  const bench = els.benchFilter.value;
  const club = els.clubFilter.value;
  const category = els.categoryFilter.value;
  const search = els.searchFilter.value.trim().toLowerCase();

  return schedule[day].filter((item) => {
    if (item.kind === "break") return bench === "todos" || item.banca === bench;
    const haystack = `${item.name} ${item.club} ${item.category} ${item.apparatus} ${item.time}`.toLowerCase();
    return (bench === "todos" || item.banca === bench)
      && (club === "todos" || item.club === club)
      && (category === "todos" || getCompetitionCategory(item) === category)
      && (!search || haystack.includes(search));
  });
}

function collectInputs(card) {
  return {
    scoreInput: card.querySelector(".score-input"),
    difficultyInput: card.querySelector(".difficulty-input"),
    artistryInput: card.querySelector(".artistry-input"),
    executionInput: card.querySelector(".execution-input"),
    penaltyInput: card.querySelector(".penalty-input"),
    notesInput: card.querySelector(".notes-input"),
    passedInput: card.querySelector(".passed-input")
  };
}

function readValues(refs) {
  return {
    score: normalizeScore(refs.scoreInput.value),
    difficulty: normalizeScore(refs.difficultyInput.value),
    artistry: normalizeScore(refs.artistryInput.value),
    execution: normalizeScore(refs.executionInput.value),
    penalty: normalizeScore(refs.penaltyInput.value),
    notes: refs.notesInput.value.trim(),
    passed: refs.passedInput.checked,
    updatedAt: serverTimestamp()
  };
}

async function saveEntry(id, refs) {
  refs.scoreInput.value = normalizeScore(refs.scoreInput.value);
  refs.difficultyInput.value = normalizeScore(refs.difficultyInput.value);
  refs.artistryInput.value = normalizeScore(refs.artistryInput.value);
  refs.executionInput.value = normalizeScore(refs.executionInput.value);
  refs.penaltyInput.value = normalizeScore(refs.penaltyInput.value);
  try {
    await setDoc(doc(db, "scores", id), readValues(refs), { merge: true });
    els.syncStatus.textContent = "Guardado";
  } catch (error) {
    els.syncStatus.textContent = "Error al guardar";
    console.error(error);
  }
}

function applyScoreToCard(id, card, refs) {
  const data = getScore(id);
  if (document.activeElement !== refs.scoreInput) refs.scoreInput.value = data.score;
  if (document.activeElement !== refs.difficultyInput) refs.difficultyInput.value = data.difficulty;
  if (document.activeElement !== refs.artistryInput) refs.artistryInput.value = data.artistry;
  if (document.activeElement !== refs.executionInput) refs.executionInput.value = data.execution;
  if (document.activeElement !== refs.penaltyInput) refs.penaltyInput.value = data.penalty;
  if (document.activeElement !== refs.notesInput) refs.notesInput.value = data.notes;
  refs.passedInput.checked = Boolean(data.passed);
  card.classList.toggle("is-passed", Boolean(data.passed));
  card.classList.toggle("has-score", Boolean(data.score));
}

function renderBreak(item) {
  const node = document.createElement("article");
  node.className = "break-card";
  node.innerHTML = `
    <span>${escapeHtml(item.time)}</span>
    <strong>${escapeHtml(item.label)}</strong>
    <small>Banca ${escapeHtml(item.banca)}</small>
  `;
  return node;
}

function renderEntry(item) {
  const id = getDocId(item);
  const card = els.template.content.firstElementChild.cloneNode(true);
  const refs = collectInputs(card);
  card.dataset.id = id;
  card.querySelector(".bench-chip").textContent = `Banca ${item.banca} · #${item.number}`;
  card.querySelector(".time-chip").textContent = item.time;
  card.querySelector(".category-line").textContent = `${getCompetitionCategory(item)} · ${item.apparatus}`;
  card.querySelector(".entry-name").textContent = item.name;
  card.querySelector(".entry-meta").textContent = `${item.club} · ${dayName(item.day)}`;

  [refs.scoreInput, refs.difficultyInput, refs.artistryInput, refs.executionInput, refs.penaltyInput]
    .forEach((input) => {
      input.addEventListener("input", () => sanitizeScoreInput(input));
      input.addEventListener("blur", () => saveEntry(id, refs));
    });
  refs.notesInput.addEventListener("blur", () => saveEntry(id, refs));
  refs.passedInput.addEventListener("change", () => {
    card.classList.toggle("is-passed", refs.passedInput.checked);
    saveEntry(id, refs);
  });

  applyScoreToCard(id, card, refs);
  refsById.set(id, { card, ...refs });
  return card;
}

function renderOrder() {
  orderRenderToken += 1;
  const token = orderRenderToken;
  refsById.clear();
  els.orderList.innerHTML = "";
  const items = getFilteredOrderItems();
  const entriesVisible = items.filter((item) => item.kind === "entry").length;
  const day = els.dayFilter.value;
  els.dayLabel.textContent = day === "sabado" ? eventInfo.sabadoLabel : eventInfo.domingoLabel;
  els.visibleCount.textContent = `${entriesVisible} visibles`;

  if (!items.length) {
    els.orderList.innerHTML = '<article class="empty-state">No hay registros para los filtros seleccionados.</article>';
    return;
  }

  const queue = [...items];
  const chunkSize = 30;
  function drawChunk() {
    if (token !== orderRenderToken) return;
    const fragment = document.createDocumentFragment();
    queue.splice(0, chunkSize).forEach((item) => {
      fragment.appendChild(item.kind === "break" ? renderBreak(item) : renderEntry({ ...item, day }));
    });
    els.orderList.appendChild(fragment);
    if (queue.length) requestAnimationFrame(drawChunk);
  }
  requestAnimationFrame(drawChunk);
}

function getRankingItems() {
  const day = els.rankingDayFilter.value;
  const bench = els.rankingBenchFilter.value;
  const category = els.rankingCategoryFilter.value;
  return entryItems
    .filter((item) => day === "todos" || item.day === day)
    .filter((item) => bench === "todos" || item.banca === bench)
    .filter((item) => category === "todos" || getCompetitionCategory(item) === category)
    .map((item) => ({ ...item, score: scoreNumber(getScore(getDocId(item)).score) }));
}

function renderRanking() {
  els.rankingList.innerHTML = "";
  const grouped = new Map();
  getRankingItems().forEach((item) => {
    const key = getCompetitionCategory(item) || "Sin categoría";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(item);
  });

  if (!grouped.size) {
    els.rankingList.innerHTML = '<article class="empty-state">No hay participantes para este filtro.</article>';
    return;
  }

  [...grouped.keys()].sort((a, b) => a.localeCompare(b, "es")).forEach((category) => {
    const article = document.createElement("article");
    article.className = "ranking-group";
    const rows = grouped.get(category).sort((a, b) => {
      if (a.score !== null && b.score !== null) return b.score - a.score;
      if (a.score !== null) return -1;
      if (b.score !== null) return 1;
      return a.name.localeCompare(b.name, "es");
    });
    article.innerHTML = `<h3>${escapeHtml(category)}</h3>`;
    rows.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "ranking-row";
      row.innerHTML = `
        <span class="place">${index + 1}</span>
        <div>
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml(item.club)} · ${dayName(item.day)} · Banca ${escapeHtml(item.banca)}</small>
        </div>
        <span class="ranking-score">${item.score === null ? "--" : item.score.toFixed(2)}</span>
      `;
      article.appendChild(row);
    });
    els.rankingList.appendChild(article);
  });
}

function updateStats() {
  let passed = 0;
  let scored = 0;
  entryItems.forEach((item) => {
    const data = getScore(getDocId(item));
    if (data.passed) passed += 1;
    if (data.score) scored += 1;
  });
  els.totalEntries.textContent = String(entryItems.length);
  els.passedCount.textContent = String(passed);
  els.scoredCount.textContent = String(scored);
}

function scheduleRepaint() {
  if (repaintTimer) return;
  repaintTimer = setTimeout(() => {
    repaintTimer = null;
    updateStats();
    if (currentView === "ranking") renderRanking();
  }, 60);
}

function subscribeScores() {
  onSnapshot(collection(db, "scores"), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "removed") {
        scoresStore.delete(change.doc.id);
        return;
      }
      scoresStore.set(change.doc.id, change.doc.data() || {});
      const refs = refsById.get(change.doc.id);
      if (refs) applyScoreToCard(change.doc.id, refs.card, refs);
    });
    els.syncStatus.textContent = "Sincronizado";
    scheduleRepaint();
  }, (error) => {
    els.syncStatus.textContent = "Sin conexión";
    console.error(error);
  });
}

function switchView(view) {
  currentView = view;
  els.tabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === view));
  els.orderPanel.classList.toggle("hidden", view !== "orden");
  els.rankingPanel.classList.toggle("hidden", view !== "ranking");
  if (view === "orden") renderOrder();
  else renderRanking();
}

els.eventTitle.textContent = eventInfo.title;
updateFilterOptions();
updateRankingOptions();
updateStats();
subscribeScores();
renderOrder();

els.tabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));
els.dayFilter.addEventListener("change", () => { updateFilterOptions(); renderOrder(); });
[els.benchFilter, els.clubFilter, els.categoryFilter].forEach((select) => select.addEventListener("change", renderOrder));
els.searchFilter.addEventListener("input", renderOrder);
els.rankingDayFilter.addEventListener("change", () => { updateRankingOptions(); renderRanking(); });
els.rankingBenchFilter.addEventListener("change", () => { updateRankingOptions(); renderRanking(); });
els.rankingCategoryFilter.addEventListener("change", renderRanking);
