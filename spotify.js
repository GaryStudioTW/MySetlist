// ============================================================================
// Spotify 串接模組
// 使用 PKCE Authorization Code Flow（純前端，不需要 Client Secret）
// ============================================================================

const SPOTIFY_CLIENT_ID = "215331f791034bd3819eab1aeee3b722";
const REDIRECT_URI = "https://garystudiotw.github.io/MySetlist/";
const SCOPES = "playlist-read-private playlist-modify-public playlist-modify-private";

const LS_ACCESS_TOKEN = "spotify_access_token";
const LS_REFRESH_TOKEN = "spotify_refresh_token";
const LS_EXPIRES_AT = "spotify_expires_at";
const LS_CODE_VERIFIER = "spotify_code_verifier";
const LS_OAUTH_STATE = "spotify_oauth_state";

// ----------------------------------------------------------------------------
// PKCE 工具函式
// ----------------------------------------------------------------------------

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomString(length) {
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return base64UrlEncode(arr.buffer).slice(0, length);
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  return crypto.subtle.digest("SHA-256", data);
}

// ----------------------------------------------------------------------------
// 連接 / 中斷連接
// ----------------------------------------------------------------------------

export async function connectSpotify() {
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  const state = randomString(16);

  localStorage.setItem(LS_CODE_VERIFIER, verifier);
  localStorage.setItem(LS_OAUTH_STATE, state);

  const params = new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    code_challenge_method: "S256",
    code_challenge: challenge,
    scope: SCOPES,
    state,
  });

  window.location.href = "https://accounts.spotify.com/authorize?" + params.toString();
}

export function disconnectSpotify() {
  localStorage.removeItem(LS_ACCESS_TOKEN);
  localStorage.removeItem(LS_REFRESH_TOKEN);
  localStorage.removeItem(LS_EXPIRES_AT);
}

export function isSpotifyConnected() {
  return !!localStorage.getItem(LS_REFRESH_TOKEN);
}

// ----------------------------------------------------------------------------
// Token 交換與更新
// ----------------------------------------------------------------------------

function storeTokens(data) {
  localStorage.setItem(LS_ACCESS_TOKEN, data.access_token);
  if (data.refresh_token) {
    localStorage.setItem(LS_REFRESH_TOKEN, data.refresh_token);
  }
  const expiresAt = Date.now() + (data.expires_in - 60) * 1000;
  localStorage.setItem(LS_EXPIRES_AT, String(expiresAt));
}

async function exchangeCodeForToken(code) {
  const verifier = localStorage.getItem(LS_CODE_VERIFIER);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: SPOTIFY_CLIENT_ID,
    code_verifier: verifier,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) throw new Error("Spotify 授權交換失敗");
  storeTokens(await res.json());
  localStorage.removeItem(LS_CODE_VERIFIER);
  localStorage.removeItem(LS_OAUTH_STATE);
}

// 應用程式啟動時呼叫：檢查網址是否帶有 Spotify 導回的 ?code=，若有則完成登入
export async function handleRedirectCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return false;

  const returnedState = params.get("state");
  const savedState = localStorage.getItem(LS_OAUTH_STATE);

  const cleanUrl =
    window.location.origin + window.location.pathname + (window.location.hash || "");
  window.history.replaceState({}, document.title, cleanUrl);

  if (savedState && returnedState !== savedState) {
    console.error("Spotify OAuth state 不符，可能的安全性問題，已中止登入");
    return false;
  }

  try {
    await exchangeCodeForToken(code);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function refreshAccessToken() {
  const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
  if (!refreshToken) throw new Error("SPOTIFY_REAUTH_REQUIRED");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!res.ok) {
    // refresh token 可能已過期（180天）或被撤銷，需要使用者重新登入
    disconnectSpotify();
    throw new Error("SPOTIFY_REAUTH_REQUIRED");
  }

  storeTokens(await res.json());
}

async function getValidAccessToken() {
  const expiresAt = Number(localStorage.getItem(LS_EXPIRES_AT) || 0);
  if (!localStorage.getItem(LS_ACCESS_TOKEN) || Date.now() >= expiresAt) {
    await refreshAccessToken();
  }
  return localStorage.getItem(LS_ACCESS_TOKEN);
}

// ----------------------------------------------------------------------------
// API 呼叫
// ----------------------------------------------------------------------------

async function spotifyFetch(path, options = {}) {
  const token = await getValidAccessToken();
  let res = await fetch("https://api.spotify.com/v1" + path, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: "Bearer " + token },
  });

  if (res.status === 401) {
    await refreshAccessToken();
    const token2 = localStorage.getItem(LS_ACCESS_TOKEN);
    res = await fetch("https://api.spotify.com/v1" + path, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: "Bearer " + token2 },
    });
  }
  return res;
}

// 從 Spotify 錯誤回應中取出實際的錯誤訊息，避免把根本原因（權限不足、token 失效等）蓋掉
async function spotifyErrorMessage(res, fallback) {
  const body = await res.json().catch(() => null);
  const detail = body?.error?.message;
  return detail ? `${fallback}（${res.status} ${detail}）` : `${fallback}（${res.status}）`;
}

export async function getSpotifyProfile() {
  const res = await spotifyFetch("/me");
  if (!res.ok) throw new Error(await spotifyErrorMessage(res, "無法取得 Spotify 帳號資訊"));
  return res.json();
}

export async function searchSpotifyTracks(query, limit = 20) {
  if (!query.trim()) return [];
  const q = encodeURIComponent(query);
  const res = await spotifyFetch(`/search?q=${q}&type=track&limit=${limit}`);
  if (!res.ok) throw new Error(await spotifyErrorMessage(res, "Spotify 搜尋失敗"));
  const data = await res.json();
  return (data.tracks?.items || []).map((t) => ({
    id: t.id,
    uri: t.uri,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join("、"),
    album: t.album?.name || "",
  }));
}

export async function findBestTrackMatch(songName) {
  const results = await searchSpotifyTracks(songName, 1);
  return results[0] || null;
}

export async function getUserPlaylists() {
  let items = [];
  let path = "/me/playlists?limit=50";
  while (path) {
    const res = await spotifyFetch(path);
    if (!res.ok) throw new Error(await spotifyErrorMessage(res, "無法取得播放清單"));
    const data = await res.json();
    items = items.concat(data.items || []);
    path = data.next ? data.next.replace("https://api.spotify.com/v1", "") : null;
  }
  return items
    .filter(Boolean)
    .map((p) => ({ id: p.id, name: p.name, trackCount: p.tracks?.total || 0 }));
}

export async function addTracksToPlaylist(playlistId, uris) {
  for (let i = 0; i < uris.length; i += 100) {
    const batch = uris.slice(i, i + 100);
    const res = await spotifyFetch(`/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris: batch }),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody?.error?.message || "加入播放清單失敗");
    }
  }
}
