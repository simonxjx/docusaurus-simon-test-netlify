// functions/summarize.js

// ── Groq 兜底函数（移出 handler，只创建一次）─────────────────
async function callGroq(prompt, isChinese) {
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
          content: `You are a document summarizer. Output rules (STRICT):
1. Output raw HTML only - no Markdown, no code fences, no backticks
2. Bold text: <strong>text</strong> - never use **text**
3. Lists: <ul><li>item</li></ul> - never use - or * bullets
4. Line breaks: <br> - never use \\n between sections
5. Do NOT wrap output in <html>, <body>, <div>, or any container tag
6. Do NOT add any text before or after the HTML`,
        },
        { role: "user", content: prompt },
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
    .replace(/^```[\w]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";
  return summary;
}

// ── 主 handler ────────────────────────────────────────────────
exports.handler = async function (event, context) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers };
  }

  // 优化 6：只接受 POST
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method Not Allowed" }), headers };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const rawText = body.text || "";

    if (!rawText) throw new Error("No text provided");

    // 优化 4：先截断，再检测语言
    const text = rawText.slice(0, 10000);
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

    // 调用 Google Gemini API（完全保持原样）
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
      return { statusCode: 200, body: JSON.stringify({ summary: await callGroq(prompt, isChinese) }), headers };
    }

    const data = await response.json();

    const candidate = data.candidates?.[0];
    if (!candidate) {
      console.error("Gemini returned no candidates:", JSON.stringify(data));
      return { statusCode: 200, body: JSON.stringify({ summary: await callGroq(prompt, isChinese) }), headers };
    }

    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.error("Gemini finish reason:", finishReason);
      return { statusCode: 200, body: JSON.stringify({ summary: await callGroq(prompt, isChinese) }), headers };
    }

    let summary = candidate.content?.parts?.[0]?.text || "";

    // 清理 Markdown 或多余换行（保持原样）
    summary = summary.replace(/^```html\s*/i, "")
                     .replace(/^```\s*/i, "")
                     .replace(/\s*```$/, "")
                     .trim();

    if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";

    if (!/<p[\s>]/i.test(summary)) {
      summary = summary.replace(/\n/g, "<br>");
    }

    return { statusCode: 200, body: JSON.stringify({ summary }), headers };

  } catch (err) {
    // 优化 2：Groq 失败也统一落到这里，返回友好错误
    console.error("Serverless Error:", err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Failed to generate summary, please try again later." }),
      headers,
    };
  }
};