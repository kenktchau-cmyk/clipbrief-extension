# 片刻 ClipBrief 0.8.1

Chrome Manifest V3 影片摘要擴充功能。讀取 YouTube、Bilibili 或一般 HTML5 影片嘅可讀字幕，生成內容簡介、重點及時間軸。YouTube／Bilibili 會喺留言區最頂顯示摘要卡，按時間可以跳返影片。

支援 **Google Gemma／Gemini** 及 **OpenAI Chat Completions 相容 API**。每位使用者喺自己嘅本機後端設定供應商、API 網址、模型同 Key。原始碼、Chrome 擴充功能及下載包均唔包含使用者金鑰。

## 安裝與設定

1. 下載或 clone 呢個儲存庫，準備 Node.js 24.5 或以上版本。無 npm 依賴，毋須編譯。
2. 喺儲存庫根目錄啟動本機後端：

   ```sh
   node --use-system-ca scripts/preview.mjs
   ```

3. 開啟 [本機 API 設定頁](http://127.0.0.1:4173/setup.html)，選擇供應商／API 格式，填入網址及自己嘅 Key，按「讀取可用模型」，喺下拉選單揀模型（或手動輸入 ID），再按「儲存到本機後端」。保存後立即生效，Key 欄位會清空。
4. 按「複製插件連線碼」。
5. 用 Chrome 120 或以上版本打開 `chrome://extensions`，啟用開發人員模式，按「載入未封裝項目」，選擇儲存庫根目錄（包含 `manifest.json`）。亦可以用 `python scripts/package.py` 產生嘅 `clipbrief-extension-0.8.1.zip`，先解壓再載入。
6. 打開片刻側邊欄 → 齒輪「後端設定」→ 貼上連線碼 →「連接並儲存後端」，授權本機網址。
7. 開啟 YouTube／Bilibili 影片，按讚好／分享操作列嘅「片刻摘要」。其他網站用 Chrome 工具列嘅片刻图示，再按「擷取目前影片」。
8. 檢視字幕、選語言及長度，再按「生成影片摘要」。YouTube／Bilibili 生成完成後，摘要同時間軸會自動顯示喺留言區上方。

要更換 AI，喺片刻齒輪設定按「輸入／更新自己嘅 API Key」，或直接開啟本機設定頁。切換供應商或網址時需要重新輸入對應 Key，唔會自動沿用另一間供應商嘅金鑰。

同一 API 已有後端 Key 時可以留空 Key，直接讀取清單或更換模型。讀取清單唔會改動已儲存設定，選模型後仍需按儲存。切換供應商、網址或輸入新 Key 會清除舊清單並取消舊查詢。

Google 清單使用官方 `models.list` 並篩選支援 `generateContent` 嘅模型；OpenAI 相容服務使用基底網址嘅 `/models`。清單唔保證模型適用文字 Chat Completions、已有生成權限或額度，請選文字對話模型。API 未提供清單、清單為空或查詢失敗時可手動輸入 ID。查詢最多 20 秒、10 頁、5,000 個模型，每頁回覆最多 4 MiB；超過頁數／數量會標示部分清單。

後端必須保持運行。每次後端重啟，連線碼都會更新，請重新複製到 Chrome 擴充功能。呢個連線碼只授權本機摘要服務，唔係供應商 API Key。

## 支援嘅 API

| 選項 | 設定方式 |
| --- | --- |
| Google · Gemma / Gemini | 使用 Google 原生 Gemini API，網址固定為官方 `https://generativelanguage.googleapis.com/v1beta`。預設模型 `gemma-4-26b-a4b-it`，亦可填入自己可存取嘅 Gemma／Gemini 模型 ID。 |
| OpenAI | 預填 `https://api.openai.com/v1`；填入帳戶可使用、支援 Chat Completions 嘅模型 ID 及 Key。 |
| 自訂 · OpenAI 相容 API | 自行填入供應商嘅 API 基底網址、模型及 Key，例如 DeepSeek、OpenRouter 等相容服務。後端會呼叫 `/chat/completions`。 |

API 網址使用 HTTPS；只有 `localhost`／`127.0.0.1` 可用 HTTP。網址唔可以帶帳密、查詢參數或 fragment。「強制 JSON 模式」預設關閉，只喺所選模型支援時開啟。即使關閉，提示仍會要求 JSON，並驗證摘要結構。

自訂 API 需要相容 Chat Completions 嘅 `messages`、Bearer 驗證及 `choices[].message.content` 回覆格式；唔代表任意 API 協定都支援。原生 Anthropic Messages、Responses-only 模型等協定目前未整合。模型權限、上下文限制、額度及收費按所選供應商及帳戶而定；保存設定只驗證格式及安全儲存，實際生成先會驗證連線及模型權限。

## 自動取得轉錄稿與快捷鍵

0.8.1 修正 YouTube 新版「字幕記錄」：同時辨認 `PAmodern_transcript_view`／`transcript-segment-view-model` 及舊版轉錄稿。已開啟嘅字幕記錄會優先讀取；自動打開時會等候字幕列數短暫穩定先擷取。

以用戶提供嘅影片 `04fjBk7KqII` 實際 DOM 驗證，新版選擇器讀到 123 段、7,180 字元，時間標記由 0:00 至 16:24。呢次係真實頁面讀取驗證，未代表已完成 Comet 已安裝插件嘅端對端測試。

按 YouTube 影片下方「片刻摘要」或側邊欄「擷取目前影片」，會先讀取可用字幕；字幕不足時自動展開影片說明、打開轉錄稿、等候文字載入，再擷取文字同時間標記。毋須先手動開啟轉錄稿，亦唔會自動將字幕送去 AI；按「生成影片摘要」先會發出 AI 請求。只讀取頁面已載入嘅內容，長影片請確認完整度。影片無字幕或網站未能載入時，仍可重試或手動匯入。

喺 YouTube 一般影片頁按 **Alt + Shift + T**，片刻會展開影片說明並打開「顯示轉錄稿」。已打開時會捲動到轉錄稿，唔會將佢關閉。呢個操作唔需要 AI Key，唔會生成摘要。

自訂快捷鍵：Comet 網址列輸入 `comet://extensions/shortcuts`（Chrome 用 `chrome://extensions/shortcuts`），喺「片刻 ClipBrief」下面修改「打開 YouTube 轉錄稿」。如果預設組合已被其他程式使用，請喺呢頁另設組合。

升級後，喺 `comet://extensions`／`chrome://extensions` 按片刻卡片嘅重新載入，再重新整理 YouTube。若未安裝，先按上面步驟載入最新目錄。

快捷鍵只適用於 YouTube `/watch` 影片頁，暫不支援 Shorts、Bilibili 或其他網站。影片須提供轉錄稿；等候約 12 秒仍未搵到時會顯示提示。優先辨認 YouTube 轉錄稿區塊，亦支援繁體、簡體及英文按鈕文字；YouTube 改版可能需要更新。重複按鍵唔會重複開啟，切換影片會取消舊操作。

## 留言區摘要與其他功能

- 留言區最頂嘅摘要卡同時顯示影片簡介、內容重點及時間軸，可收起展開；按時間定位播放器。
- 摘要卡只喺使用者自己嘅瀏覽器顯示，**唔會發布成留言**。唔會影響原有留言。
- 留言區延遲載入或被網站重新建立時會自動補回摘要卡，避免重複。切換影片或 Bilibili 分 P 會移除舊摘要，避免對錯影片。
- YouTube／Bilibili 影片操作列加入「片刻摘要」按鈕；按鈕只打開側邊欄及讀取字幕，按「生成」先發送 AI 請求。
- 繁體中文、廣東話或英文輸出；精簡、標準及詳細長度。
- TXT、SRT、VTT、字幕 JSON 匯入，或手動貼上逐字稿。
- 最多 180,000 字元；長字幕分段整理再合併，生成前顯示預計請求次數。
- 取消生成、複製摘要、匯出 Markdown。
- 固定示範標示「內置示範」，真實 AI 生成嘅示範字幕摘要標示「AI 實測」。

| 網站 | 字幕來源與限制 |
| --- | --- |
| YouTube | 目前影片字幕軌；讀唔到時自動打開轉錄稿再擷取。受登入、簽署網址、頁面載入及網站改版影響，失敗可手動貼上。 |
| Bilibili | 目前 BV／av 影片及分 P 字幕資料；可能受登入、風控或網站改版影響。可匯入字幕。 |
| 一般 HTML5 網站 | 主框架播放器 TextTrack 或可讀字幕檔；跨域 iframe、自訂播放器或無字幕影片可能需要手動逐字稿。一般網站暫無留言區摘要卡。 |

本版係字幕摘要，未有畫面分析或自動錄音轉錄。請檢查擷取嘅字幕是否完整。時間軸只保留可以核對輸入字幕嘅時間值。留言區關閉或網站未提供可辨認容器時，仍可以喺側邊欄閱讀摘要。重載頁面後需重新生成摘要。

## 金鑰與資料流

```text
影片頁 → 片刻側邊欄 → 本機後端 → 你選擇嘅 AI API
  ↑                       ↑
留言區摘要卡       API 設定及金鑰只由後端保存
```

- Windows 用 DPAPI 加密整份供應商設定，存於 `server/.secrets/provider-config.dpapi`，綁定目前 Windows 帳戶。API Key 經 stdin 交畀加密程序，唔放命令列或暫存明文檔。
- macOS／Linux 經設定頁提供嘅設定只保留喺後端記憶體，後端關閉後需重新輸入。Google 亦可由執行環境注入 `GEMINI_API_KEY`；Windows 若已有加密供應商設定，以該設定為先。
- 相容舊版本 `google-key.dpapi`。升級至多 API 設定後，以新嘅 `provider-config.dpapi` 為先。舊 PowerShell 設定指令僅供未建立多 API 設定嘅 Google 初始配置使用。
- Key 輸入欄位只位於獨立本機設定頁；讀取清單時送到本機 `/api/models`，儲存時送到 `/api/provider` 並清空欄位，無 localStorage／sessionStorage。讀取清單唔會保存新 Key；Chrome 插件及影片頁唔會收到供應商 Key。
- 設定端點驗證同來源、特定 header 及連線碼；其他網站、甚至持有連線碼嘅 Chrome 擴充功能都無法修改供應商設定。
- 摘要請求只接受標題、字幕同輸出選項。供應商、網址、模型及 Key 由後端管理，摘要客戶端唔可以覆蓋。
- 後端只監聽 `127.0.0.1`，驗證 Host、Origin、連線碼、資料大小，同時最多一個摘要工作，每小時最多 30 個工作。
- 靜態服務只提供明確列出嘅介面檔案；後端原始碼、`.secrets`、`.env`、`.git`、日誌、ZIP 及路徑穿越請求均無法由網站讀取。
- Git 同 ZIP 排除金鑰、日誌及本機資料。Chrome CSP 只允許連接本機後端；Chrome local storage 只保存後端網址及連線碼，唔會同步金鑰到 Google 帳戶。
- 無遙測或雲端歷史，字幕同摘要唔寫入後端磁碟。AI 請求唔帶浏览器 Cookie、唔跟隨重新導向；讀取影片字幕時會用原網站播放所需權限。
- 取消會中止後端工作，但已送出請求仍可能計費。每位使用者使用自己帳戶嘅額度。

## 開發、打包與驗證

```sh
node --test tests/*.test.js
python scripts/package.py
```

輸出到 `artifacts/`：Chrome 客戶端 ZIP 同後端完整程式 ZIP，均使用指定檔案清單並檢查金鑰模式。要重製圖示可執行 `scripts/icons.py`（需 Pillow），一般安裝及啟動唔需要。

後端啟動後可以開啟：

- [多 API 設定頁](http://127.0.0.1:4173/setup.html)
- [摘要側邊欄預覽](http://127.0.0.1:4173/panel.html?demo=1)
- [YouTube／Bilibili 操作列預覽](http://127.0.0.1:4173/action-bars-preview.html)
- [留言區摘要與時間軸預覽](http://127.0.0.1:4173/comments-preview.html)

67 項自動化測試已通過，包括字幕、分段合併、Google／OpenAI 格式、後端 HTTP、設定權限、金鑰隔離、模型清單分頁與限制、同一服務先可沿用 Key、切換失敗保留原有設定、錯誤遮罩、限流、取消及影片身份驗證。自動擷取同轉錄稿快捷鍵測試涵蓋直接字幕、無字幕時自動開啟再擷取、來源分頁、展開說明、已開啟處理、缺少字幕、不同語言按鈕、重複操作及切換影片取消；以模擬 DOM 驗證，未完成 Comet 真實影片快捷鍵端對端測試。Windows 加密配置保存及解密亦用獨立合成資料驗證。瀏覽器預覽確認時間軸 `1:34` 會設定播放器到 94 秒、切換影片移除舊卡、重複更新只保留一張卡。

Google Gemma 4 已用內置字幕經本機後端完成真實摘要。模型選單亦已用後端已存 Key 實測讀取 Google 清單，並確認手動輸入及切換服務清除舊清單。其他 API 以模擬回覆驗證，未使用真實供應商帳戶逐一測試。實際 Chrome 安裝及真實 YouTube／Bilibili 完整端對端測試尚未完成；網站 DOM 改版可能需要更新選擇器。未上架 Chrome Web Store。

模型清單官方文件：[Google models.list](https://ai.google.dev/api/models)、[OpenAI List models](https://developers.openai.com/api/reference/resources/models/methods/list)。

主要檔案：`panel.js` 使用者流程；`api.js` 本機客戶端；`server/app.js` 後端驗證；`server/ai-provider.js` API 轉換；`server/key-store.js` 加密保存；`setup.*` API 設定頁；`inline-summary.js` 留言區卡片；`action-button.js` 影片操作列入口；`extractor.js` 字幕讀取；`core.js` 字幕及摘要格式。

官方文件：[Google Gemma](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)、[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[DeepSeek](https://api-docs.deepseek.com/)、[OpenRouter](https://openrouter.ai/docs/api/reference/overview)、[Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[Node Child Process](https://nodejs.org/docs/latest-v24.x/api/child_process.html)。
