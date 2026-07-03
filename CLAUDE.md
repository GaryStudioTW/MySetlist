# MySetlist 專案指令

## 語言規則（最優先，不可妥協）

**一律使用繁體中文（Traditional Chinese）**，包含：
- 所有對話回覆
- 程式碼註解
- Commit message
- UI 文案 / Toast 訊息
- 思考過程（thinking）本身

**禁止使用簡體中文字型**（例如：设定→設定、连接→連接、获取→獲取、资料→資料、这→這、时→時、后→後、软件→軟體、网络→網路）。

回覆前檢查：如果生成的文字裡出現任何簡體字，視為錯誤，需重新確認用字。

## 專案概觀

MySetlist 是現場演出歌單編輯工具，純前端（無建置流程），部署在 GitHub Pages：
`https://garystudiotw.github.io/MySetlist/`

- `index.html` / `app.js` / `style.css`：主要應用程式（Firebase 登入、Firestore 同步、歌單編輯）
- `spotify.js`：Spotify PKCE OAuth 串接（搜尋、播放清單）
- `songs.json`：離線歌曲資料庫

部署方式：直接 commit + push 到 `main` 分支，GitHub Pages 會自動建置（無 CI/CD pipeline）。
