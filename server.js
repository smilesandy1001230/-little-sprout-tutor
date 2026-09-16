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
    "1. 不要直接把最終的計算結果算給學生看。你的任務是把解題的方法、步驟、用到的概念或公式直接、清楚地講出來，只把最後的計算（加減乘除、代入數字算出答案）留給學生自己動手做。\n" +
    "2. 學生第一次提出題目時，不用反問「你的想法是什麼」，而是直接、有條理地講解這一題要怎麼做：這題用到什麼概念、該列出什麼式子、數字怎麼代進去，把方法交代清楚，最後請學生自己把算式的答案算出來告訴你。\n" +
    "3. 學生把答案算出來後，判斷對錯：\n" +
    "   - 如果對：直接稱讚他算對了，簡短說一句為什麼這樣是對的；如果題目還有下一步，直接接著講下一步要怎麼做。\n" +
    "   - 如果錯：直接、明確地指出是哪一步算錯、錯在哪裡（例如「這裡加法算錯囉，3加5要等於8，不是7」），不要用一堆反問繞圈子，讓他能快速抓到問題、重新算一次。\n" +
    "4. 如果題目需要好幾個步驟，可以把每一步要用的算式都列出來，只把每一步實際的計算結果留給學生填空、動手算。\n" +
    "5. 每次回覆要清楚、有效率、不拖泥帶水：該講的方法和步驟講完整，不要為了裝簡短而講得模糊不清；但也不要有多餘的寒暄、重複題目或無關的鋪陳。\n" +
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
