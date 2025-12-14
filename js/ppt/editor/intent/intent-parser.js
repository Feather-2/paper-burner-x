/**
 * Intent Parser - 自然语言 → 结构化 Intent
 * 说明：
 * - 默认使用正则快速命中常见指令
 * - 可选通过 context.llm 进行兜底（不强依赖）
 */
(function initIntentParser(global) {
  function isNonEmptyString(v) {
    return typeof v === "string" && v.trim().length > 0;
  }

  function normalizeInput(input) {
    return String(input || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[，。！？；]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toInt(v) {
    const n = Number.parseInt(String(v), 10);
    return Number.isFinite(n) ? n : null;
  }

  // 仅覆盖常用（1-999），足够解析“第十页/第十二页/第一百页”等
  function chineseNumberToInt(raw) {
    const s = String(raw || "").trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return toInt(s);

    const digit = {
      零: 0,
      〇: 0,
      一: 1,
      二: 2,
      两: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
    };
    const unit = { 十: 10, 百: 100, 千: 1000 };

    let total = 0;
    let current = 0;
    let seenAny = false;

    for (const ch of s) {
      if (Object.prototype.hasOwnProperty.call(digit, ch)) {
        current = digit[ch];
        seenAny = true;
        continue;
      }
      if (Object.prototype.hasOwnProperty.call(unit, ch)) {
        const u = unit[ch];
        if (current === 0) current = 1; // “十” => 10
        total += current * u;
        current = 0;
        seenAny = true;
        continue;
      }
      // 不认识的字符，直接失败
      return null;
    }

    if (!seenAny) return null;
    return total + current;
  }

  function parsePageNumber(token) {
    const n = chineseNumberToInt(token);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
  }

  function makeIntent(type, target, content, constraints) {
    const intent = { type, target: target || {} };
    if (isNonEmptyString(content)) intent.content = content.trim();
    if (constraints && typeof constraints === "object") intent.constraints = constraints;
    return intent;
  }

  function cleanTopic(raw) {
    return String(raw || "")
      .trim()
      .replace(/^关于\s*/, "")
      .replace(/的$/, "")
      .trim();
  }

  function parseByRegex(input, context) {
    const text = normalizeInput(input);
    if (!text) return null;

    const getDefaultSlideIndex = () => {
      const idx = context && typeof context.currentSlideIndex === "number" ? context.currentSlideIndex : null;
      return Number.isFinite(idx) && idx >= 0 ? idx : 0;
    };

    // INSERT_SLIDE: /在第?\s*(\d+)\s*页?(后|前)?新增/
    {
      const m = text.match(
        /在?第?\s*([0-9一二三四五六七八九十百千两〇零]+)\s*页?\s*(后|前|之后|之前|后面|前面)?\s*(?:新增|插入|添加)/,
      );
      if (m) {
        const page = parsePageNumber(m[1]);
        if (page !== null) {
          const dir = String(m[2] || "").trim();
          const position = dir.startsWith("前") ? "before" : "after";
          return makeIntent("INSERT_SLIDE", { slideIndex: page - 1, position });
        }
      }
    }

    // DELETE_SLIDE: /删除.*第?\s*(\d+)/
    {
      const m = text.match(/(?:删除|移除|去掉).*?第?\s*([0-9一二三四五六七八九十百千两〇零]+)\s*(?:页|张)?/);
      if (m) {
        const page = parsePageNumber(m[1]);
        if (page !== null) return makeIntent("DELETE_SLIDE", { slideIndex: page - 1 });
      }
    }

    // REDO_RANGE: “重做第N-M页 / 重做第N到M页”
    {
      const m = text.match(
        /(?:重做|重新设计|重新做|重新生成|重新排版)\s*第?([0-9一二三四五六七八九十百千两〇零]+)\s*(?:-|到|至)\s*([0-9一二三四五六七八九十百千两〇零]+)\s*页/,
      );
      if (m) {
        const a = parsePageNumber(m[1]);
        const b = parsePageNumber(m[2]);
        if (a !== null && b !== null) {
          const start = Math.min(a, b) - 1;
          const end = Math.max(a, b) - 1;
          return makeIntent("REDO_RANGE", { slideRange: [start, end] });
        }
      }
    }

    // REDO_SLIDE: /重做|不喜欢.*第?\s*(\d+)/
    {
      const m = text.match(
        /(?:重做|不喜欢|重新设计|重新做|重新生成|重新排版).*?第?\s*([0-9一二三四五六七八九十百千两〇零]+)\s*(?:页|张)?/,
      );
      if (m) {
        const page = parsePageNumber(m[1]);
        if (page !== null) return makeIntent("REDO_SLIDE", { slideIndex: page - 1 });
      }
    }

    // MODIFY_ELEMENT (no explicit slide): “把标题改成xxx / 将第2页标题改为xxx”
    {
      const m = text.match(
        /(?:把|将)?\s*(?:第?\s*([0-9一二三四五六七八九十百千两〇零]+)\s*(?:页|张)\s*)?(标题|副标题|正文|内容)\s*(?:改成|改为|换成|变成|设置为|设为)\s*(.+)$/,
      );
      if (m) {
        const pageToken = String(m[1] || "").trim();
        const page = pageToken ? parsePageNumber(pageToken) : null;
        const slideIndex = page !== null ? page - 1 : getDefaultSlideIndex();
        const kind = String(m[2] || "").trim();
        const rest = String(m[3] || "").trim();
        const selector = kind === "标题" ? "title" : kind === "副标题" ? "subtitle" : kind === "正文" ? "body" : "content";
        return makeIntent("MODIFY_ELEMENT", { slideIndex, elementSelector: selector }, rest || undefined);
      }
    }

    // MODIFY_ELEMENT: “修改第N页的标题(为xxx)”
    {
      const m = text.match(
        /修改\s*第?([0-9一二三四五六七八九十百千两〇零]+)\s*页\s*的?\s*(标题|副标题|正文|内容)\s*(?:为|成|改为)?\s*(.*)?/,
      );
      if (m) {
        const page = parsePageNumber(m[1]);
        if (page !== null) {
          const kind = String(m[2] || "").trim();
          const rest = String(m[3] || "").trim();
          const selector = kind === "标题" ? "title" : kind === "副标题" ? "subtitle" : kind === "正文" ? "body" : "content";
          return makeIntent(
            "MODIFY_ELEMENT",
            { slideIndex: page - 1, elementSelector: selector },
            rest || undefined,
            rest ? undefined : { needsContent: true },
          );
        }
      }
    }

    // RESEARCH_MORE: /再找找|补充.*资料/
    {
      const m1 = text.match(/(?:再找找|再找|再搜搜|再搜)\s*(.+?)\s*(?:资料|信息|内容)?$/);
      if (m1) {
        const topic = cleanTopic(m1[1]);
        if (topic) return makeIntent("RESEARCH_MORE", {}, topic);
      }

      const m2 = text.match(/(?:补充|扩展|增加)\s*(?:关于)?\s*(.+?)\s*(?:资料|信息|内容)$/);
      if (m2) {
        const topic = cleanTopic(m2[1]);
        if (topic) return makeIntent("RESEARCH_MORE", {}, topic);
      }

      const m3 = text.match(/(?:补充|扩展|增加)\s*(?:关于)?\s*(.+?)\s*的?\s*内容$/);
      if (m3) {
        const topic = cleanTopic(m3[1]);
        if (topic) return makeIntent("RESEARCH_MORE", {}, topic);
      }
    }

    // ADD_FILE: “新加入文件 / 添加文件”
    {
      const m = text.match(/(?:新加入|加入|添加)\s*(?:一个)?\s*(文件|附件|图片)/);
      if (m) {
        return makeIntent("ADD_FILE", {}, String(m[1] || "").trim());
      }
    }

    return null;
  }

  async function parseByLLM(input, context) {
    const llm = context && context.llm;
    if (!llm) return null;

    // 允许外部直接提供解析函数（最稳定、可测试）
    if (typeof llm.parseIntent === "function") {
      const out = await llm.parseIntent(input, context);
      return out && typeof out === "object" ? out : null;
    }

    // 兼容类似 { chat(messages)->string } 的接口：返回 JSON
    if (typeof llm.chat === "function") {
      const prompt = [
        "将用户自然语言编辑指令解析为 JSON Intent，仅输出 JSON。",
        "Intent schema:",
        JSON.stringify(
          {
            type: "INSERT_SLIDE|DELETE_SLIDE|MODIFY_ELEMENT|REDO_SLIDE|REDO_RANGE|RESEARCH_MORE|ADD_FILE",
            target: { slideIndex: 0, slideRange: [0, 0], elementSelector: "title" },
            content: "string",
            constraints: {},
          },
          null,
          2,
        ),
        `用户输入: ${String(input || "")}`,
      ].join("\n");

      const text = await llm.chat([{ role: "user", content: prompt }], context);
      if (!isNonEmptyString(text)) return null;
      try {
        const obj = JSON.parse(text);
        return obj && typeof obj === "object" ? obj : null;
      } catch {
        return null;
      }
    }

    return null;
  }

  /**
   * parseIntent(userInput, context)
   * @param {string} userInput
   * @param {object} context - 可选，包含当前 slide/selection/llm 等
   * @returns {Promise<object>} Intent
   */
  async function parseIntent(userInput, context = {}) {
    const raw = normalizeInput(userInput);
    const byRegex = parseByRegex(raw, context);
    if (byRegex) return byRegex;

    const byLLM = await parseByLLM(raw, context);
    if (byLLM) return byLLM;

    return makeIntent("RESEARCH_MORE", {}, raw, { fallback: true });
  }

  global.IntentParser = { parseIntent, parse: parseIntent };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parseIntent, _internal: { normalizeInput, parseByRegex, chineseNumberToInt } };
  }
})(typeof window !== "undefined" ? window : globalThis);
