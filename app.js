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
  onSnapshot,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

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

const appEl = document.getElementById("app");

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
};

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

// ----------------------------------------------------------------------------
// 路由
// ----------------------------------------------------------------------------

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, "");
  const [path, param] = hash.split("/");
  return { path: path || "home", param };
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

function renderHome() {
  const user = state.user;

  const listHTML = state.projects.length
    ? state.projects
        .map((p) => {
          const tagsHTML = (p.tags || [])
            .map((t) => `<span class="tag">${escapeHTML(t)}</span>`)
            .join("");
          const songCount = (p.songs || []).length;
          const statusBadge = p._pending
            ? `<span class="badge badge-warning">待同步</span>`
            : `<span class="badge badge-success">已同步</span>`;
          return h`
            <button class="project-card" data-id="${p.id}">
              <div class="project-card-top">
                <div>
                  <p class="project-card-name">${escapeHTML(p.name || "未命名演出")}</p>
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

      <div class="project-list" id="project-list">
        ${listHTML}
      </div>

      <div class="fab-container">
        <button class="btn btn-primary" id="new-project-btn">
          ${ICONS.plus} 新增演出
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

  document.querySelectorAll(".project-card").forEach((el) => {
    el.addEventListener("click", () => {
      navigate("project/" + el.dataset.id);
    });
  });

  const searchInput = document.getElementById("project-search");
  searchInput.addEventListener("input", () => {
    const kw = searchInput.value.trim().toLowerCase();
    document.querySelectorAll(".project-card").forEach((el) => {
      const text = el.textContent.toLowerCase();
      el.style.display = text.includes(kw) ? "" : "none";
    });
  });
}

// ----------------------------------------------------------------------------
// 畫面：尚未建立的頁面（佔位）
// ----------------------------------------------------------------------------

function renderPlaceholder(title) {
  appEl.innerHTML = h`
    <div class="page">
      <div class="topbar">
        <button class="btn-icon" id="back-btn">${ICONS.arrowLeft}</button>
        <span class="topbar-title">${title}</span>
      </div>
      <div class="empty-state">
        <p>此畫面將於下一步驟建立</p>
      </div>
    </div>
  `;
  document.getElementById("back-btn").addEventListener("click", () => {
    navigate("home");
  });
}

function renderSettingsPlaceholder() {
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
      <p style="font-size:12px; color:var(--text-secondary); margin-bottom:16px;">
        Spotify 連接與其他設定將於下一步驟建立
      </p>
      <button class="btn btn-ghost" id="signout-btn">${ICONS.logout} 登出</button>
    </div>
  `;
  document.getElementById("back-btn").addEventListener("click", () => navigate("home"));
  document.getElementById("signout-btn").addEventListener("click", handleSignOut);
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

  const { path } = currentRoute();

  switch (path) {
    case "new":
      renderPlaceholder("新增演出");
      break;
    case "project":
      renderPlaceholder("編輯歌單");
      break;
    case "settings":
      renderSettingsPlaceholder();
      break;
    case "home":
    default:
      renderHome();
      break;
  }
}

render();
