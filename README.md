# 片刻 ClipBrief 0.8.1

[English](README.md) | [繁體中文](README.zh-TW.md)

A Chrome Manifest V3 extension that summarizes readable captions from YouTube, Bilibili, and other HTML5 videos into an overview, key points, and a timeline. On YouTube and Bilibili, a summary card appears above the comments, with timestamps that seek to the corresponding point in the video.

Supports **Google Gemma / Gemini** and **OpenAI Chat Completions-compatible APIs**. Each user configures their own provider, API URL, model, and key in the local backend. The source code, Chrome extension, and download packages contain no user API keys.

## Installation and setup

1. Download or clone this repository and install Node.js 24.5 or later. No npm dependencies or build step are required.
2. Start the local backend from the repository root:

   ```sh
   node --use-system-ca scripts/preview.mjs
   ```

3. Open the [local API setup page](http://127.0.0.1:4173/setup.html). Choose the provider / API format and enter the URL and your key. Click “讀取可用模型” (fetch available models), select a model from the dropdown or enter its ID manually, then click “儲存到本機後端” (save to local backend). Changes take effect immediately after saving, and the key field is cleared.
4. Click “複製插件連線碼” (copy extension connection code).
5. In Chrome 120 or later, open `chrome://extensions`, enable Developer mode, click **Load unpacked**, and select the repository root containing `manifest.json`. Alternatively, generate `clipbrief-extension-0.8.1.zip` with `python scripts/package.py`, extract it, and load that directory.
6. Open the ClipBrief sidebar, select the gear icon and “後端設定” (backend settings), paste the connection code, and click “連接並儲存後端” (connect and save backend). Grant access to the local URL.
7. Open a YouTube or Bilibili video and click “片刻摘要” in the like/share action bar. On other sites, click the ClipBrief icon in Chrome's toolbar, then “擷取目前影片” (capture current video).
8. Review the captions, choose an output language and length, and click “生成影片摘要” (generate video summary). On YouTube and Bilibili, the completed summary and timeline appear automatically above the comments.

To switch AI services, choose “輸入／更新自己嘅 API Key” (enter or update your own API key) in the gear settings, or open the local setup page directly. Changing the provider or URL requires the corresponding key; a key from another provider is never reused automatically.

If the backend already has a key for the same API, leave the key field blank to fetch the model list or change models. Fetching the list does not change saved settings: save after selecting a model. Changing the provider or URL, or entering a new key, clears the old list and cancels the previous query.

Google model discovery uses the official `models.list` endpoint and filters for models supporting `generateContent`. OpenAI-compatible services use `/models` under the base URL. Listing a model does not guarantee that it supports text Chat Completions or that your account has generation access or quota; select a text chat model. Enter an ID manually if the API has no model list, returns an empty list, or the query fails. Queries are limited to 20 seconds, 10 pages, and 5,000 models, with a maximum response size of 4 MiB per page. Results are marked as partial if the page or model limit is reached.

Keep the backend running. Its connection code changes on every restart, so copy the new code into the Chrome extension. This code authorizes access to the local summary service; it is not a provider API key.

## Supported APIs

| Option | Configuration |
| --- | --- |
| Google · Gemma / Gemini | Uses Google's native Gemini API at the fixed official URL `https://generativelanguage.googleapis.com/v1beta`. The default model is `gemma-4-26b-a4b-it`; you can enter another Gemma / Gemini model ID that your account can access. |
| OpenAI | Prefills `https://api.openai.com/v1`. Enter your key and a model ID that your account can use with Chat Completions. |
| Custom · OpenAI-compatible API | Enter the provider's API base URL, model, and key, for example for compatible services such as DeepSeek or OpenRouter. The backend calls `/chat/completions`. |

API URLs must use HTTPS, except that `localhost` and `127.0.0.1` may use HTTP. URLs cannot contain credentials, query parameters, or fragments. “強制 JSON 模式” (force JSON mode) is off by default; enable it only if the selected model supports it. Even when it is off, the prompt requests JSON and the summary structure is validated.

Custom APIs must support Chat Completions `messages`, Bearer authentication, and the `choices[].message.content` response format. Other API protocols are not automatically supported: native Anthropic Messages and Responses-only models are not integrated. Model access, context limits, quota, and pricing depend on the selected provider and account. Saving settings validates their format and stores them securely; actual connectivity and model access are checked when generating a summary.

## Automatic transcripts and keyboard shortcut

Version 0.8.1 fixes support for YouTube's new transcript interface, recognizing both `PAmodern_transcript_view` / `transcript-segment-view-model` and the older transcript layout. An already-open transcript takes priority. When opening one automatically, extraction waits briefly for the number of caption rows to stabilize.

Verification against the real DOM of the user-provided video `04fjBk7KqII` extracted 123 segments and 7,180 characters, with timestamps from 0:00 to 16:24. This verified reading a real page; it did not complete an end-to-end test of the installed extension in Comet.

Clicking “片刻摘要” below a YouTube video or “擷取目前影片” (capture current video) in the sidebar first reads available captions. If they are insufficient, the extension expands the video description, opens the transcript, waits for text to load, and extracts text and timestamps. You do not need to open the transcript manually. Captions are sent to AI only after clicking “生成影片摘要” (generate video summary). Only content already loaded on the page is read, so check completeness for long videos. If captions are unavailable or the site fails to load them, retry or import a transcript manually.

Press **Alt + Shift + T** on a regular YouTube video page to expand the description and open **Show transcript**. If the transcript is already open, the extension scrolls to it without closing it. This action needs no AI key and does not generate a summary.

To customize the shortcut, open `comet://extensions/shortcuts` in Comet or `chrome://extensions/shortcuts` in Chrome. Under “片刻 ClipBrief”, change “打開 YouTube 轉錄稿” (open YouTube transcript). Choose another combination there if the default conflicts with another application.

After upgrading, reload the ClipBrief extension card at `comet://extensions` / `chrome://extensions`, then refresh YouTube. If the extension is not installed, load the latest directory using the installation steps above.

The shortcut works only on YouTube `/watch` pages, not Shorts, Bilibili, or other sites. The video must provide a transcript; a message appears if none is found after about 12 seconds. Detection prioritizes YouTube's transcript container and also supports Traditional Chinese, Simplified Chinese, and English button labels. YouTube layout changes may require updates. Repeated key presses do not open duplicate transcripts, and switching videos cancels the previous operation.

## Summary cards and other features

- A collapsible card above the comments displays the overview, key points, and timeline. Click a timestamp to seek the player.
- The card is visible only in your own browser and **is not posted as a comment**. Existing comments are unaffected.
- If the comments load late or the site rebuilds them, the card is reinserted without duplicates. Switching videos or Bilibili parts removes the old summary to avoid displaying it for the wrong video.
- A “片刻摘要” button is added to YouTube and Bilibili video action bars. It opens the sidebar and reads captions; an AI request starts only after clicking Generate.
- Output in Traditional Chinese, Cantonese, or English, with concise, standard, and detailed lengths.
- Import TXT, SRT, VTT, or subtitle JSON, or paste a transcript manually.
- Up to 180,000 characters. Long captions are summarized in chunks and merged; the estimated request count is shown before generation.
- Cancel generation, copy the summary, or export Markdown.
- Static examples are labeled “內置示範” (built-in demo). Summaries generated by a real AI service from demo captions are labeled “AI 實測” (live AI test).

| Site | Caption sources and limitations |
| --- | --- |
| YouTube | Caption tracks for the current video, with automatic transcript opening and extraction as a fallback. Login requirements, signed URLs, page loading, and site changes can affect access. Paste a transcript manually if extraction fails. |
| Bilibili | Caption data for the current BV / av video and part. Login requirements, anti-abuse controls, or site changes may interfere. Subtitle import is available. |
| Other HTML5 sites | The main-frame player's TextTrack or readable subtitle files. Cross-origin iframes, custom players, or videos without captions may require a manual transcript. Comment-area summary cards are not currently supported on these sites. |

This version summarizes captions; it does not analyze video frames or automatically record and transcribe audio. Check that the extracted captions are complete. The timeline retains only timestamps that can be verified against the input captions. If comments are disabled or no recognizable container is available, the summary remains readable in the sidebar. Regenerate the summary after reloading the page.

## API keys and data flow

```text
Video page → ClipBrief sidebar → Local backend → Your selected AI API
    ↑                                 ↑
Summary card above comments    API settings and keys stay in the backend
```

- On Windows, DPAPI encrypts the entire provider configuration at `server/.secrets/provider-config.dpapi`, bound to the current Windows account. API keys are passed to the encryption process through stdin, never as command-line arguments or temporary plaintext files.
- On macOS / Linux, settings entered through the setup page stay only in backend memory and must be entered again after shutdown. Google also supports the `GEMINI_API_KEY` environment variable. On Windows, an existing encrypted provider configuration takes precedence.
- The legacy `google-key.dpapi` format remains supported. After configuring multiple APIs, the new `provider-config.dpapi` takes precedence. The old PowerShell setup command is only for initial Google configuration before a multi-API configuration exists.
- Key fields exist only on the separate local setup page. Fetching models sends the key to local `/api/models`; saving sends it to `/api/provider` and clears the field. Keys are not stored in localStorage or sessionStorage. Fetching a list does not save a new key. The Chrome extension and video page never receive the provider key.
- Configuration endpoints validate the same origin, a specific header, and the connection code. Other websites, and even a Chrome extension holding the connection code, cannot change provider settings.
- Summary requests accept only the title, captions, and output options. The backend manages the provider, URL, model, and key; summary clients cannot override them.
- The backend listens only on `127.0.0.1` and validates Host, Origin, the connection code, and payload size. It permits one concurrent summary job and up to 30 jobs per hour.
- Static serving exposes only an explicit list of interface files. Backend source, `.secrets`, `.env`, `.git`, logs, ZIP files, and path-traversal requests cannot be read through the web server.
- Git and ZIP packages exclude keys, logs, and local data. Chrome's CSP permits connections only to the local backend. Chrome local storage keeps only the backend URL and connection code; keys are not synced to a Google account.
- There is no telemetry or cloud history. Captions and summaries are not written to backend disk. AI requests carry no browser cookies and do not follow redirects; caption retrieval uses the permissions needed to play content on the original site.
- Cancellation aborts the backend job, but requests already sent may still be billed. Each user consumes their own account's quota.

## Development, packaging, and validation

```sh
node --test tests/*.test.js
python scripts/package.py
```

Packages are written to `artifacts/`: a Chrome client ZIP and a complete backend source ZIP. Both use explicit file lists and scan for key patterns. Regenerate icons with `scripts/icons.py` if needed; this requires Pillow, which is not needed for normal installation or startup.

With the backend running, open:

- [Multi-API setup](http://127.0.0.1:4173/setup.html)
- [Summary sidebar preview](http://127.0.0.1:4173/panel.html?demo=1)
- [YouTube / Bilibili action-bar preview](http://127.0.0.1:4173/action-bars-preview.html)
- [Comment-area summary and timeline preview](http://127.0.0.1:4173/comments-preview.html)

The project has passed 67 automated tests covering captions, chunking and merging, Google / OpenAI formats, backend HTTP, configuration permissions, key isolation, model-list pagination and limits, key reuse restricted to the same service, preservation of settings after a failed switch, error masking, rate limits, cancellation, and video identity validation. Automatic extraction and transcript shortcut tests cover direct captions, opening and extracting a transcript when captions are missing, the source tab, expanding the description, an already-open transcript, missing captions, button labels in different languages, repeated actions, and cancellation on video changes. These tests use a mock DOM; a real-video shortcut end-to-end test in Comet has not been completed. Windows encrypted configuration saving and decryption were also verified separately with synthetic data. Browser previews confirmed that clicking `1:34` seeks to 94 seconds, changing videos removes the old card, and repeated updates leave only one card.

Google Gemma 4 has generated a real summary from the built-in captions through the local backend. The model dropdown was also tested against Google's real model list using the backend's saved key, including manual ID entry and clearing the old list when switching services. Other APIs were verified with mocked responses, not individually tested with real provider accounts. Actual Chrome installation and full end-to-end tests on real YouTube / Bilibili videos remain incomplete. Site DOM changes may require selector updates. The extension is not published on the Chrome Web Store.

Official model-list documentation: [Google models.list](https://ai.google.dev/api/models), [OpenAI List models](https://developers.openai.com/api/reference/resources/models/methods/list).

Main files: `panel.js` — user flow; `api.js` — local client; `server/app.js` — backend validation; `server/ai-provider.js` — API adaptation; `server/key-store.js` — encrypted storage; `setup.*` — API setup page; `inline-summary.js` — comment-area card; `action-button.js` — video action-bar entry point; `extractor.js` — caption extraction; `core.js` — caption and summary formats.

Official documentation: [Google Gemma](https://ai.google.dev/gemma/docs/core/gemma_on_gemini_api), [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [DeepSeek](https://api-docs.deepseek.com/), [OpenRouter](https://openrouter.ai/docs/api/reference/overview), [Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs), [Node Child Process](https://nodejs.org/docs/latest-v24.x/api/child_process.html).
