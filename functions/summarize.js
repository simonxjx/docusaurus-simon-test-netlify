// functions/summarize.js
exports.handler = async function(event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  try {
    let text = "";

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");
      text = body.text || "";
    } else if (event.httpMethod === "GET") {
      text = event.queryStringParameters?.text || "";
    } else {
      return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }), headers };
    }

    if (!text) throw new Error("No text provided");

    // 限制最大长度，防止 token 爆
    text = text.slice(0, 10000);

    const isChinese = /[\u4e00-\u9fa5]/.test(text.slice(0, 200));

    const prompt = isChinese
      ? `
请阅读以下技术文档，并生成结构化摘要。

输出必须包含以下三个部分：
- 每个部分的标题加粗并加冒号，然后换一行
- 第二和第三部分标题上方空一行
- 输出 HTML 格式，可直接在网页中渲染
- **输出前后不包含多余空行或字符**
- 忽略图片、代码块和表格

目的与范围
- 用1-2句话说明文档的目的以及涵盖范围。

价值说明
- 用1-2句话说明文档对读者的价值或能解决什么问题。

内容快速概览
- 用3-5条简洁的要点总结文档的主要内容，每条一行。

要求：
- 只保留核心信息
- 表达简洁清晰

文档：
${text}
`
      : `
Read the following technical documentation and generate a structured summary.

The output must contain the following three sections:
- Bold the title of each section and add a colon, then move to a new line
- Leave a blank line above the titles of the second and third sections
- Output HTML string, can be directly rendered on a webpage
- **Do not include any extra characters or blank lines at the beginning or end**
- Ignore images, code blocks, and tables

Purpose & Scope
- 1–2 sentences explaining the purpose of the document and what it covers.

Value Proposition
- 1–2 sentences explaining the value of the document and why it is useful for readers.

Quick Summary of Content
- 3–5 concise points summarizing the main content, one per line.

Requirements:
- Focus only on key information
- Keep the summary concise and clear

Document:
${text}
`;

    // ── Cerebras 兜底函数（仅在 Groq 失败时调用）────────────────
    async function callCerebras() {
      console.log("Groq failed, falling back to Cerebras...");
      const res = await fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.CEREBRAS_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama3.1-8b",
          messages: [
            {
              role: "system",
              content: "You must output HTML only. Use <strong> for bold, <br> for line breaks, <ul><li> for lists. Do not use Markdown syntax like **, *, or -. Do not wrap output in code blocks."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error("Cerebras API error:", res.status, errBody);
        throw new Error(`Cerebras API returned ${res.status}`);
      }
      const json = await res.json();
      let summary = (json.choices?.[0]?.message?.content || "")
        .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();

      summary = summary
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/<\/?ul>/gi, "")
        .replace(/(<li>[\s\S]*?<\/li>)+/g, match => `<ul>${match}</ul>`)
        .replace(/\n{2,}/g, "<br><br>")
        .replace(/\n/g, "<br>");

      summary = summary
        .replace(/<ul>\s*<ul>/g, "<ul>")
        .replace(/<\/ul>\s*<\/ul>/g, "</ul>")
        .replace(/<\/ul>\s*(<br>)?\s*<ul>/g, "")
        .replace(/<br>\s*(<ul>)/gi, "$1")
        .replace(/(<ul>)\s*<br>/gi, "$1")
        .replace(/<br>\s*(<li>)/gi, "$1")
        .replace(/(<\/li>)\s*<br>/gi, "$1")
        .replace(/<br>\s*(<\/ul>)/gi, "$1")
        .replace(/(<\/strong>:?)\s*(<br>)+/gi, "$1<br>")
        .replace(/\r?\n/g, "<br>")
        .replace(/(<br>\s*)+(<\/div>)/gi, "$2")
        .replace(/(<br>\s*)+$/gi, "")
        .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>");

      if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";
      return summary;
    }

    // ── Groq 兜底函数（仅在 Gemini 失败时调用）──────────────────
    async function callGroq() {
      console.log("Gemini failed, falling back to Groq...");
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: "You must output HTML only. Use <strong> for bold, <br> for line breaks, <ul><li> for lists. Do not use Markdown syntax like **, *, or -. Do not wrap output in code blocks."
            },
            { role: "user", content: prompt }
          ],
          temperature: 0.2,
          max_tokens: 2048,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        console.error("Groq API error:", res.status, errBody);
        throw new Error(`Groq API returned ${res.status}`);
      }
      const json = await res.json();
      let summary = (json.choices?.[0]?.message?.content || "")
        .replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();

      // 1. Markdown → HTML 兜底转换
      summary = summary
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/<\/?ul>/gi, "")                                          // ← 新增：先剥掉所有已有的 <ul>
        .replace(/(<li>[\s\S]*?<\/li>)+/g, match => `<ul>${match}</ul>`)  // 再统一重新包裹
        .replace(/\n{2,}/g, "<br><br>")
        .replace(/\n/g, "<br>");

      // 2. 清理多余结构
      summary = summary
        .replace(/<ul>\s*<ul>/g, "<ul>")
        .replace(/<\/ul>\s*<\/ul>/g, "</ul>")
        .replace(/<\/ul>\s*(<br>)?\s*<ul>/g, "")
        .replace(/<br>\s*(<ul>)/gi, "$1")
        .replace(/(<ul>)\s*<br>/gi, "$1")
        .replace(/<br>\s*(<li>)/gi, "$1")
        .replace(/(<\/li>)\s*<br>/gi, "$1")
        .replace(/<br>\s*(<\/ul>)/gi, "$1")
        .replace(/(<\/strong>:?)\s*(<br>)+/gi, "$1<br>")
        .replace(/(<\/strong>:?)\s*(<br>)+/gi, "$1<br>")
        .replace(/\r?\n/g, "<br>")
        .replace(/(<br>\s*)+(<\/div>)/gi, "$2")    // 清理 </div> 前所有 <br>
        .replace(/(<br>\s*)+$/gi, "")              // 清理结尾所有 <br>（无 </div> 时兜底）
        .replace(/(<br\s*\/?>\s*){3,}/gi, "<br><br>"); // 连续 3+ 个 <br> 压缩为 2 个

      if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";
      return summary;
    }

    // 调用 Google Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
        }),
      }
    );

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Gemini API error:", response.status, errBody);
      // ← 唯一改动：Gemini 失败则 fallback
      return { statusCode: 200, body: JSON.stringify({ summary: await callGroq().catch(() => callCerebras()) }), headers };
    }

    const data = await response.json();

    const candidate = data.candidates?.[0];
    if (!candidate) {
      console.error("Gemini returned no candidates:", JSON.stringify(data));
      // ← 唯一改动：Gemini 无结果则 fallback
      return { statusCode: 200, body: JSON.stringify({ summary: await callGroq().catch(() => callCerebras()) }), headers };
    }

    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.error("Gemini finish reason:", finishReason);
      // ← 唯一改动：Gemini 异常终止则 fallback
      return { statusCode: 200, body: JSON.stringify({ summary: await callGroq().catch(() => callCerebras()) }), headers };
    }

    let summary = candidate.content?.parts?.[0]?.text || "";

    // 清理 Markdown 或多余换行
    summary = summary.replace(/^```html\s*/i, "")
                     .replace(/^```\s*/i, "")
                     .replace(/\s*```$/, "")
                     .trim();

    if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";

    // 没有 <p> 标签时，把换行转成 <br>
    if (!/<p[\s>]/i.test(summary)) {
      summary = summary.replace(/\n/g, "<br>");
    }

    return { statusCode: 200, body: JSON.stringify({ summary }), headers };

  } catch (err) {
    const isAbort = err.name === "AbortError";
    console.error("Serverless Error:", isAbort ? "Gemini request timed out" : err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: isAbort ? "Request timed out" : err.message }),
      headers
    };
  }
};