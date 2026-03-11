// functions/summarize.js
const fetch = require("node-fetch"); // 如果 Node 18+ 可直接用 fetch

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
    text = text.slice(0, 10000); // 限制长度

    const isChinese = /[\u4e00-\u9fa5]/.test(text.slice(0, 200));

    const prompt = isChinese
      ? `
请阅读以下技术文档，并生成结构化摘要。
...
文档：
${text}
`
      : `
Read the following technical documentation and generate a structured summary.
...
Document:
${text}
`;

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
    summary = summary.replace(/^```html\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();

    if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";

    return { statusCode: 200, body: JSON.stringify({ summary }), headers };

  } catch (err) {
    console.error("Serverless Error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }), headers };
  }
};