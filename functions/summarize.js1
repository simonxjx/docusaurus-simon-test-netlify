// functions/summarize.js
// Netlify Functions 运行在 Node 18+，原生支持 fetch，无需 node-fetch
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

    // 限制最大长度，防止 token 爆 & 超时
    text = text.slice(0, 3000);

    const isChinese = /[\u4e00-\u9fa5]/.test(text.slice(0, 200));

    const prompt = isChinese
      ? `用纯HTML格式为以下技术文档生成结构化摘要（不输出Markdown，忽略图片/代码块/表格）。

包含三个部分，每部分标题用<b>加粗加冒号</b>：
1. <b>目的与范围：</b> 1-2句
2. <b>价值说明：</b> 1-2句
3. <b>内容概览：</b> 3-5条要点用<ul><li>格式

文档：
${text}`
      : `Generate a structured summary in pure HTML (no Markdown, ignore images/code/tables).

Three sections with <b>bold titles</b>:
1. <b>Purpose & Scope:</b> 1-2 sentences
2. <b>Value Proposition:</b> 1-2 sentences
3. <b>Quick Summary:</b> 3-5 bullet points as <ul><li>

Document:
${text}`;

    // 调用 Google Gemini API，超时设为 9s（Netlify 函数限制 10s）
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    let response;
    try {
      response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=${process.env.GOOGLE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
        }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errBody = await response.text();
      console.error("Gemini API error:", response.status, errBody);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();

    const candidate = data.candidates?.[0];
    if (!candidate) {
      console.error("Gemini returned no candidates:", JSON.stringify(data));
      throw new Error("No candidates returned from Gemini");
    }

    const finishReason = candidate.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.error("Gemini finish reason:", finishReason);
      throw new Error(`Gemini stopped with reason: ${finishReason}`);
    }

    let summary = candidate.content?.parts?.[0]?.text || "";

    // 清理 Markdown 或多余换行
    summary = summary.replace(/^```html\s*/i, "")
                     .replace(/^```\s*/i, "")
                     .replace(/\s*```$/, "")
                     .trim();

    // 兜底：如果 Gemini 仍然输出纯文本 bullet（• / - / *），转换为 <ul><li>
    summary = summary.replace(
      /(?:^|\n)((?:[•\-\*] .+(?:\n|$))+)/g,
      (_, block) => {
        const items = block.trim().split("\n").map(line =>
          `<li>${line.replace(/^[•\-\*]\s*/, "").trim()}</li>`
        ).join("\n");
        return `\n<ul>\n${items}\n</ul>\n`;
      }
    );

    if (!summary) summary = isChinese ? "AI 未能生成摘要。" : "AI could not generate a summary.";

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
