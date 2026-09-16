require("dotenv").config();
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const Anthropic = require("@anthropic-ai/sdk");

const PORT = process.env.PORT || 3000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const ACCESS_CODE = process.env.ACCESS_CODE || "";
const AUTH_COOKIE = "sprout_auth";
const AUTH_TOKEN = ACCESS_CODE ? crypto.createHash("sha256").update(ACCESS_CODE).digest("hex") : null;

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    "\n[警告] 找不到 ANTHROPIC_API_KEY，請先複製 .env.example 成 .env 並貼上你的 API 金鑰，否則 AI 老師無法回覆學生。\n"
  );
}
if (ACCESS_CODE) {
  console.log("[通關密碼] 已啟用，學生需要輸入密碼才能使用。");
} else {
  console.log("[通關密碼] 未設定 ACCESS_CODE，目前任何人拿到網址都能直接使用，僅建議在本機測試時這樣。");
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function isAuthed(req) {
  if (!AUTH_TOKEN) return true;
  return req.cookies && req.cookies[AUTH_COOKIE] === AUTH_TOKEN;
}

const GRADES = {
  low: {
    label: "國小低年級",
    sub: "1〜2 年級",
    guidance:
      "這是國小低年級（1〜2年級）學生。只能用最具體、最生活化的方式：實物數數、畫圖、畫小圓圈、擺手指、10以內或20以內的加減法直式。絕對不可以使用「未知數」「x」「方程式」等抽象符號。句子要非常簡短、用詞簡單，多用「蘋果」「糖果」「小狗」之類具體例子。",
  },
  mid: {
    label: "國小中年級",
    sub: "3〜4 年級",
    guidance:
      "這是國小中年級（3〜4年級）學生。可以用列式計算、簡單的乘除法直式、分數與小數的初步概念，應用題引導學生把題目「列成算式」再代入數字計算，也可以畫圖或畫表格輔助。不要使用代數未知數 x 來解方程式。",
  },
  high: {
    label: "國小高年級",
    sub: "5〜6 年級",
    guidance:
      "這是國小高年級（5〜6年級）學生。可以使用列式、分數與小數混合運算、簡單比例、面積與體積公式。遇到需要求未知數時，可以用「□」或「假設這個數是多少」的方式引導思考，但避免直接套用國中的 x 代數方程式正式解法。",
  },
  junior: {
    label: "國中",
    sub: "7〜9 年級",
    guidance:
      "這是國中（7〜9年級）學生，已學過代數基礎。視題目需要，可以使用 x、y 等代數符號、方程式、函數、坐標平面等國中課綱內容，並使用較正式的數學／科學用語，但說明時仍要清楚白話，不要跳步驟。",
  },
};

function buildSystemPrompt(grade) {
  const g = GRADES[grade];
  return (
    `你是一位溫暖、有耐心的台灣國中小數學與自然科家教老師，正在陪一位「${g.label}（${g.sub}）」的學生一步一步解題。\n` +
    "請務必遵守以下規則：\n" +
    "1. 絕對不要直接說出最終答案或直接給完整解法。你的任務是用提問引導學生自己想出來。\n" +
    "2. 學生第一次提出題目時，不要只反問「你的想法是什麼」讓他覺得被晾在原地——先用一句話幫他起頭：點出這題用到的方向或第一步（例如「這是加法，先把兩個數字排出來看看」「可以先畫圖把題目的東西畫出來」），給他一個具體可以馬上動手的切入點，最多再接一個簡單問題請他接手做做看，不要連續問好幾個問題。\n" +
    "3. 學生回答後，先判斷對錯：\n" +
    "   - 如果對：用一句話具體稱讚他做對的地方，然後直接給下一步的方向或問一個問題引導他往下走。\n" +
    "   - 如果錯：不要直接說「這是錯的」或講出正解，用一個提問或一個小提示引導他自己發現問題，例如「這兩個數字加起來會等於題目說的答案嗎？」「要不要再檢查一次這一步？」，不要拖泥帶水。\n" +
    "4. 只有當學生對同一個卡點連續卡住兩到三次、真的想不出來時，才可以給更明確、更具體的提示（可以拆解成更小的步驟，或給部分算式），但仍盡量留最後一小步讓學生自己完成。\n" +
    "5. 每次回覆一定要簡短聚焦：最多3句話、最多問一個問題，不要鋪陳、不要重複題目、不要一次問好幾件事。目標是讓學生覺得每次都有拿到實際幫助往前走，而不是一直被反問。\n" +
    `6. 用詞與解法方式必須符合台灣課綱在這個年段的習慣：${g.guidance}\n` +
    "7. 語氣要像親切的家教老師或大哥哥大姊姊，溫暖、真誠、有耐心，避免生硬或否定的語氣（不要說「錯了」，可以說「我們再想想看」）。可以偶爾用一點點可愛的語助詞，但不要過度浮誇。\n" +
    "8. 當學生完全想通、算出正確答案後，用這個年紀聽得懂的話，簡短總結這一題背後的數學或科學概念是什麼，並給予具體、真誠的鼓勵，肯定他自己想出來的過程。\n" +
    "9. 回覆一律使用繁體中文、純文字，不要使用 markdown 符號（不要用 **、#、- 條列符號），可以用換行分段。數學式用一般文字符號如 × ÷ + － ＝ 表示，不要用 LaTeX。\n" +
    "10. 如果學生輸入的不是數學或自然科的題目，溫和地回應，並引導他分享一道數學或自然科的題目。\n" +
    "11. 如果這則訊息附上了照片：請先簡短複述你從照片中看到的題目內容（例如關鍵數字或題目大意），讓學生知道你有看到、看對了；接著仍然要依照第2〜5點的引導方式陪他一步步想，絕對不可以因為自己看得出解法，就跳過引導直接把整題解出來或講出答案。如果照片看不清楚，就溫和地請學生用打字補充題目內容。"
  );
}

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_MESSAGE_LENGTH = 800;
const MAX_HISTORY_TURNS = 40;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 20;
const rateLimitMap = new Map();

function isRateLimited(key) {
  const now = Date.now();
  const recent = (rateLimitMap.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitMap.set(key, recent);
  return recent.length > RATE_LIMIT_MAX;
}

const app = express();
app.set("trust proxy", true);
app.use(express.json({ limit: "12mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/session", (req, res) => {
  res.json({ authenticated: isAuthed(req), gateEnabled: Boolean(AUTH_TOKEN) });
});

app.post("/api/login", (req, res) => {
  if (!AUTH_TOKEN) {
    return res.json({ ok: true });
  }
  const code = (req.body && req.body.code) || "";
  if (code !== ACCESS_CODE) {
    return res.status(401).json({ error: "密碼不對，再檢查一下試試看！" });
  }
  res.cookie(AUTH_COOKIE, AUTH_TOKEN, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ ok: true });
});

app.post("/api/tutor", async (req, res) => {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: "請先輸入通關密碼再使用喔。" });
  }
  if (isRateLimited(req.ip)) {
    return res.status(429).json({ error: "問太快囉，休息幾秒鐘再送出看看！" });
  }
  try {
    const { grade, history, message, image } = req.body || {};

    if (!GRADES[grade]) {
      return res.status(400).json({ error: "年級參數不正確，請重新整理頁面再試一次。" });
    }
    const text = typeof message === "string" ? message.trim() : "";
    if (!text && !image) {
      return res.status(400).json({ error: "請輸入題目內容或附上照片再送出喔。" });
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({ error: "這段內容有點太長囉，可以精簡一下再送出嗎？" });
    }
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "對話紀錄格式不正確，請重新整理頁面再試一次。" });
    }

    let imageBlock = null;
    if (image) {
      if (!image.dataBase64 || !ALLOWED_IMAGE_TYPES.includes(image.mediaType)) {
        return res.status(400).json({ error: "這張照片老師看不了（格式不支援），換一張照片，或用打字告訴老師題目內容吧！" });
      }
      const approxBytes = (image.dataBase64.length * 3) / 4;
      if (approxBytes > MAX_IMAGE_BYTES) {
        return res.status(400).json({ error: "這張照片檔案有點大，換一張小一點的照片試試看吧！" });
      }
      imageBlock = {
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.dataBase64 },
      };
    }

    const trimmedHistory = history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: String(turn.content || "").slice(0, MAX_MESSAGE_LENGTH * 2),
    }));

    const newUserContent = imageBlock
      ? [imageBlock, { type: "text", text: text || "（這是我的題目照片，麻煩老師看一下）" }]
      : text;

    const messages = [...trimmedHistory, { role: "user", content: newUserContent }];

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 700,
      system: [
        {
          type: "text",
          text: buildSystemPrompt(grade),
          cache_control: { type: "ephemeral" },
        },
      ],
      messages,
    });

    const reply = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!reply) {
      return res.status(502).json({ error: "老師好像沒聽懂，可以再多說一點題目的內容嗎？" });
    }

    res.json({ reply });
  } catch (err) {
    console.error("Anthropic API 呼叫失敗：", err && err.message ? err.message : err);
    res.status(502).json({ error: mapAnthropicError(err) });
  }
});

function mapAnthropicError(err) {
  const status = err && err.status;
  const type = err && err.error && err.error.error && err.error.error.type;
  if (status === 401 || type === "authentication_error") {
    return "後端的 API 金鑰好像有問題，請檢查 .env 裡的 ANTHROPIC_API_KEY 是否正確。";
  }
  if (status === 429 || type === "rate_limit_error") {
    return "哎呀，小老師剛剛有點忙不過來，休息幾秒鐘再按一次送出看看！";
  }
  if (status === 413) {
    return "這則訊息（或照片）有點太大了，精簡一下再送出吧！";
  }
  if (status === 529 || type === "overloaded_error") {
    return "現在問問題的人有點多，老師稍微塞車了，等一下再試試看！";
  }
  return "網路好像打嗝了，再按一次送出試試看吧！";
}

app.listen(PORT, () => {
  console.log(`小樹苗學堂已啟動：http://localhost:${PORT}`);
});
