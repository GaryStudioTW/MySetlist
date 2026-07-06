// ============================================================================
// 歌單編輯 - 主程式
// ============================================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  connectSpotify,
  disconnectSpotify,
  isSpotifyConnected,
  handleRedirectCallback,
  getSpotifyProfile,
  searchSpotifyTracks,
  findBestTrackMatch,
  getUserPlaylists,
  addTracksToPlaylist,
} from "./spotify.js";

// ----------------------------------------------------------------------------
// Firebase 設定與初始化
// ----------------------------------------------------------------------------

const firebaseConfig = {
  apiKey: "AIzaSyBxAHEEDyuKnJyfY7-s4WO5iM9ZS4lXRd4",
  authDomain: "mysetlist-697db.firebaseapp.com",
  projectId: "mysetlist-697db",
  storageBucket: "mysetlist-697db.firebasestorage.app",
  messagingSenderId: "581687303522",
  appId: "1:581687303522:web:3746b5ec4b37c1a16ea03b",
  measurementId: "G-JR7RZ161KL",
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);

// 啟用 Firestore 離線持久化快取（取代自建 IndexedDB，斷線時可讀寫，恢復連線後自動同步）
const db = initializeFirestore(firebaseApp, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});

// ----------------------------------------------------------------------------
// 全域狀態
// ----------------------------------------------------------------------------

const state = {
  user: null,
  authReady: false,
  projects: [],
  projectsUnsub: null,
};

// 首頁排序模式（僅存於記憶體，重新整理後回到預設值）
let homeSortMode = "date-desc";

const appEl = document.getElementById("app");

// 歌單編輯器的暫存狀態（進入演出詳情頁時建立，離開時清除，避免Firestore即時同步
// 造成畫面在編輯過程中被整頁重新渲染打斷操作）
let editorState = null;

// 離線歌曲資料庫（僅載入一次並快取於本機，離線時可從 localStorage 復原）
let songsDBPromise = null;
let SONGS_BY_SECTION = null;

function loadSongsDB() {
  if (songsDBPromise) return songsDBPromise;
  songsDBPromise = (async () => {
    try {
      const res = await fetch("songs.json");
      const data = await res.json();
      try {
        localStorage.setItem("songsDBCache", JSON.stringify(data));
      } catch (e) {
        /* localStorage 空間不足時忽略快取失敗 */
      }
      return data;
    } catch (err) {
      const cached = localStorage.getItem("songsDBCache");
      if (cached) return JSON.parse(cached);
      throw err;
    }
  })();
  return songsDBPromise;
}

function getSongsBySection(songsDB) {
  if (SONGS_BY_SECTION) return SONGS_BY_SECTION;
  const map = new Map();
  songsDB.forEach((s) => {
    const key = s.section || "（無分類）";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });
  SONGS_BY_SECTION = map;
  return map;
}

// 已選歌單裡只存了 name/section，要拿英文歌名／專輯名輔助 Spotify 比對時
// 回頭去離線資料庫查原始資料（資料庫這時應該已經載入過、有快取）
function findOfflineSongEntry(name, section) {
  if (!SONGS_BY_SECTION) return null;
  const list = SONGS_BY_SECTION.get(section) || [];
  return list.find((s) => s.name === name) || null;
}

// ----------------------------------------------------------------------------
// 小型 SVG 圖示（內嵌，不依賴外部圖示字型，離線也能正常顯示）
// ----------------------------------------------------------------------------

const ICONS = {
  user: `<svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.5-7 8-7s8 3 8 7"/></svg>`,
  search: `<svg class="icon" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`,
  plus: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  arrowLeft: `<svg class="icon" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>`,
  music: `<svg class="icon" viewBox="0 0 24 24"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  logout: `<svg class="icon" viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
  close: `<svg class="icon" viewBox="0 0 24 24"><path d="M18 6L6 18M6 6l12 12"/></svg>`,
  grip: `<svg class="icon" viewBox="0 0 24 24"><circle cx="9" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="15" cy="18" r="1.2"/></svg>`,
  spotifyDot: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="color:var(--spotify); width:0.6em; height:0.6em; vertical-align:0;"><circle cx="12" cy="12" r="12"/></svg>`,
  edit: `<svg class="icon" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  pin: `<svg class="icon" viewBox="0 0 24 24" fill="currentColor" stroke="none"><g transform="rotate(25 12 12)"><path d="M16,9V4h1c0.55,0,1-0.45,1-1s-0.45-1-1-1H7C6.45,2,6,2.45,6,3s0.45,1,1,1h1v5c0,1.66-1.34,3-3,3v2h5.97v7l1,1l1-1v-7H19v-2C17.34,12,16,10.66,16,9z"/></g></svg>`,
  copy: `<svg class="icon" viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`,
};

function spotifyLogoSVG(size = 24) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" style="flex-shrink:0;">
    <circle cx="12" cy="12" r="12" fill="#1DB954"/>
    <path d="M6.5 9.5c4-1.2 8.3-1 11.3.8" stroke="#06210F" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M7 13c3.2-.9 6.6-.7 9.2.7" stroke="#06210F" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <path d="M7.5 16.2c2.6-.6 5.2-.5 7.3.6" stroke="#06210F" stroke-width="1.6" stroke-linecap="round" fill="none"/>
  </svg>`;
}

function googleLogoSVG() {
  return `<svg width="18" height="18" viewBox="0 0 48 48">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5 12.7 3.5 3.5 12.7 3.5 24S12.7 44.5 24 44.5 44.5 35.3 44.5 24c0-1.2-.1-2.3-.9-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34.5 5.5 29.5 3.5 24 3.5c-7.5 0-14 4.3-17.7 10.6z"/>
    <path fill="#4CAF50" d="M24 44.5c5.4 0 10.3-1.9 14.1-5.2l-6.5-5.5c-2 1.5-4.6 2.4-7.6 2.4-5.3 0-9.7-3.3-11.3-8l-6.6 5.1C9.9 40.1 16.4 44.5 24 44.5z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4.1 5.5l6.5 5.5C41.4 35.9 44.5 30.5 44.5 24c0-1.2-.1-2.3-.9-3.5z"/>
  </svg>`;
}

// ----------------------------------------------------------------------------
// 小工具
// ----------------------------------------------------------------------------

function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${y}/${m}/${d}`;
}

function showToast(msg, isError = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function h(strings, ...values) {
  return strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "");
}

// 專案名稱「自動組合」/「自訂插入」可用的變數清單
const NAME_VARS = [
  { key: "date", label: "日期", getValue: (f) => fmtDate(f.date) },
  { key: "band", label: "樂團", getValue: (f) => f.band || "" },
  { key: "eventName", label: "活動名稱", getValue: (f) => f.eventName || "" },
  { key: "location", label: "地點", getValue: (f) => f.location || "" },
  {
    key: "tags",
    label: "標籤",
    getValue: (f) => (f.tags || []).join(" "),
  },
];

// 歌單中可插入的段落標記（僅供編排/複製社群文字使用，不參與 Spotify 比對匯入）
const SEGMENT_MARKERS = [
  { key: "soundcheck", label: "彩排" },
  { key: "intro", label: "Intro" },
  { key: "encore", label: "Encore" },
  { key: "outro", label: "Outro" },
];

function isMarker(item) {
  return item.type === "marker";
}

function realSongCount(songs) {
  return songs.filter((s) => !isMarker(s)).length;
}

// ----------------------------------------------------------------------------
// 路由
// ----------------------------------------------------------------------------

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const segments = hash.split("/").filter(Boolean);
  return { path: segments[0] || "home", segments };
}

function navigate(path) {
  location.hash = "#/" + path;
}

window.addEventListener("hashchange", render);

// ----------------------------------------------------------------------------
// 登入狀態監聽
// ----------------------------------------------------------------------------

onAuthStateChanged(auth, (user) => {
  state.user = user;
  state.authReady = true;

  if (state.projectsUnsub) {
    state.projectsUnsub();
    state.projectsUnsub = null;
  }

  if (user) {
    subscribeProjects();
  }

  render();
});

async function handleGoogleSignIn() {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    console.error(err);
    showToast("登入失敗，請再試一次", true);
  }
}

async function handleSignOut() {
  await signOut(auth);
  navigate("home");
}

// ----------------------------------------------------------------------------
// Firestore：訂閱使用者的演出專案清單
// ----------------------------------------------------------------------------

function subscribeProjects() {
  const colRef = collection(db, "users", state.user.uid, "projects");
  const q = query(colRef, orderBy("date", "desc"));

  state.projectsUnsub = onSnapshot(
    q,
    (snapshot) => {
      state.projects = snapshot.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        _pending: d.metadata.hasPendingWrites,
      }));
      render();
    },
    (err) => {
      console.error(err);
      showToast("讀取歌單清單時發生錯誤", true);
    }
  );
}

// ----------------------------------------------------------------------------
// 畫面：登入頁
// ----------------------------------------------------------------------------

function renderLogin() {
  appEl.innerHTML = h`
    <div class="login-page">
      <div class="login-logo">${ICONS.music}</div>
      <p class="login-title">歌單編輯</p>
      <p class="login-subtitle">現場演出的歌單記錄工具</p>
      <button class="btn btn-secondary" id="google-signin-btn">
        ${googleLogoSVG()}
        使用 Google 帳號登入
      </button>
      <p class="login-hint">登入後可跨裝置同步你的演出歌單記錄</p>
    </div>
  `;
  document
    .getElementById("google-signin-btn")
    .addEventListener("click", handleGoogleSignIn);
}

// ----------------------------------------------------------------------------
// 畫面：首頁（演出專案列表）
// ----------------------------------------------------------------------------

const PIN_ACTION_MIN_WIDTH = 72; // 靜止展開（未觸發動作）時的置頂按鈕寬度
const DELETE_ACTIONS_MIN_WIDTH = 144; // 靜止展開時的複製＋刪除按鈕總寬度
const SWIPE_COMMIT_RATIO = 0.7; // 滑動超過卡片寬度的這個比例，直接觸發動作
const SWIPE_MAX_RATIO = 0.85; // 拖曳視覺上最多允許到卡片寬度的這個比例（給一點回彈手感）
let openSwipeCard = null;
let openSwipeDirection = null; // "left" 或 "right"，記錄目前展開的卡片是哪一側

function getHomeSortComparator(mode) {
  const dateVal = (p) => p.date || "";
  const createdVal = (p) => p.createdAt?.toMillis?.() ?? 0;
  switch (mode) {
    case "date-asc":
      return (a, b) => dateVal(a).localeCompare(dateVal(b));
    case "created-desc":
      return (a, b) => createdVal(b) - createdVal(a);
    case "created-asc":
      return (a, b) => createdVal(a) - createdVal(b);
    case "date-desc":
    default:
      return (a, b) => dateVal(b).localeCompare(dateVal(a));
  }
}

// 置頂項目排除排序、永遠在最前面；其餘項目依目前選擇的排序模式排列
function sortProjectsForHome(projects) {
  const cmp = getHomeSortComparator(homeSortMode);
  const pinned = projects.filter((p) => p.pinned).sort(cmp);
  const rest = projects.filter((p) => !p.pinned).sort(cmp);
  return [...pinned, ...rest];
}

function renderHome() {
  const user = state.user;
  openSwipeCard = null;
  openSwipeDirection = null;

  const sortedProjects = sortProjectsForHome(state.projects);

  const listHTML = sortedProjects.length
    ? sortedProjects
        .map((p) => {
          const tagsHTML = (p.tags || [])
            .map((t) => `<span class="tag">${escapeHTML(t)}</span>`)
            .join("");
          const songCount = (p.songs || []).length;
          const statusBadge = p._pending
            ? `<span class="badge badge-warning">待同步</span>`
            : `<span class="badge badge-success">已同步</span>`;
          return h`
            <div class="project-card-wrap" data-id="${p.id}">
              <div class="project-card-actions-left">
                <button type="button" class="pca-btn pca-pin" data-action="pin" data-id="${p.id}">
                  ${ICONS.pin}${p.pinned ? "取消置頂" : "置頂"}
                </button>
              </div>
              <div class="project-card-actions-right">
                <button type="button" class="pca-btn pca-copy" data-action="copy" data-id="${p.id}">
                  ${ICONS.copy}複製
                </button>
                <button type="button" class="pca-btn pca-delete" data-action="delete" data-id="${p.id}">
                  ${ICONS.close}刪除
                </button>
              </div>
              <button class="project-card" data-id="${p.id}">
                <div class="project-card-top">
                  <div>
                    <p class="project-card-name">${
                      p.pinned ? ICONS.pin + " " : ""
                    }${escapeHTML(p.name || "未命名演出")}</p>
                    <p class="project-card-meta">${fmtDate(p.date)}${
            p.location ? " ・ " + escapeHTML(p.location) : ""
          }</p>
                  </div>
                  ${statusBadge}
                </div>
                <div class="project-card-tags">
                  ${tagsHTML}
                  <span class="tag">${songCount}首</span>
                </div>
              </button>
            </div>
          `;
        })
        .join("")
    : h`
        <div class="empty-state">
          <div class="icon">${ICONS.music}</div>
          <p>還沒有任何演出記錄</p>
          <p style="font-size:12px;">點下方按鈕開始建立第一場演出的歌單</p>
        </div>
      `;

  appEl.innerHTML = h`
    <div class="page">
      <div class="topbar">
        <span class="topbar-title">歌單</span>
        <div class="user-chip" id="user-chip">
          ${
            user?.photoURL
              ? `<img class="user-avatar" src="${user.photoURL}" alt="" />`
              : ICONS.user
          }
          <span>${escapeHTML(user?.displayName || "")}</span>
        </div>
      </div>

      <div class="search-box">
        ${ICONS.search}
        <input type="text" id="project-search" placeholder="搜尋演出名稱、地點" />
      </div>

      <div style="display:flex; justify-content:flex-end; margin-bottom:10px;">
        <select id="sort-select" style="width:auto; font-size:12px; padding:7px 10px;">
          <option value="date-desc">演出日期：新到舊</option>
          <option value="date-asc">演出日期：舊到新</option>
          <option value="created-desc">新增時間：新到舊</option>
          <option value="created-asc">新增時間：舊到新</option>
        </select>
      </div>

      <div class="project-list" id="project-list">
        ${listHTML}
      </div>

      <div class="fab-container">
        <button class="btn btn-primary" id="new-project-btn">
          ${ICONS.plus} 新增活動
        </button>
      </div>
    </div>
  `;

  document.getElementById("new-project-btn").addEventListener("click", () => {
    navigate("new");
  });

  document.getElementById("user-chip").addEventListener("click", () => {
    navigate("settings");
  });

  const sortSelect = document.getElementById("sort-select");
  sortSelect.value = homeSortMode;
  sortSelect.addEventListener("change", () => {
    homeSortMode = sortSelect.value;
    renderHome();
  });

  document.querySelectorAll(".project-card-wrap").forEach((wrap) => {
    attachSwipeHandlers(wrap);
  });

  document.querySelectorAll(".pca-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const project = state.projects.find((p) => p.id === btn.dataset.id);
      if (!project) return;
      if (btn.dataset.action === "pin") toggleProjectPinned(project);
      else if (btn.dataset.action === "copy") duplicateProject(project);
      else if (btn.dataset.action === "delete") confirmDeleteProject(project);
    });
  });

  const searchInput = document.getElementById("project-search");
  searchInput.addEventListener("input", () => {
    const kw = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".project-card-wrap").forEach((wrap) => {
      const text = wrap.textContent.toLowerCase();
      wrap.style.display = text.includes(kw) ? "" : "none";
    });
  });
}

// 複製／刪除的寬度分配：展開寬度（144px）以內兩者平分；超過之後（往刪除
// 承諾距離靠近）複製線性縮小到 0，多出來的寬度全部給刪除吸收，讓刪除在
// 快要滑到底時視覺上「取代」複製，提示使用者再滑下去會直接刪除
function updateDeleteCopySplit(wrap, totalWidth, commitDistance) {
  const copyBtn = wrap.querySelector(".pca-copy");
  const deleteBtn = wrap.querySelector(".pca-delete");
  if (!copyBtn || !deleteBtn) return;
  let copyWidth;
  if (totalWidth <= DELETE_ACTIONS_MIN_WIDTH) {
    copyWidth = totalWidth / 2;
  } else {
    const shrinkRange = Math.max(1, commitDistance - DELETE_ACTIONS_MIN_WIDTH);
    const progress = Math.min(1, (totalWidth - DELETE_ACTIONS_MIN_WIDTH) / shrinkRange);
    copyWidth = (DELETE_ACTIONS_MIN_WIDTH / 2) * (1 - progress);
  }
  copyBtn.style.flex = "none";
  copyBtn.style.width = `${copyWidth}px`;
  deleteBtn.style.flex = "none";
  deleteBtn.style.width = `${totalWidth - copyWidth}px`;
}

// 恢復成 CSS 預設的 flex:1 平分，靜止狀態（關閉、展開、觸發後）都用這個
function resetDeleteCopySplit(wrap) {
  const copyBtn = wrap.querySelector(".pca-copy");
  const deleteBtn = wrap.querySelector(".pca-delete");
  if (copyBtn) {
    copyBtn.style.flex = "";
    copyBtn.style.width = "";
  }
  if (deleteBtn) {
    deleteBtn.style.flex = "";
    deleteBtn.style.width = "";
  }
}

function setSwipePanelWidths(wrap, offset, commitDistance) {
  const leftPanel = wrap.querySelector(".project-card-actions-left");
  const rightPanel = wrap.querySelector(".project-card-actions-right");
  if (offset >= 0) {
    leftPanel.style.width = `${offset}px`;
    rightPanel.style.width = "0px";
    resetDeleteCopySplit(wrap);
  } else {
    const width = -offset;
    rightPanel.style.width = `${width}px`;
    leftPanel.style.width = "0px";
    if (commitDistance) {
      updateDeleteCopySplit(wrap, width, commitDistance);
    } else {
      resetDeleteCopySplit(wrap);
    }
  }
}

function closeSwipeCard(card) {
  card.style.transition = "transform 0.2s ease";
  card.style.transform = "";
  const wrap = card.closest(".project-card-wrap");
  if (wrap) {
    const leftPanel = wrap.querySelector(".project-card-actions-left");
    const rightPanel = wrap.querySelector(".project-card-actions-right");
    leftPanel.style.transition = "width 0.2s ease";
    rightPanel.style.transition = "width 0.2s ease";
    leftPanel.style.width = "0px";
    rightPanel.style.width = "0px";
    resetDeleteCopySplit(wrap);
  }
}

// 卡片雙向滑動：右滑露出置頂（滑到卡片寬度 70% 直接切換置頂狀態），左滑露出
// 複製／刪除（滑到 70% 直接跳出刪除確認）。拖曳中色塊寬度即時跟著手指位置
// 變化，放開後才 snap 回固定展開寬度、關閉，或直接觸發動作。只偵測到明顯的
// 水平拖曳才攔截，垂直方向的手勢一律放行給頁面捲動；輕點則視為一般點擊
function attachSwipeHandlers(wrap) {
  const card = wrap.querySelector(".project-card");
  const leftPanel = wrap.querySelector(".project-card-actions-left");
  const rightPanel = wrap.querySelector(".project-card-actions-right");
  let ctx = null;

  function currentOpenOffset() {
    if (openSwipeCard !== card) return 0;
    return openSwipeDirection === "right" ? PIN_ACTION_MIN_WIDTH : -DELETE_ACTIONS_MIN_WIDTH;
  }

  card.addEventListener("pointerdown", (e) => {
    ctx = {
      startX: e.clientX,
      startY: e.clientY,
      startOffset: currentOpenOffset(),
      cardWidth: card.getBoundingClientRect().width,
      decided: false,
      isSwipe: false,
    };
  });

  card.addEventListener("pointermove", (e) => {
    if (!ctx) return;
    const dx = e.clientX - ctx.startX;
    const dy = e.clientY - ctx.startY;
    if (!ctx.decided) {
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
        ctx.decided = true;
        ctx.isSwipe = Math.abs(dx) > Math.abs(dy);
        if (ctx.isSwipe) {
          card.setPointerCapture(e.pointerId);
          card.style.transition = "none";
          leftPanel.style.transition = "none";
          rightPanel.style.transition = "none";
        }
      }
    }
    if (ctx.decided && ctx.isSwipe) {
      const maxAbs = ctx.cardWidth * SWIPE_MAX_RATIO;
      const offset = Math.min(maxAbs, Math.max(-maxAbs, ctx.startOffset + dx));
      card.style.transform = `translateX(${offset}px)`;
      setSwipePanelWidths(wrap, offset, ctx.cardWidth * SWIPE_COMMIT_RATIO);
    }
  });

  card.addEventListener("pointerup", (e) => {
    if (!ctx) return;
    if (ctx.decided && ctx.isSwipe) {
      const dx = e.clientX - ctx.startX;
      const finalOffset = ctx.startOffset + dx;
      const commitDistance = ctx.cardWidth * SWIPE_COMMIT_RATIO;
      const project = state.projects.find((p) => p.id === wrap.dataset.id);

      card.style.transition = "transform 0.2s ease";
      leftPanel.style.transition = "width 0.2s ease";
      rightPanel.style.transition = "width 0.2s ease";

      if (finalOffset > commitDistance) {
        // 右滑到底：直接切換置頂狀態
        card.style.transform = "";
        setSwipePanelWidths(wrap, 0);
        openSwipeCard = null;
        openSwipeDirection = null;
        if (project) toggleProjectPinned(project);
      } else if (finalOffset < -commitDistance) {
        // 左滑到底：直接跳出刪除確認卡片
        card.style.transform = "";
        setSwipePanelWidths(wrap, 0);
        openSwipeCard = null;
        openSwipeDirection = null;
        if (project) confirmDeleteProject(project);
      } else if (finalOffset > PIN_ACTION_MIN_WIDTH / 2) {
        card.style.transform = `translateX(${PIN_ACTION_MIN_WIDTH}px)`;
        setSwipePanelWidths(wrap, PIN_ACTION_MIN_WIDTH);
        if (openSwipeCard && openSwipeCard !== card) closeSwipeCard(openSwipeCard);
        openSwipeCard = card;
        openSwipeDirection = "right";
      } else if (finalOffset < -DELETE_ACTIONS_MIN_WIDTH / 2) {
        card.style.transform = `translateX(-${DELETE_ACTIONS_MIN_WIDTH}px)`;
        setSwipePanelWidths(wrap, -DELETE_ACTIONS_MIN_WIDTH);
        if (openSwipeCard && openSwipeCard !== card) closeSwipeCard(openSwipeCard);
        openSwipeCard = card;
        openSwipeDirection = "left";
      } else {
        card.style.transform = "";
        setSwipePanelWidths(wrap, 0);
        if (openSwipeCard === card) {
          openSwipeCard = null;
          openSwipeDirection = null;
        }
      }
    } else if (openSwipeCard === card) {
      closeSwipeCard(card);
      openSwipeCard = null;
      openSwipeDirection = null;
    } else if (openSwipeCard) {
      closeSwipeCard(openSwipeCard);
      openSwipeCard = null;
      openSwipeDirection = null;
    } else {
      navigate("project/" + wrap.dataset.id);
    }
    ctx = null;
  });

  card.addEventListener("pointercancel", () => {
    ctx = null;
  });
}

async function toggleProjectPinned(project) {
  try {
    await updateDoc(doc(db, "users", state.user.uid, "projects", project.id), {
      pinned: !project.pinned,
    });
  } catch (err) {
    console.error(err);
    showToast("更新置頂狀態失敗", true);
  }
}

async function duplicateProject(project) {
  try {
    const payload = {
      name: project.name,
      date: project.date || "",
      band: project.band || "",
      eventName: project.eventName || "",
      location: project.location || "",
      tags: project.tags || [],
      note: project.note || "",
      nameMode: project.nameMode || "auto",
      autoFields: project.autoFields || [],
      customName: project.customName || "",
      songs: project.songs || [],
      pinned: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const colRef = collection(db, "users", state.user.uid, "projects");
    await addDoc(colRef, payload);
    showToast("已複製活動");
  } catch (err) {
    console.error(err);
    showToast("複製失敗，請稍後再試", true);
  }
}

function confirmDeleteProject(project) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = h`
    <div class="modal-sheet">
      <div class="modal-header">
        <span class="modal-title">刪除活動</span>
        <button type="button" class="btn-icon" id="modal-close-btn">${ICONS.close}</button>
      </div>
      <p style="font-size:13px; color:var(--text-secondary); margin:0 0 16px;">
        確定要刪除「${escapeHTML(project.name || "未命名演出")}」嗎？此操作無法復原。
      </p>
      <div style="display:flex; gap:8px;">
        <button type="button" class="btn btn-secondary" id="cancel-delete-btn" style="flex:1;">取消</button>
        <button type="button" class="btn" id="confirm-delete-btn" style="flex:1; background:var(--danger); color:#fff;">刪除</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#modal-close-btn").addEventListener("click", close);
  overlay.querySelector("#cancel-delete-btn").addEventListener("click", close);
  overlay.querySelector("#confirm-delete-btn").addEventListener("click", async () => {
    close();
    try {
      await deleteDoc(doc(db, "users", state.user.uid, "projects", project.id));
      showToast("已刪除活動");
    } catch (err) {
      console.error(err);
      showToast("刪除失敗，請稍後再試", true);
    }
  });
}

// ----------------------------------------------------------------------------
// 畫面：建立／編輯演出專案（活動資訊 + 專案名稱設定）
// ----------------------------------------------------------------------------

function renderProjectForm(existing) {
  const isEdit = !!existing;

  // 表單狀態（single source of truth，由輸入事件同步更新）
  const form = {
    date: existing?.date || "",
    band: existing?.band || "",
    eventName: existing?.eventName || "",
    location: existing?.location || "",
    tags: [...(existing?.tags || [])],
    note: existing?.note || "",
    nameMode: existing?.nameMode || "auto",
    autoFields: existing?.autoFields || ["date", "eventName"],
    customName:
      existing?.nameMode === "custom" ? existing?.name || "" : existing?.customName || "",
  };

  function computeName() {
    if (form.nameMode === "custom") {
      return form.customName.trim();
    }
    return NAME_VARS.filter((v) => form.autoFields.includes(v.key))
      .map((v) => v.getValue(form))
      .filter(Boolean)
      .join(" ");
  }

  function updatePreview() {
    const preview = computeName() || "（尚未命名）";
    const el = document.getElementById("name-preview");
    if (el) el.textContent = "預覽：" + preview;
  }

  function renderNameSection() {
    const chipRow = NAME_VARS.map((v) => {
      if (form.nameMode === "auto") {
        const active = form.autoFields.includes(v.key);
        return `<button type="button" class="chip-btn${
          active ? " active" : ""
        }" data-varkey="${v.key}">${v.label}</button>`;
      }
      return `<button type="button" class="chip-btn" data-varkey="${v.key}">${v.label}</button>`;
    }).join("");

    const container = document.getElementById("name-section-body");
    container.innerHTML = h`
      <p style="font-size:11px; color:var(--text-muted); margin:0 0 6px;">
        ${
          form.nameMode === "auto"
            ? "點選要組合進名稱的變數"
            : "點選標籤可插入到下方文字框游標位置"
        }
      </p>
      <div class="chip-row">${chipRow}</div>
      ${
        form.nameMode === "custom"
          ? `<input type="text" id="f-customName" placeholder="輸入自訂專案名稱" value="${escapeAttr(
              form.customName
            )}" style="margin-bottom:10px;" />`
          : ""
      }
      <div class="preview-box" id="name-preview">預覽：${escapeHTML(
        computeName() || "（尚未命名）"
      )}</div>
    `;

    container.querySelectorAll(".chip-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.varkey;
        if (form.nameMode === "auto") {
          if (form.autoFields.includes(key)) {
            form.autoFields = form.autoFields.filter((k) => k !== key);
          } else {
            form.autoFields.push(key);
          }
          renderNameSection();
        } else {
          const varDef = NAME_VARS.find((v) => v.key === key);
          const value = varDef.getValue(form);
          if (!value) return;
          const input = document.getElementById("f-customName");
          const start = input.selectionStart ?? input.value.length;
          const end = input.selectionEnd ?? input.value.length;
          const newVal =
            input.value.slice(0, start) + value + input.value.slice(end);
          form.customName = newVal;
          input.value = newVal;
          const caret = start + value.length;
          input.focus();
          input.setSelectionRange(caret, caret);
          updatePreview();
        }
      });
    });

    if (form.nameMode === "custom") {
      const input = document.getElementById("f-customName");
      input.addEventListener("input", () => {
        form.customName = input.value;
        updatePreview();
      });
    }
  }

  function renderTagsUI() {
    const container = document.getElementById("tags-body");
    const tagChips = form.tags
      .map(
        (t, i) => h`
        <span class="tag-chip">${escapeHTML(t)}<button type="button" data-idx="${i}" class="tag-remove-btn">${ICONS.close}</button></span>
      `
      )
      .join("");
    container.innerHTML = h`
      <div class="chip-row" style="margin-bottom:8px;">${tagChips}</div>
      <input type="text" id="f-tagInput" placeholder="輸入標籤後按 Enter 新增" />
    `;
    container.querySelectorAll(".tag-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        form.tags.splice(Number(btn.dataset.idx), 1);
        renderTagsUI();
        updatePreview();
      });
    });
    const tagInput = document.getElementById("f-tagInput");
    tagInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = tagInput.value.trim();
        if (val && !form.tags.includes(val)) {
          form.tags.push(val);
          renderTagsUI();
          updatePreview();
        } else {
          tagInput.value = "";
        }
      }
    });
  }

  appEl.innerHTML = h`
    <div class="page">
      <div class="topbar">
        <button class="btn-icon" id="back-btn">${ICONS.arrowLeft}</button>
        <span class="topbar-title">${isEdit ? "編輯演出資訊" : "新增活動"}</span>
      </div>

      <div class="form-group">
        <label class="form-label">日期</label>
        <input type="date" id="f-date" value="${escapeAttr(form.date)}" />
      </div>

      <div class="form-group">
        <label class="form-label">樂團</label>
        <input type="text" id="f-band" value="${escapeAttr(form.band)}" />
      </div>

      <div class="form-group">
        <label class="form-label">活動名稱</label>
        <input type="text" id="f-eventName" value="${escapeAttr(form.eventName)}" />
      </div>

      <div class="form-group">
        <label class="form-label">地點</label>
        <input type="text" id="f-location" value="${escapeAttr(form.location)}" />
      </div>

      <div class="form-group">
        <label class="form-label">標籤</label>
        <div id="tags-body"></div>
      </div>

      <div class="form-group">
        <label class="form-label">備註</label>
        <textarea id="f-note">${escapeHTML(form.note)}</textarea>
      </div>

      <div class="form-group" style="border-top:1px solid var(--border); padding-top:14px;">
        <label class="form-label">專案名稱</label>
        <div class="radio-row">
          <label><input type="radio" name="nameMode" id="mode-auto" ${
            form.nameMode === "auto" ? "checked" : ""
          } /> 自動組合</label>
          <label><input type="radio" name="nameMode" id="mode-custom" ${
            form.nameMode === "custom" ? "checked" : ""
          } /> 自訂輸入</label>
        </div>
        <div id="name-section-body"></div>
      </div>

      <div class="form-footer-spacer"></div>
      <button class="btn btn-primary" id="save-project-btn">
        ${isEdit ? "儲存變更" : "儲存並繼續編輯歌單"}
      </button>
    </div>
  `;

  renderTagsUI();
  renderNameSection();

  document.getElementById("back-btn").addEventListener("click", () => {
    navigate(isEdit ? "project/" + existing.id : "home");
  });

  ["date", "band", "eventName", "location"].forEach((key) => {
    const input = document.getElementById("f-" + key);
    input.addEventListener("input", () => {
      form[key] = input.value;
      updatePreview();
    });
  });

  document.getElementById("f-note").addEventListener("input", (e) => {
    form.note = e.target.value;
  });

  document.getElementById("mode-auto").addEventListener("change", () => {
    form.nameMode = "auto";
    renderNameSection();
  });
  document.getElementById("mode-custom").addEventListener("change", () => {
    form.nameMode = "custom";
    renderNameSection();
  });

  document
    .getElementById("save-project-btn")
    .addEventListener("click", async () => {
      const btn = document.getElementById("save-project-btn");
      btn.disabled = true;
      btn.textContent = "儲存中...";

      const name = computeName() || "未命名演出";
      const payload = {
        date: form.date,
        band: form.band,
        eventName: form.eventName,
        location: form.location,
        tags: form.tags,
        note: form.note,
        nameMode: form.nameMode,
        autoFields: form.autoFields,
        customName: form.customName,
        name,
        updatedAt: serverTimestamp(),
      };

      try {
        if (isEdit) {
          await updateDoc(
            doc(db, "users", state.user.uid, "projects", existing.id),
            payload
          );
          showToast("已儲存變更");
          navigate("project/" + existing.id);
        } else {
          payload.songs = [];
          payload.createdAt = serverTimestamp();
          const colRef = collection(db, "users", state.user.uid, "projects");
          const newDoc = await addDoc(colRef, payload);
          showToast("已建立演出");
          navigate("project/" + newDoc.id);
        }
      } catch (err) {
        console.error(err);
        showToast("儲存失敗，請確認網路連線或稍後再試", true);
        btn.disabled = false;
        btn.textContent = isEdit ? "儲存變更" : "儲存並繼續編輯歌單";
      }
    });
}

function escapeAttr(str) {
  return escapeHTML(str).replace(/"/g, "&quot;");
}

// 專輯封面縮圖：有圖網址時顯示圖片，沒有時顯示留白佔位（維持列表對齊）
function songThumbHTML(imageUrl) {
  return imageUrl
    ? `<img class="song-thumb" src="${escapeAttr(imageUrl)}" alt="" loading="lazy" />`
    : `<div class="song-thumb song-thumb-empty">${ICONS.music}</div>`;
}

// ----------------------------------------------------------------------------
// 畫面：演出詳情（歌單編輯，此階段為過渡畫面，下一步驟會補上完整歌單編輯功能）
// ----------------------------------------------------------------------------

function renderProjectDetail(project) {
  if (!project) {
    appEl.innerHTML = h`
      <div class="page">
        <div class="topbar">
          <button class="btn-icon" id="back-btn">${ICONS.arrowLeft}</button>
          <span class="topbar-title">找不到此演出</span>
        </div>
      </div>
    `;
    document.getElementById("back-btn").addEventListener("click", () => navigate("home"));
    return;
  }

  // 建立編輯器暫存狀態（歌單陣列每筆加上本機用的 key，處理同曲重複加入時的排序穩定性）
  let keyCounter = 0;
  editorState = {
    projectId: project.id,
    band: project.band || "",
    songs: (project.songs || []).map((s) => ({ ...s, key: keyCounter++ })),
    nextKey: () => keyCounter++,
  };

  appEl.innerHTML = h`
    <div class="page">
      <div class="topbar">
        <button class="btn-icon" id="back-btn">${ICONS.arrowLeft}</button>
        <span class="topbar-title">${escapeHTML(project.name || "未命名演出")}</span>
      </div>

      <div class="card" style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <p style="margin:0; font-size:13px; color:var(--text-secondary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${fmtDate(project.date) || "未設定日期"}${
    project.location ? " ・ " + escapeHTML(project.location) : ""
  }
        </p>
        <button class="btn-icon" id="edit-info-btn" title="編輯活動資訊" style="flex-shrink:0;">${ICONS.edit}</button>
      </div>

      <div class="tab-row" id="song-source-tabs">
        <button type="button" class="tab-btn active" data-tab="offline">離線歌曲庫</button>
        <button type="button" class="tab-btn" data-tab="spotify">Spotify 搜尋</button>
      </div>

      <div class="search-box">
        ${ICONS.search}
        <input type="text" id="song-search-input" placeholder="搜尋代碼、歌名、歌詞" />
      </div>

      <div id="song-browse-area" style="margin-bottom:20px;"></div>

      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:600;">已選歌單</span>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:12px; color:var(--text-secondary);" id="songs-count">${realSongCount(
            editorState.songs
          )}首</span>
          <span style="font-size:11px; color:var(--text-muted);" id="sync-badge"></span>
        </div>
      </div>

      <div class="chip-row" style="margin-bottom:10px;" id="segment-marker-row">
        ${SEGMENT_MARKERS.map(
          (m) =>
            `<button type="button" class="chip-btn" data-marker-label="${escapeAttr(
              m.label
            )}">${ICONS.plus} ${escapeHTML(m.label)}</button>`
        ).join("")}
        <button type="button" class="chip-btn" id="segment-marker-custom-btn">${ICONS.plus} 自訂</button>
      </div>

      <div class="song-list" id="selected-songs-list"></div>

      <div class="btn-action-row">
        <button class="btn btn-secondary btn-action" id="copy-social-btn">
          ${ICONS.copy}
          <span>複製社群文字</span>
        </button>
        <button class="btn btn-spotify btn-action" id="add-to-spotify-btn">
          ${spotifyLogoSVG()}
          <span>加入Spotify<br>播放清單</span>
        </button>
      </div>
    </div>
  `;

  document.getElementById("back-btn").addEventListener("click", () => {
    editorState = null;
    navigate("home");
  });
  document.getElementById("edit-info-btn").addEventListener("click", () => {
    editorState = null;
    navigate("project/" + project.id + "/edit");
  });
  document
    .getElementById("add-to-spotify-btn")
    .addEventListener("click", openAddToSpotifyModal);
  document
    .getElementById("copy-social-btn")
    .addEventListener("click", () => copySocialText(project));
  document.querySelectorAll("#segment-marker-row .chip-btn[data-marker-label]").forEach((btn) => {
    btn.addEventListener("click", () => addMarkerToSetlist(btn.dataset.markerLabel));
  });
  document
    .getElementById("segment-marker-custom-btn")
    .addEventListener("click", openCustomMarkerModal);

  renderSongsList();
  initSongBrowser();
}

// ----------------------------------------------------------------------------
// 歌單編輯器：離線歌曲資料庫搜尋／瀏覽
// ----------------------------------------------------------------------------

async function initSongBrowser() {
  const browseArea = document.getElementById("song-browse-area");
  const searchInput = document.getElementById("song-search-input");
  const tabsEl = document.getElementById("song-source-tabs");
  if (!browseArea || !searchInput || !tabsEl) return;

  const PLACEHOLDERS = {
    offline: "搜尋代碼、歌名、歌詞",
    spotify: "搜尋 Spotify 歌曲、歌手",
  };

  let activeTab = "offline";
  let lastResults = [];
  let spotifyDebounceTimer = null;
  let spotifySearchSeq = 0;

  // ---------------- 分頁切換 ----------------

  function setTab(tab) {
    if (activeTab === tab) return;
    activeTab = tab;
    tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tab);
    });
    searchInput.placeholder = PLACEHOLDERS[tab];
    searchInput.value = "";
    if (tab === "offline") {
      doOfflineSearch("");
    } else {
      renderSpotifyTabInitial();
    }
  }

  tabsEl.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.tab));
  });

  searchInput.addEventListener("input", () => {
    if (activeTab === "offline") {
      doOfflineSearch(searchInput.value);
    } else {
      clearTimeout(spotifyDebounceTimer);
      spotifyDebounceTimer = setTimeout(() => doSpotifySearch(searchInput.value), 400);
    }
  });

  // ---------------- 離線歌曲庫 ----------------

  browseArea.innerHTML = `<div class="center-loading" style="min-height:60px;"><div class="spinner"></div></div>`;

  let songsDB;
  try {
    songsDB = await loadSongsDB();
  } catch (err) {
    songsDB = null;
  }

  if (!editorState) return; // 使用者可能已離開此頁

  function renderOfflineResults(list) {
    lastResults = list;
    browseArea.innerHTML = list
      .map(
        (s, i) => h`
        <div class="song-result-row" data-idx="${i}">
          <div class="song-result-info">
            <p class="song-result-name">${escapeHTML(s.name)}</p>
            <p class="song-result-meta">${escapeHTML(s.section || "")}${
          s.lyric ? " ・ " + escapeHTML(s.lyric) : ""
        }</p>
          </div>
          <button type="button" class="song-add-btn" data-idx="${i}">${ICONS.plus}</button>
        </div>
      `
      )
      .join("");
    bindOfflineAddButtons();
  }

  function renderBrowseBySection() {
    const bySection = getSongsBySection(songsDB);
    browseArea.innerHTML = [...bySection.entries()]
      .map(([section, songs]) => {
        return h`
        <details class="album-group">
          <summary>${escapeHTML(section)}（${songs.length}首）</summary>
          <div class="album-group-body" data-section="${escapeHTML(section)}"></div>
        </details>
      `;
      })
      .join("");

    // 每個 <details> 展開時才渲染內容（避免一次渲染143首造成畫面卡頓）
    browseArea.querySelectorAll(".album-group").forEach((detailsEl) => {
      detailsEl.addEventListener(
        "toggle",
        () => {
          if (!detailsEl.open) return;
          // 一次只展開一個專輯，開啟新的就自動收合其他已展開的
          browseArea.querySelectorAll(".album-group").forEach((other) => {
            if (other !== detailsEl && other.open) other.open = false;
          });
          const body = detailsEl.querySelector(".album-group-body");
          if (body.dataset.rendered) return;
          const section = body.dataset.section;
          const songs = bySection.get(section) || [];
          body.innerHTML = songs
            .map(
              (s, i) => h`
              <div class="song-result-row" data-section="${escapeHTML(
                section
              )}" data-localidx="${i}">
                <div class="song-result-info">
                  <p class="song-result-name">${escapeHTML(s.name)}</p>
                  <p class="song-result-meta">${escapeHTML(s.lyric || "")}</p>
                </div>
                <button type="button" class="song-add-btn-local" data-section="${escapeHTML(
                  section
                )}" data-localidx="${i}">${ICONS.plus}</button>
              </div>
            `
            )
            .join("");
          body.dataset.rendered = "1";
          body.querySelectorAll(".song-add-btn-local").forEach((btn) => {
            btn.addEventListener("click", () => {
              const sec = btn.dataset.section;
              const idx = Number(btn.dataset.localidx);
              const song = (bySection.get(sec) || [])[idx];
              if (song) addSongToSetlist(song);
            });
          });
        },
        { once: false }
      );
    });
  }

  function bindOfflineAddButtons() {
    browseArea.querySelectorAll(".song-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const song = lastResults[idx];
        if (song) addSongToSetlist(song);
      });
    });
  }

  function doOfflineSearch(kw) {
    if (!songsDB) {
      browseArea.innerHTML = `<p style="font-size:12px; color:var(--text-secondary);">離線歌曲資料庫載入失敗，請確認網路連線後重新整理頁面</p>`;
      return;
    }
    const q = kw.trim().toLowerCase();
    if (!q) {
      renderBrowseBySection();
      return;
    }
    const results = songsDB
      .filter((s) => {
        return (
          s.name.toLowerCase().includes(q) ||
          (s.lyric || "").toLowerCase().includes(q) ||
          (s.codes || []).some((c) => c.toLowerCase().includes(q))
        );
      })
      .slice(0, 40);
    if (results.length) {
      renderOfflineResults(results);
    } else {
      browseArea.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); padding:8px 0;">找不到符合的歌曲</p>`;
    }
  }

  // ---------------- Spotify 搜尋 ----------------

  function renderSpotifyConnectPrompt() {
    browseArea.innerHTML = h`
      <div class="empty-state" style="padding:24px 0;">
        <p style="font-size:13px;">尚未連接 Spotify 帳號</p>
        <button type="button" class="btn btn-spotify" id="spotify-tab-connect-btn" style="width:auto; padding:10px 20px;">
          ${spotifyLogoSVG()} 連接 Spotify
        </button>
      </div>
    `;
    const btn = document.getElementById("spotify-tab-connect-btn");
    if (btn) btn.addEventListener("click", () => connectSpotify());
  }

  function renderSpotifyTabInitial() {
    if (!isSpotifyConnected()) {
      renderSpotifyConnectPrompt();
      return;
    }
    browseArea.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); padding:8px 0;">輸入歌名或歌手開始搜尋</p>`;
  }

  function renderSpotifyResults(list) {
    lastResults = list;
    if (!list.length) {
      browseArea.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); padding:8px 0;">找不到符合的歌曲</p>`;
      return;
    }
    browseArea.innerHTML = list
      .map(
        (t, i) => h`
        <div class="song-result-row" data-idx="${i}">
          ${songThumbHTML(t.albumImage)}
          <div class="song-result-info">
            <p class="song-result-name">${escapeHTML(t.name)}</p>
            <p class="song-result-meta">${escapeHTML(t.artists)}${
          t.album ? " ・ " + escapeHTML(t.album) : ""
        }</p>
          </div>
          <button type="button" class="song-add-btn" data-idx="${i}">${ICONS.plus}</button>
        </div>
      `
      )
      .join("");
    browseArea.querySelectorAll(".song-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const track = lastResults[idx];
        if (track) addSpotifyTrackToSetlist(track);
      });
    });
  }

  async function doSpotifySearch(kw) {
    if (!isSpotifyConnected()) {
      renderSpotifyConnectPrompt();
      return;
    }
    const q = kw.trim();
    if (!q) {
      renderSpotifyTabInitial();
      return;
    }
    const seq = ++spotifySearchSeq;
    browseArea.innerHTML = `<div class="center-loading" style="min-height:60px;"><div class="spinner"></div></div>`;
    try {
      const results = await searchSpotifyTracks(q, 10);
      if (seq !== spotifySearchSeq || activeTab !== "spotify" || !editorState) return;
      renderSpotifyResults(results);
    } catch (err) {
      if (seq !== spotifySearchSeq || activeTab !== "spotify" || !editorState) return;
      console.error(err);
      browseArea.innerHTML = `<p style="font-size:12px; color:var(--danger); padding:8px 0;">${escapeHTML(
        err.message || "Spotify 搜尋失敗，請確認連線或重新連接帳號"
      )}</p>`;
    }
  }

  doOfflineSearch("");
}

// 離線歌曲庫的 section 是「編號.專輯名」格式（例如「01.Let's Go!」），
// 拿去跟 Spotify 比對前先去掉編號前綴
function cleanAlbumHint(section) {
  return (section || "").replace(/^\d+\.\s*/, "").trim();
}

// 觸覺回饋小工具：iOS Safari 沒有 Vibration API，此呼叫在 iOS 上會靜默無作用，
// 在支援的裝置（如 Android Chrome）上才會真的震動
function vibrateFeedback(ms) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// 實驗性 iOS Haptic Touch：點擊 index.html 裡那個隱藏的 switch label 觸發。
// 這只是 Safari 17.4+ 對「原生 switch 外觀 checkbox」的副作用，不是正式 API，
// 且必須是真正的使用者點擊事件才有機會生效（在 setTimeout／pointermove 裡呼叫
// 幾乎一定不會有效果），Safari 26.5 之後也可能已經被修補掉，其他瀏覽器則完全無感
function triggerHapticTouch() {
  const label = document.getElementById("haptic-switch-label");
  if (label) label.click();
}

function addSongToSetlist(songDbEntry) {
  if (!editorState) return;
  vibrateFeedback(15);
  triggerHapticTouch();
  const targetEditorState = editorState;
  const key = editorState.nextKey();
  editorState.songs.push({
    key,
    name: songDbEntry.name,
    section: songDbEntry.section || "",
  });
  renderSongsList();
  persistSongs();
  matchOfflineSongWithSpotify(targetEditorState, key, songDbEntry);
}

// 離線歌曲加入歌單後，若已連接 Spotify 就在背景嘗試比對同名歌曲，
// 比對成功後補上封面縮圖與 spotifyUri，之後「加入播放清單」就不用再重新搜尋一次；
// 純屬背景加值功能，失敗不影響操作也不跳錯誤提示
async function matchOfflineSongWithSpotify(targetEditorState, key, songDbEntry) {
  if (!isSpotifyConnected()) return;
  try {
    const match = await findBestTrackMatch(
      songDbEntry.name,
      targetEditorState.band,
      cleanAlbumHint(songDbEntry.section),
      songDbEntry.nameEn,
      songDbEntry.sectionEn
    );
    if (!match || editorState !== targetEditorState) return;
    const song = editorState.songs.find((s) => s.key === key);
    if (!song || isMarker(song)) return;
    song.spotifyUri = match.uri;
    song.spotifyId = match.id;
    song.albumImage = match.albumImage || "";
    renderSongsList();
    persistSongs();
  } catch (err) {
    console.error(err);
  }
}

function addSpotifyTrackToSetlist(track) {
  if (!editorState) return;
  vibrateFeedback(15);
  triggerHapticTouch();
  editorState.songs.push({
    key: editorState.nextKey(),
    name: track.name,
    source: "spotify",
    artists: track.artists,
    album: track.album || "",
    spotifyUri: track.uri,
    spotifyId: track.id,
    albumImage: track.albumImage || "",
  });
  renderSongsList();
  persistSongs();
}

function addMarkerToSetlist(label) {
  if (!editorState) return;
  editorState.songs.push({
    key: editorState.nextKey(),
    type: "marker",
    label,
  });
  renderSongsList();
  persistSongs();
}

// 自訂段落標記：跳出小視窗讓使用者輸入文字，確認後跟固定標記一樣加入歌單
function openCustomMarkerModal() {
  if (!editorState) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = h`
    <div class="modal-sheet">
      <div class="modal-header">
        <span class="modal-title">自訂段落標記</span>
        <button type="button" class="btn-icon" id="modal-close-btn">${ICONS.close}</button>
      </div>
      <div class="form-group">
        <input type="text" id="custom-marker-input" placeholder="輸入標記文字，例如：安可 Encore" maxlength="20" />
      </div>
      <button type="button" class="btn btn-primary" id="confirm-custom-marker-btn">新增標記</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#modal-close-btn").addEventListener("click", close);

  const input = overlay.querySelector("#custom-marker-input");
  input.focus();

  const confirm = () => {
    const label = input.value.trim();
    if (!label) {
      input.focus();
      return;
    }
    addMarkerToSetlist(label);
    close();
  };

  overlay.querySelector("#confirm-custom-marker-btn").addEventListener("click", confirm);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
    }
  });
}

// 段落標記在複製文字中的呈現格式暫定為「【標記】」，待確認正式的社群文字格式後再調整
async function copySocialText(project) {
  if (!editorState) return;

  let songNum = 0;
  const songLines = [];
  editorState.songs.forEach((s) => {
    if (isMarker(s)) {
      songLines.push(""); // 段落標記上方一律多一行空白行
      songLines.push(`【${s.label}】`);
      return;
    }
    songNum++;
    songLines.push(`${songNum}. ${s.name}`);
  });

  const blocks = [project.name || "", songLines.join("\n")];
  const note = (project.note || "").trim();
  if (note) blocks.push(note);
  blocks.push((project.tags || []).join(" "));

  const text = blocks.join("\n\n");

  try {
    await navigator.clipboard.writeText(text);
    showToast("已複製社群文字到剪貼簿");
  } catch (err) {
    console.error(err);
    showToast("複製失敗，請確認瀏覽器剪貼簿權限", true);
  }
}

// ----------------------------------------------------------------------------
// 一鍵加入 Spotify 播放清單：選擇播放清單 → 自動比對歌曲 → 加入
// ----------------------------------------------------------------------------

async function openAddToSpotifyModal() {
  if (!editorState) return;

  if (!isSpotifyConnected()) {
    showToast("請先在設定頁連接 Spotify", true);
    navigate("settings");
    return;
  }
  if (!realSongCount(editorState.songs)) {
    showToast("目前歌單還沒有歌曲");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = h`
    <div class="modal-sheet">
      <div class="modal-header">
        <span class="modal-title">選擇要加入的播放清單</span>
        <button type="button" class="btn-icon" id="modal-close-btn">${ICONS.close}</button>
      </div>
      <div id="modal-body">
        <div class="center-loading" style="min-height:80px;"><div class="spinner"></div></div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("#modal-close-btn").addEventListener("click", close);

  const bodyEl = overlay.querySelector("#modal-body");

  try {
    const playlists = await getUserPlaylists();
    if (!editorState) {
      close();
      return;
    }
    if (!playlists.length) {
      bodyEl.innerHTML = `<p style="font-size:13px; color:var(--text-secondary);">找不到可用的播放清單，請先在 Spotify 建立一個播放清單</p>`;
      return;
    }
    bodyEl.innerHTML = playlists
      .map(
        (p) => h`
        <button type="button" class="playlist-row" data-id="${p.id}">
          <span class="playlist-name">${escapeHTML(p.name)}</span>
          <span class="playlist-count">${p.trackCount}首</span>
        </button>
      `
      )
      .join("");
    bodyEl.querySelectorAll(".playlist-row").forEach((btn) => {
      btn.addEventListener("click", () => {
        runAddToSpotifyPlaylist(btn.dataset.id, bodyEl, close);
      });
    });
  } catch (err) {
    console.error(err);
    bodyEl.innerHTML = `<p style="font-size:13px; color:var(--danger);">${escapeHTML(
      err.message || "無法取得播放清單，請確認 Spotify 連接狀態"
    )}</p>`;
  }
}

async function runAddToSpotifyPlaylist(playlistId, bodyEl, close) {
  if (!editorState) {
    close();
    return;
  }
  const songs = editorState.songs.filter((s) => !isMarker(s));

  bodyEl.innerHTML = h`
    <div class="center-loading" style="min-height:80px; flex-direction:column; gap:10px;">
      <div class="spinner"></div>
      <p style="font-size:12px; color:var(--text-secondary);" id="match-progress">比對歌曲中...0/${songs.length}</p>
    </div>
  `;
  const progressEl = bodyEl.querySelector("#match-progress");

  const uris = [];
  let unmatched = 0;

  for (let i = 0; i < songs.length; i++) {
    const s = songs[i];
    try {
      if (s.spotifyUri) {
        uris.push(s.spotifyUri);
      } else {
        const dbEntry = findOfflineSongEntry(s.name, s.section);
        const match = await findBestTrackMatch(
          s.name,
          editorState.band,
          cleanAlbumHint(s.section),
          dbEntry?.nameEn,
          dbEntry?.sectionEn
        );
        if (match) uris.push(match.uri);
        else unmatched++;
      }
    } catch (err) {
      console.error(err);
      unmatched++;
    }
    if (progressEl) progressEl.textContent = `比對歌曲中...${i + 1}/${songs.length}`;
  }

  if (!uris.length) {
    bodyEl.innerHTML = `<p style="font-size:13px; color:var(--text-secondary);">找不到任何相符的 Spotify 歌曲</p>`;
    return;
  }

  try {
    await addTracksToPlaylist(playlistId, uris);
    close();
    showToast(
      unmatched
        ? `已加入 ${uris.length} 首，${unmatched} 首找不到相符歌曲`
        : `已加入 ${uris.length} 首到播放清單`
    );
  } catch (err) {
    console.error(err);
    bodyEl.innerHTML = `<p style="font-size:13px; color:var(--danger);">加入播放清單失敗：${escapeHTML(
      err.message || ""
    )}</p>`;
  }
}

// ----------------------------------------------------------------------------
// 歌單編輯器：已選歌單清單（拖曳排序、刪除、即時存檔）
// ----------------------------------------------------------------------------

function renderSongsList() {
  if (!editorState) return;
  const container = document.getElementById("selected-songs-list");
  const countEl = document.getElementById("songs-count");
  if (!container) return;

  if (!editorState.songs.length) {
    container.innerHTML = `<div class="empty-state" style="padding:24px 0;"><p style="font-size:13px;">還沒有加入任何歌曲</p></div>`;
  } else {
    let songNum = 0;
    container.innerHTML = editorState.songs
      .map((s) => {
        if (isMarker(s)) {
          return h`
        <div class="song-row song-row-marker" data-rowkey="${s.key}">
          <span class="drag-handle">${ICONS.grip}</span>
          <span class="song-row-marker-label">${escapeHTML(s.label)}</span>
          <button type="button" class="song-remove-btn" data-rowkey="${s.key}">${ICONS.close}</button>
        </div>
      `;
        }
        songNum++;
        const sub = s.source === "spotify" ? s.album : s.section;
        return h`
        <div class="song-row" data-rowkey="${s.key}">
          <span class="drag-handle">${ICONS.grip}</span>
          <span class="song-row-num">${songNum}</span>
          ${songThumbHTML(s.albumImage)}
          <span class="song-row-name">${
            s.source === "spotify" ? ICONS.spotifyDot + " " : ""
          }${escapeHTML(s.name)}${
          sub ? ` <span class="song-row-album">（${escapeHTML(sub)}）</span>` : ""
        }</span>
          <button type="button" class="song-remove-btn" data-rowkey="${s.key}">${ICONS.close}</button>
        </div>
      `;
      })
      .join("");
  }

  if (countEl) countEl.textContent = realSongCount(editorState.songs) + "首";

  container.querySelectorAll(".song-remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = Number(btn.dataset.rowkey);
      editorState.songs = editorState.songs.filter((s) => s.key !== key);
      renderSongsList();
      persistSongs();
    });
  });

  container.querySelectorAll(".drag-handle").forEach((handle) => {
    attachDragHandlers(handle);
  });
}

let dragCtx = null;
let pendingPress = null;

const LONG_PRESS_MS = 300;
const PRESS_MOVE_CANCEL_PX = 10; // 長按計時中若手指移動超過此距離，視為滑動而非拖曳意圖
const DRAG_SCALE = 1.04; // 拖曳觸發時卡片微幅放大的比例

// 拖曳排序：需先長按觸發（避免誤觸），啟動後拖曳中的列直接用 transform 跟著手指位置
// 即時移動，其餘列則平移讓出空位，放開後才真正重新排列 DOM／資料
function attachDragHandlers(handle) {
  handle.addEventListener("pointerdown", (e) => {
    const row = handle.closest(".song-row");
    const container = document.getElementById("selected-songs-list");
    if (!row || !container) return;

    try {
      handle.setPointerCapture(e.pointerId);
    } catch (err) {
      /* 部分情境（例如非真實硬體指標）setPointerCapture 會拋錯，不影響後續長按判斷 */
    }

    const pending = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      timer: null,
    };
    pending.timer = setTimeout(() => {
      if (pendingPress !== pending) return;
      pendingPress = null;
      startDrag(row, container, pending.startY);
    }, LONG_PRESS_MS);
    pendingPress = pending;
  });

  handle.addEventListener("pointermove", (e) => {
    if (dragCtx) {
      updateDrag(e.clientY);
      return;
    }
    if (pendingPress && pendingPress.pointerId === e.pointerId) {
      const dist = Math.hypot(e.clientX - pendingPress.startX, e.clientY - pendingPress.startY);
      if (dist > PRESS_MOVE_CANCEL_PX) {
        clearTimeout(pendingPress.timer);
        pendingPress = null;
      }
    }
  });

  handle.addEventListener("pointerup", () => {
    if (pendingPress) {
      clearTimeout(pendingPress.timer);
      pendingPress = null;
    }
    if (!dragCtx) return;
    finalizeSongOrder();
  });

  handle.addEventListener("pointercancel", () => {
    if (pendingPress) {
      clearTimeout(pendingPress.timer);
      pendingPress = null;
    }
    if (dragCtx) cleanupDrag();
  });
}

function startDrag(row, container, startClientY) {
  const rows = [...container.querySelectorAll(".song-row")];
  const rects = rows.map((r) => r.getBoundingClientRect());
  const startIndex = rows.indexOf(row);
  if (startIndex === -1) return;

  dragCtx = {
    row,
    rows,
    rects,
    startIndex,
    currentIndex: startIndex,
    startClientY,
    rowHeight: rects[startIndex].height + 6, // 6px 對應 .song-list 的 gap
  };

  row.classList.add("dragging");
  row.style.transition = "none";
  row.style.transform = `scale(${DRAG_SCALE})`;
  document.body.classList.add("no-select");
  vibrateFeedback(10);
  triggerHapticTouch();
}

function updateDrag(clientY) {
  if (!dragCtx) return;
  const { row, rows, rects, startIndex, rowHeight } = dragCtx;
  const deltaY = clientY - dragCtx.startClientY;
  row.style.transform = `translateY(${deltaY}px) scale(${DRAG_SCALE})`;

  const draggedCenter = rects[startIndex].top + rects[startIndex].height / 2 + deltaY;
  let newIndex = 0;
  rects.forEach((rect, i) => {
    if (i === startIndex) return;
    const otherCenter = rect.top + rect.height / 2;
    if (otherCenter < draggedCenter) newIndex++;
  });
  if (newIndex !== dragCtx.currentIndex) {
    vibrateFeedback(8); // 拖曳中每經過一首歌給一次短震動
    triggerHapticTouch();
  }
  dragCtx.currentIndex = newIndex;

  rows.forEach((r, i) => {
    if (i === startIndex) return;
    const rank = i < startIndex ? i : i - 1;
    let shift = 0;
    if (i < startIndex && rank >= newIndex) shift = rowHeight;
    else if (i > startIndex && rank < newIndex) shift = -rowHeight;
    r.style.transform = shift ? `translateY(${shift}px)` : "";
  });
}

function cleanupDrag() {
  const container = document.getElementById("selected-songs-list");
  if (container) {
    container.querySelectorAll(".song-row").forEach((r) => {
      r.style.transform = "";
      r.style.transition = "";
      r.classList.remove("dragging");
    });
  }
  document.body.classList.remove("no-select");
  dragCtx = null;
}

function finalizeSongOrder() {
  if (!editorState || !dragCtx) {
    cleanupDrag();
    return;
  }
  const { rows, startIndex, currentIndex } = dragCtx;
  if (startIndex !== currentIndex) {
    const ordered = rows.map((row) =>
      editorState.songs.find((s) => String(s.key) === row.dataset.rowkey)
    );
    const [dragged] = ordered.splice(startIndex, 1);
    ordered.splice(currentIndex, 0, dragged);
    editorState.songs = ordered;
  }
  cleanupDrag();
  renderSongsList();
  persistSongs();
}

async function persistSongs() {
  if (!editorState) return;
  const badge = document.getElementById("sync-badge");
  if (badge) badge.textContent = "已存本機・同步中";

  const projectId = editorState.projectId;
  const songsToSave = editorState.songs.map(({ key, ...rest }) => rest);

  try {
    await updateDoc(doc(db, "users", state.user.uid, "projects", projectId), {
      songs: songsToSave,
      updatedAt: serverTimestamp(),
    });
    if (badge && editorState && editorState.projectId === projectId) {
      badge.textContent = "已同步";
    }
  } catch (err) {
    console.error(err);
    if (badge && editorState && editorState.projectId === projectId) {
      badge.textContent = "同步失敗";
    }
  }
}

function renderSettings() {
  const connected = isSpotifyConnected();

  appEl.innerHTML = h`
    <div class="page">
      <div class="topbar">
        <button class="btn-icon" id="back-btn">${ICONS.arrowLeft}</button>
        <span class="topbar-title">設定</span>
      </div>
      <div class="card" style="margin-bottom:16px;">
        <p style="margin:0 0 4px; font-size:14px;">${escapeHTML(
          state.user?.displayName || ""
        )}</p>
        <p style="margin:0; font-size:12px; color:var(--text-secondary);">${escapeHTML(
          state.user?.email || ""
        )}</p>
      </div>

      <div class="card" style="margin-bottom:16px;" id="spotify-card">
        ${renderSpotifyCardBody(connected)}
      </div>

      <button class="btn btn-ghost" id="signout-btn">${ICONS.logout} 登出</button>
    </div>
  `;
  document.getElementById("back-btn").addEventListener("click", () => navigate("home"));
  document.getElementById("signout-btn").addEventListener("click", handleSignOut);

  bindSpotifyCardEvents();
  if (connected) loadSpotifyProfileIntoCard();
}

function renderSpotifyCardBody(connected) {
  if (!connected) {
    return h`
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
        <span style="font-size:14px; font-weight:600;">Spotify</span>
        <span class="badge badge-neutral">尚未連接</span>
      </div>
      <p style="margin:0 0 12px; font-size:12px; color:var(--text-secondary);">
        連接後可將歌單一鍵加入 Spotify 播放清單
      </p>
      <button class="btn btn-spotify" id="spotify-connect-btn">${spotifyLogoSVG()} 連接 Spotify</button>
    `;
  }
  return h`
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
      <span style="font-size:14px; font-weight:600;">Spotify</span>
      <span class="badge badge-success">已連接</span>
    </div>
    <p style="margin:0 0 12px; font-size:12px; color:var(--text-secondary);" id="spotify-profile-line">
      載入帳號資訊中...
    </p>
    <button class="btn btn-ghost" id="spotify-disconnect-btn">中斷連接</button>
  `;
}

function bindSpotifyCardEvents() {
  const connectBtn = document.getElementById("spotify-connect-btn");
  if (connectBtn) {
    connectBtn.addEventListener("click", () => {
      connectBtn.disabled = true;
      connectSpotify();
    });
  }
  const disconnectBtn = document.getElementById("spotify-disconnect-btn");
  if (disconnectBtn) {
    disconnectBtn.addEventListener("click", () => {
      disconnectSpotify();
      showToast("已中斷 Spotify 連接");
      renderSettings();
    });
  }
}

async function loadSpotifyProfileIntoCard() {
  try {
    const profile = await getSpotifyProfile();
    const line = document.getElementById("spotify-profile-line");
    if (line) line.textContent = "已連接帳號：" + (profile.display_name || profile.id);
  } catch (err) {
    console.error(err);
    const line = document.getElementById("spotify-profile-line");
    if (line) line.textContent = err.message || "無法取得帳號資訊，請確認連線或重新連接";
  }
}

// ----------------------------------------------------------------------------
// 主渲染函式
// ----------------------------------------------------------------------------

function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function render() {
  if (!state.authReady) {
    appEl.innerHTML = `<div class="center-loading"><div class="spinner"></div></div>`;
    return;
  }

  if (!state.user) {
    renderLogin();
    return;
  }

  const { path, segments } = currentRoute();

  switch (path) {
    case "new":
      editorState = null;
      renderProjectForm(null);
      break;
    case "project": {
      const id = segments[1];
      const isEditSub = segments[2] === "edit";
      const project = state.projects.find((p) => p.id === id) || null;
      if (isEditSub) {
        editorState = null;
        renderProjectForm(project);
      } else {
        // 若已經在編輯同一場演出的歌單，跳過整頁重繪（本機狀態已是最新，
        // 避免每次 Firestore 同步都打斷正在進行的搜尋/拖曳操作）
        if (editorState && editorState.projectId === id) {
          break;
        }
        renderProjectDetail(project);
      }
      break;
    }
    case "settings":
      editorState = null;
      renderSettings();
      break;
    case "home":
    default:
      editorState = null;
      renderHome();
      break;
  }
}

// 應用程式啟動：先處理 Spotify PKCE 登入導回（網址帶 ?code= 時），再進行首次渲染
(async function init() {
  const hasSpotifyCallback = new URLSearchParams(window.location.search).has("code");
  if (hasSpotifyCallback) {
    const ok = await handleRedirectCallback();
    showToast(ok ? "Spotify 已連接" : "Spotify 連接失敗，請再試一次", !ok);
    if (ok) navigate("settings");
  }
  render();
})();

loadSongsDB().catch(() => {
  /* 啟動時的預先載入失敗不影響其他畫面，實際使用時會在歌單編輯頁重試 */
});
