// functions/summarize.js
exports.handler = async function(event, context) {
  // 动态 import node-fetch，兼容 v3 ES Module
  const fetch = (await import("node-fetch")).default;

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

    // 调用 Google Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
        }),
      }
    );

    const data = await response.json();

    let summary = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 清理 Markdown 或多余换行
    summary = summary.replace(/^```html\s*/i, "")
                     .replace(/^```\s*/i, "")
                     .replace(/\s*```$/, "")
                     .trim();

    if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";

    return { statusCode: 200, body: JSON.stringify({ summary }), headers };

  } catch (err) {
    console.error("Serverless Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }), headers };
  }
};