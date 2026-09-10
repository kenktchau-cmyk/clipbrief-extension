# 片刻 ClipBrief 0.8.1

[English](README.md) | [繁體中文](README.zh-TW.md)

Chrome Manifest V3 影片摘要擴充功能，可讀取 YouTube、Bilibili 或一般 HTML5 影片的可用字幕，產生內容簡介、重點及時間軸。YouTube／Bilibili 會在留言區頂部顯示摘要卡，點選時間標記即可跳轉至影片的對應位置。

支援 **Google Gemma／Gemini** 及 **OpenAI Chat Completions 相容 API**。每位使用者在自己的本機後端設定供應商、API 網址、模型及金鑰。原始碼、Chrome 擴充功能及下載套件均不包含使用者金鑰。

## 安裝與設定

1. 下載或複製此儲存庫，並準備 Node.js 24.5 或以上版本。沒有 npm 相依套件，也不需要編譯。
2. 在儲存庫根目錄啟動本機後端：

   ```sh
   node --use-system-ca scripts/preview.mjs
   ```

3. 開啟[本機 API 設定頁](http://127.0.0.1:4173/setup.html)，選擇供應商／API 格式，填入網址及自己的金鑰，按「讀取可用模型」，從下拉選單選擇模型，或手動輸入 ID，再按「儲存到本機後端」。儲存後立即生效，金鑰欄位會清空。
4. 按「複製插件連線碼」。
5. 使用 Chrome 120 或以上版本開啟 `chrome://extensions`，啟用開發人員模式，按「載入未封裝項目」，選擇包含 `manifest.json` 的儲存庫根目錄。也可以使用 `python scripts/package.py` 產生的 `clipbrief-extension-0.8.1.zip`，解壓縮後再載入。
6. 開啟片刻側邊欄，選擇齒輪圖示中的「後端設定」，貼上連線碼，再按「連接並儲存後端」，授權存取本機網址。
7. 開啟 YouTube／Bilibili 影片，按讚／分享操作列中的「片刻摘要」。其他網站可使用 Chrome 工具列的片刻圖示，再按「擷取目前影片」。
8. 檢視字幕、選擇語言及長度，再按「生成影片摘要」。YouTube／Bilibili 摘要生成完成後，摘要及時間軸會自動顯示在留言區上方。

如需更換 AI 服務，可在片刻齒輪設定中開啟 API 金鑰設定連結，或直接開啟本機設定頁。切換供應商或網址時，需要重新輸入對應的金鑰，不會自動沿用其他供應商的金鑰。

如果後端已儲存同一 API 的金鑰，可以將金鑰欄位留空，直接讀取清單或更換模型。讀取清單不會修改已儲存的設定，選擇模型後仍須按儲存。切換供應商、網址或輸入新金鑰時，會清除舊清單並取消先前的查詢。

Google 清單使用官方 `models.list`，並篩選支援 `generateContent` 的模型；OpenAI 相容服務使用基底網址下的 `/models`。清單不保證模型適用於文字 Chat Completions，也不代表帳戶已有生成權限或額度，請選擇文字對話模型。若 API 未提供清單、清單為空或查詢失敗，可手動輸入 ID。查詢最多持續 20 秒、讀取 10 頁及 5,000 個模型，每頁回覆最多 4 MiB；超過頁數或數量限制時，會標示為部分清單。

後端必須保持執行。每次重新啟動後端，連線碼都會更新，請重新複製至 Chrome 擴充功能。此連線碼僅授權存取本機摘要服務，並非供應商的 API 金鑰。

## 支援的 API

| 選項 | 設定方式 |
| --- | --- |
| Google · Gemma / Gemini | 使用 Google 原生 Gemini API，網址固定為官方 `https://generativelanguage.googleapis.com/v1beta`。預設模型為 `gemma-4-26b-a4b-it`，也可填入帳戶能夠存取的其他 Gemma／Gemini 模型 ID。 |
| OpenAI | 預填 `https://api.openai.com/v1`；請填入帳戶可使用且支援 Chat Completions 的模型 ID 及金鑰。 |
| 自訂 · OpenAI 相容 API | 自行填入供應商的 API 基底網址、模型及金鑰，例如 DeepSeek、OpenRouter 等相容服務。後端會呼叫 `/chat/completions`。 |

API 網址須使用 HTTPS；只有 `localhost`／`127.0.0.1` 可使用 HTTP。網址不得包含帳號密碼、查詢參數或片段識別碼。「強制 JSON 模式」預設關閉，僅在所選模型支援時啟用。即使關閉，提示仍會要求 JSON，並驗證摘要結構。

自訂 API 必須相容於 Chat Completions 的 `messages`、Bearer 驗證及 `choices[].message.content` 回覆格式，並不表示支援任意 API 協定。原生 Anthropic Messages、僅支援 Responses 的模型等協定目前尚未整合。模型權限、上下文限制、額度及收費取決於所選供應商與帳戶。儲存設定時只驗證格式並安全保存資料，實際生成摘要時才會驗證連線及模型權限。

## 自動取得轉錄稿與快捷鍵

0.8.1 修正 YouTube 新版「字幕記錄」的支援，同時辨認 `PAmodern_transcript_view`／`transcript-segment-view-model` 及舊版轉錄稿。已開啟的字幕記錄會優先讀取；自動開啟時，會等待字幕列數短暫穩定後再擷取。

以使用者提供的影片 `04fjBk7KqII` 進行實際 DOM 驗證，新版選擇器讀取到 123 段、7,180 字元，時間標記由 0:00 至 16:24。此次驗證確認了真實頁面的讀取結果，但不代表已完成 Comet 中已安裝擴充功能的端對端測試。

按 YouTube 影片下方的「片刻摘要」或側邊欄的「擷取目前影片」時，會先讀取可用字幕。字幕不足時，會自動展開影片說明、開啟轉錄稿、等待文字載入，再擷取文字及時間標記。不需要先手動開啟轉錄稿，也不會自動將字幕傳送至 AI；只有按「生成影片摘要」後才會發出 AI 請求。程式只讀取頁面已載入的內容，長影片請確認字幕完整度。影片沒有字幕或網站未能載入字幕時，仍可重試或手動匯入。

在 YouTube 一般影片頁按 **Alt + Shift + T**，片刻會展開影片說明並開啟「顯示轉錄稿」。若轉錄稿已開啟，會捲動至其所在位置，不會將其關閉。此操作不需要 AI 金鑰，也不會生成摘要。

如需自訂快捷鍵，請在 Comet 網址列輸入 `comet://extensions/shortcuts`，Chrome 則使用 `chrome://extensions/shortcuts`，然後在「片刻 ClipBrief」下修改「打開 YouTube 轉錄稿」。如果預設組合已被其他程式使用，請在此頁設定其他組合。

升級後，請在 `comet://extensions`／`chrome://extensions` 按片刻卡片的重新載入按鈕，再重新整理 YouTube。若尚未安裝，請先依照上述步驟載入最新目錄。

快捷鍵只適用於 YouTube `/watch` 影片頁，暫不支援 Shorts、Bilibili 或其他網站。影片必須提供轉錄稿；等待約 12 秒仍未找到時，會顯示提示。程式優先辨認 YouTube 轉錄稿區塊，也支援繁體中文、簡體中文及英文按鈕文字。YouTube 改版可能需要更新選擇器。重複按鍵不會重複開啟轉錄稿，切換影片會取消先前的操作。

## 留言區摘要與其他功能

- 留言區頂部的摘要卡會同時顯示影片簡介、內容重點及時間軸，可收合或展開；點選時間標記即可定位播放器。
- 摘要卡只在使用者自己的瀏覽器中顯示，**不會發布成留言**，也不會影響原有留言。
- 留言區延遲載入或被網站重新建立時，會自動重新插入摘要卡，並避免重複。切換影片或 Bilibili 分 P 時會移除舊摘要，避免顯示其他影片的內容。
- YouTube／Bilibili 影片操作列會加入「片刻摘要」按鈕。此按鈕只會開啟側邊欄及讀取字幕，按「生成」後才會發送 AI 請求。
- 支援繁體中文、廣東話或英文輸出，並提供精簡、標準及詳細長度。
- 支援 TXT、SRT、VTT、字幕 JSON 匯入，或手動貼上逐字稿。
- 最多處理 180,000 字元；長字幕會分段整理再合併，生成前會顯示預計請求次數。
- 支援取消生成、複製摘要及匯出 Markdown。
- 固定示範標示為「內置示範」，透過真實 AI 生成的示範字幕摘要標示為「AI 實測」。

| 網站 | 字幕來源與限制 |
| --- | --- |
| YouTube | 目前影片的字幕軌；無法讀取時，會自動開啟轉錄稿再擷取。可能受登入要求、簽署網址、頁面載入及網站改版影響，失敗時可手動貼上。 |
| Bilibili | 目前 BV／av 影片及分 P 的字幕資料；可能受登入要求、風險控制機制或網站改版影響，也可匯入字幕。 |
| 一般 HTML5 網站 | 主框架播放器的 TextTrack 或可讀取的字幕檔。跨來源 iframe、自訂播放器或沒有字幕的影片可能需要手動提供逐字稿。一般網站暫不支援留言區摘要卡。 |

此版本僅提供字幕摘要，尚未提供畫面分析或自動錄音轉錄。請檢查擷取的字幕是否完整。時間軸只保留能與輸入字幕核對的時間值。留言區關閉或網站未提供可辨認的容器時，仍可在側邊欄閱讀摘要。重新載入頁面後，需要再次生成摘要。

## 金鑰與資料流

```text
影片頁 → 片刻側邊欄 → 本機後端 → 所選的 AI API
  ↑                       ↑
留言區摘要卡       API 設定及金鑰只由後端保存
```

- Windows 使用 DPAPI 加密整份供應商設定，儲存於 `server/.secrets/provider-config.dpapi`，並綁定目前的 Windows 帳戶。API 金鑰透過 stdin 傳入加密程序，不會放在命令列或暫存明文檔案中。
- macOS／Linux 透過設定頁提供的設定只保留在後端記憶體中，後端關閉後須重新輸入。Google 也可由執行環境注入 `GEMINI_API_KEY`；Windows 若已有加密的供應商設定，則以該設定為優先。
- 相容舊版 `google-key.dpapi`。升級至多 API 設定後，以新的 `provider-config.dpapi` 為優先。舊 PowerShell 設定指令僅適用於尚未建立多 API 設定時的 Google 初始配置。
- 金鑰輸入欄位只位於獨立的本機設定頁。讀取模型清單時，金鑰會傳送至本機 `/api/models`；儲存時會傳送至 `/api/provider`，並清空欄位。金鑰不會儲存在 localStorage／sessionStorage。讀取清單不會保存新金鑰；Chrome 擴充功能及影片頁不會收到供應商金鑰。
- 設定端點會驗證相同來源、特定標頭及連線碼。其他網站，甚至持有連線碼的 Chrome 擴充功能，都無法修改供應商設定。
- 摘要請求只接受標題、字幕及輸出選項。供應商、網址、模型及金鑰由後端管理，摘要客戶端無法覆寫。
- 後端只監聽 `127.0.0.1`，並驗證 Host、Origin、連線碼及資料大小。同時最多執行一個摘要工作，每小時最多 30 個工作。
- 靜態服務只提供明確列出的介面檔案。後端原始碼、`.secrets`、`.env`、`.git`、日誌、ZIP 及路徑穿越請求，均無法透過網站讀取。
- Git 及 ZIP 排除金鑰、日誌及本機資料。Chrome CSP 只允許連接本機後端；Chrome 本機儲存空間只保存後端網址及連線碼，不會將金鑰同步至 Google 帳戶。
- 沒有遙測或雲端歷史紀錄，字幕及摘要不會寫入後端磁碟。AI 請求不會攜帶瀏覽器 Cookie，也不會跟隨重新導向；讀取影片字幕時，會使用原網站播放內容所需的權限。
- 取消生成會中止後端工作，但已送出的請求仍可能計費。每位使用者使用自己帳戶的額度。

## 開發、打包與驗證

```sh
node --test tests/*.test.js
python scripts/package.py
```

輸出檔案位於 `artifacts/`，包括 Chrome 客戶端 ZIP 及後端完整程式 ZIP，兩者均使用指定檔案清單並檢查金鑰模式。需要重製圖示時，可執行 `scripts/icons.py`，此操作需要 Pillow；一般安裝及啟動則不需要。

後端啟動後，可以開啟：

- [多 API 設定頁](http://127.0.0.1:4173/setup.html)
- [摘要側邊欄預覽](http://127.0.0.1:4173/panel.html?demo=1)
- [YouTube／Bilibili 操作列預覽](http://127.0.0.1:4173/action-bars-preview.html)
- [留言區摘要與時間軸預覽](http://127.0.0.1:4173/comments-preview.html)

67 項自動化測試已通過，涵蓋字幕、分段合併、Google／OpenAI 格式、後端 HTTP、設定權限、金鑰隔離、模型清單分頁與限制、僅限同一服務沿用金鑰、切換失敗時保留原有設定、錯誤資訊遮蔽、請求限流、取消及影片身分驗證。自動擷取及轉錄稿快捷鍵測試涵蓋直接字幕、沒有字幕時自動開啟轉錄稿再擷取、來源分頁、展開說明、已開啟轉錄稿的處理、缺少字幕、不同語言按鈕、重複操作，以及切換影片時取消操作。這些測試使用模擬 DOM，尚未完成 Comet 真實影片快捷鍵的端對端測試。Windows 加密設定的儲存及解密亦已使用獨立合成資料驗證。瀏覽器預覽確認，時間軸 `1:34` 會將播放器定位至 94 秒，切換影片會移除舊卡片，重複更新只會保留一張卡片。

Google Gemma 4 已使用內建字幕，透過本機後端完成真實摘要生成。模型選單也已使用後端儲存的金鑰，實際讀取 Google 模型清單，並確認手動輸入及切換服務時清除舊清單的行為。其他 API 使用模擬回覆驗證，尚未逐一使用真實供應商帳戶測試。實際 Chrome 安裝及真實 YouTube／Bilibili 完整端對端測試尚未完成；網站 DOM 改版可能需要更新選擇器。本擴充功能尚未上架 Chrome Web Store。

模型清單官方文件：[Google models.list](https://ai.google.dev/api/models)、[OpenAI List models](https://developers.openai.com/api/reference/resources/models/methods/list)。

主要檔案：`panel.js` 負責使用者流程；`api.js` 為本機客戶端；`server/app.js` 負責後端驗證；`server/ai-provider.js` 負責 API 轉換；`server/key-store.js` 負責加密儲存；`setup.*` 為 API 設定頁；`inline-summary.js` 負責留言區卡片；`action-button.js` 為影片操作列入口；`extractor.js` 負責字幕讀取；`core.js` 定義字幕及摘要格式。

官方文件：[Google Gemma](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api)、[OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[DeepSeek](https://api-docs.deepseek.com/)、[OpenRouter](https://openrouter.ai/docs/api/reference/overview)、[Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[Node Child Process](https://nodejs.org/docs/latest-v24.x/api/child_process.html)。
