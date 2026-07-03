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
  getDoc,
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
        <span class="topbar-title">${isEdit ? "編輯演出資訊" : "新增演出"}</span>
      </div>

      <div class="form-group">
        <label class="form-label">日期</label>
        <input type="date" id="f-date" value="${escapeAttr(form.date)}" />
      </div>

      <div class="form-group">
        <label class="form-label">樂團</label>
        <input type="text" id="f-band" placeholder="樂團名稱" value="${escapeAttr(
          form.band
        )}" />
      </div>

      <div class="form-group">
        <label class="form-label">活動名稱</label>
        <input type="text" id="f-eventName" placeholder="例：河岸留言專場" value="${escapeAttr(
          form.eventName
        )}" />
      </div>

      <div class="form-group">
        <label class="form-label">地點</label>
        <input type="text" id="f-location" placeholder="例：台北河岸留言" value="${escapeAttr(
          form.location
        )}" />
      </div>

      <div class="form-group">
        <label class="form-label">標籤</label>
        <div id="tags-body"></div>
      </div>

      <div class="form-group">
        <label class="form-label">備註</label>
        <textarea id="f-note" placeholder="舞台配置、演出注意事項...">${escapeHTML(
          form.note
        )}</textarea>
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
    songs: (project.songs || []).map((s) => ({ ...s, key: keyCounter++ })),
    nextKey: () => keyCounter++,
  };

  appEl.innerHTML = h`
    <div class="page">
      <div class="topbar">
        <button class="btn-icon" id="back-btn">${ICONS.arrowLeft}</button>
        <span class="topbar-title">${escapeHTML(project.name || "未命名演出")}</span>
      </div>

      <div class="card" style="margin-bottom:14px;">
        <p style="margin:0 0 4px; font-size:13px; color:var(--text-secondary);">
          ${fmtDate(project.date) || "未設定日期"}${
    project.location ? " ・ " + escapeHTML(project.location) : ""
  }
        </p>
      </div>

      <button class="btn btn-secondary" id="edit-info-btn" style="margin-bottom:16px;">
        編輯活動資訊
      </button>

      <div class="search-box">
        ${ICONS.search}
        <input type="text" id="song-search-input" placeholder="搜尋代碼、歌名、歌詞" />
      </div>

      <div id="song-browse-area" style="margin-bottom:20px;"></div>

      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <span style="font-size:13px; font-weight:600;">已選歌單</span>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-size:12px; color:var(--text-secondary);" id="songs-count">${
            editorState.songs.length
          }首</span>
          <span style="font-size:11px; color:var(--text-muted);" id="sync-badge"></span>
        </div>
      </div>

      <div class="song-list" id="selected-songs-list"></div>
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

  renderSongsList();
  initSongBrowser();
}

// ----------------------------------------------------------------------------
// 歌單編輯器：離線歌曲資料庫搜尋／瀏覽
// ----------------------------------------------------------------------------

async function initSongBrowser() {
  const browseArea = document.getElementById("song-browse-area");
  const searchInput = document.getElementById("song-search-input");
  if (!browseArea || !searchInput) return;

  browseArea.innerHTML = `<div class="center-loading" style="min-height:60px;"><div class="spinner"></div></div>`;

  let songsDB;
  try {
    songsDB = await loadSongsDB();
  } catch (err) {
    browseArea.innerHTML = `<p style="font-size:12px; color:var(--text-secondary);">離線歌曲資料庫載入失敗，請確認網路連線後重新整理頁面</p>`;
    return;
  }

  if (!editorState) return; // 使用者可能已離開此頁

  let lastResults = [];

  function renderResults(list) {
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
    bindAddButtons();
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

  function bindAddButtons() {
    browseArea.querySelectorAll(".song-add-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.idx);
        const song = lastResults[idx];
        if (song) addSongToSetlist(song);
      });
    });
  }

  function doSearch(kw) {
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
      renderResults(results);
    } else {
      browseArea.innerHTML = `<p style="font-size:12px; color:var(--text-secondary); padding:8px 0;">找不到符合的歌曲</p>`;
    }
  }

  doSearch("");
  searchInput.addEventListener("input", () => doSearch(searchInput.value));
}

function addSongToSetlist(songDbEntry) {
  if (!editorState) return;
  editorState.songs.push({
    key: editorState.nextKey(),
    name: songDbEntry.name,
    section: songDbEntry.section || "",
  });
  renderSongsList();
  persistSongs();
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
    container.innerHTML = editorState.songs
      .map(
        (s, i) => h`
        <div class="song-row" data-rowkey="${s.key}">
          <span class="drag-handle">${ICONS.grip}</span>
          <span class="song-row-num">${i + 1}</span>
          <span class="song-row-name">${escapeHTML(s.name)}${
          s.section ? ` <span class="song-row-album">（${escapeHTML(s.section)}）</span>` : ""
        }</span>
          <button type="button" class="song-remove-btn" data-rowkey="${s.key}">${ICONS.close}</button>
        </div>
      `
      )
      .join("");
  }

  if (countEl) countEl.textContent = editorState.songs.length + "首";

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

function attachDragHandlers(handle) {
  handle.addEventListener("pointerdown", (e) => {
    const row = handle.closest(".song-row");
    if (!row) return;
    dragCtx = { row };
    row.classList.add("dragging");
    handle.setPointerCapture(e.pointerId);
  });

  handle.addEventListener("pointermove", (e) => {
    if (!dragCtx) return;
    const container = document.getElementById("selected-songs-list");
    if (!container) return;
    const rows = [...container.querySelectorAll(".song-row")];
    const y = e.clientY;
    const draggedRect = dragCtx.row.getBoundingClientRect();
    for (const other of rows) {
      if (other === dragCtx.row) continue;
      const rect = other.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (draggedRect.top < rect.top && y > mid) {
        container.insertBefore(dragCtx.row, other.nextSibling);
        break;
      } else if (draggedRect.top > rect.top && y < mid) {
        container.insertBefore(dragCtx.row, other);
        break;
      }
    }
  });

  handle.addEventListener("pointerup", () => {
    if (!dragCtx) return;
    dragCtx.row.classList.remove("dragging");
    finalizeSongOrder();
    dragCtx = null;
  });

  handle.addEventListener("pointercancel", () => {
    if (dragCtx) {
      dragCtx.row.classList.remove("dragging");
      dragCtx = null;
    }
  });
}

function finalizeSongOrder() {
  if (!editorState) return;
  const container = document.getElementById("selected-songs-list");
  if (!container) return;
  const rows = [...container.querySelectorAll(".song-row")];
  const newOrder = rows
    .map((row) => editorState.songs.find((s) => String(s.key) === row.dataset.rowkey))
    .filter(Boolean);
  editorState.songs = newOrder;
  rows.forEach((row, i) => {
    const numEl = row.querySelector(".song-row-num");
    if (numEl) numEl.textContent = i + 1;
  });
  if (document.getElementById("songs-count")) {
    document.getElementById("songs-count").textContent = editorState.songs.length + "首";
  }
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
      renderSettingsPlaceholder();
      break;
    case "home":
    default:
      editorState = null;
      renderHome();
      break;
  }
}

render();
loadSongsDB().catch(() => {
  /* 啟動時的預先載入失敗不影響其他畫面，實際使用時會在歌單編輯頁重試 */
});
