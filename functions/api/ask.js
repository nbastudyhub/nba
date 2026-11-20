// Study Hub AI helper: POST /api/ask (an IT lesson, or deckId "business" for the Business exam-writing section)
// Runs as a Cloudflare Pages Function; shared checks and the API client are in lib/shared.js.
import { MODEL, json, guard, readJson, loadDeck, loadTopics, newClient, apiError, textOf } from "../../lib/shared.js";
import { logAi, later } from "../../lib/ailog.js";

const MAX_QUESTION = 600;        // characters per question
const MAX_BIZ_QUESTION = 1500;   // Business: students may paste a paragraph to get feedback on
const MAX_HISTORY = 8;           // earlier messages sent back for context
const MAX_HISTORY_TEXT = 2000;   // characters per earlier message

// Turn a study pack into plain-text notes for the system prompt.
export function lessonNotes(deck) {
  const out = [];
  out.push(`Lesson: ${deck.title} (${deck.code || deck.subject || ""})`);
  if (deck.bigQuestion) out.push(`Big question: ${deck.bigQuestion}`);
  for (const s of deck.sections || []) {
    out.push(`\n## ${s.heading}`);
    if (s.text) out.push(s.text);
    for (const p of s.points || []) out.push(`- ${p}`);
    if (s.diagram) out.push(`[Diagram on the page: ${s.diagram.alt}]`);
    if (s.table) {
      out.push(s.table.head.join(" | "));
      for (const r of s.table.rows) out.push(r.join(" | "));
    }
  }
  if (deck.keyIdea) out.push(`\nKey idea: ${deck.keyIdea}`);
  if (deck.flashcards?.length) {
    out.push("\n## Key terms");
    for (const [t, d] of deck.flashcards) out.push(`- ${t}: ${d}`);
  }
  return out.join("\n");
}

// One line per lesson: title, section headings and key terms, so the helper can say
// which lesson covers a topic. Built by scripts/build-index.mjs as docs/decks/topics.json.
export function courseIndex(topics, currentId) {
  return (topics || []).map((t) =>
    `- ${t.title}${t.id === currentId ? " (the lesson open now)" : ""}: ${[...(t.headings || []), ...(t.terms || [])].join("; ")}`
  ).join("\n");
}

export function systemPrompt(deck, topics = []) {
  return `You are the Study Hub revision helper. The students using you are mostly aged 16 to 18, in the UK, learning BTEC-style Information Technology (Unit 2: cyber security) for the first time and aiming for a Distinction*. The student is currently studying the lesson below; the notes come from their own lesson slides.

How to help:
- Explain clearly in plain UK English with short sentences, at a level a first-time learner can follow. Use examples from the lesson where you can.
- Keep answers short: usually 2 to 6 sentences, or a few bullet points starting with "- ". Don't use headings, tables or other formatting.
- Base your answers on the lesson notes. If something isn't covered in the notes or the course index, you can give a brief standard explanation, but say it wasn't in their slides and suggest checking with their teacher.
- For exam-style questions, help the student work it out themselves: explain what the command word wants, how to structure the answer (a point plus a linked reason, using the scenario), and give hints. Give feedback on attempts they share. Only show a full model answer after they've had a go, and then explain why it scores well.
- Explain attacks at the level of the lesson, for understanding and defence. Don't give step-by-step instructions for attacking real systems.
- Stay focused on studying. If asked about something unrelated, kindly steer back to the lesson.
- Never ask for personal details. If a student seems upset or unsafe, or mentions harm, respond kindly, encourage them to talk to a trusted adult or teacher, and mention Childline (0800 1111, childline.org.uk).
- If you're not sure about something, say so rather than guessing.
- The course index below lists every lesson in the student's course. If a question is about something taught in a different lesson, name that lesson exactly as it appears in the index and suggest they open it, then give a short explanation in line with that lesson's key terms. Only say a topic isn't in their slides when it isn't in the index either.

COURSE INDEX
${courseIndex(topics, deck.id)}`;
}

export function lessonPrompt(deck) {
  return `LESSON NOTES (the lesson open now)
${lessonNotes(deck)}`;
}

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  const msgs = history.slice(-MAX_HISTORY)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ role: m.role, content: m.text.slice(0, MAX_HISTORY_TEXT) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift(); // must start with the student
  // roles must alternate; drop any repeats
  return msgs.filter((m, i) => i === 0 || m.role !== msgs[i - 1].role);
}

// ---------- Business exam writing (docs/business/questions.json) ----------
export function businessNotes(data) {
  const out = [`Course: ${data.course}`];
  (data.steps || []).forEach((s, i) => {
    out.push(`\n## ${/^Extra/i.test(s.title) ? "Extra step" : `Step ${i + 1}`}: ${s.title}`, s.intro);
    out.push("Boxes: " + s.fields.map((f) => (f.group ? `${f.group} – ` : "") + f.label).join("; "));
    out.push("Checklist: " + s.checks.join("; "));
    if (s.tip) out.push(`Tip: ${s.tip}`);
    if (s.example) out.push(`Teacher's example (${s.example.title}):\n` + s.example.text.map((t) => `- ${t}`).join("\n"));
  });
  if (data.learn) {
    out.push(`\n# LEARN NOTES: ${data.learn.title} (from the teacher's PowerPoint)`);
    for (const s of data.learn.sections || []) {
      out.push(`\n## ${s.heading}`);
      if (s.text) out.push(s.text);
      if (s.table) { out.push(s.table.head.join(" | ")); for (const r of s.table.rows) out.push(r.join(" | ")); }
      for (const p of s.points || []) out.push(`- ${p}`);
      if (s.diagram) out.push(`[Diagram: ${s.diagram.alt}]`);
    }
  }
  if ((data.terms || []).length) out.push("\n## Key terms\n" + data.terms.map((t) => `- ${t.t}: ${t.d}`).join("\n"));
  return out.join("\n");
}
export function businessPrompt() {
  return `You are the Study Hub revision helper for Business. The students using you are mostly aged 16 to 18, in the UK, studying Pearson BTEC Level 3 National Business and aiming for a Distinction*. Right now they are working on Unit 2 (Developing a Marketing Campaign): the Learn notes below (Learning Aims A and B, from their teacher's PowerPoint) and a set task about a business called Technective launching a new smartwatch. Their teacher teaches a step-by-step structure (below) and writes every point as Point, Evidence (quoted from the case booklet), Explain, Link (to the business's aim).

How to help:
- Explain clearly in plain UK English with short sentences. Keep answers short: usually 2 to 6 sentences, or a few bullet points starting with "- ". Don't use headings or tables.
- Teach the ideas (aims, SMART objectives, trends, competitors, reliability, validity, bias, SWOT, PESTLE, the 7 Ps, the product life cycle) and how to use the teacher's structure.
- This is assessed coursework, so coach rather than write it. Never write the student's answers about Technective for them, even if asked. Instead: ask guiding questions, point to which part of Point, Evidence, Explain, Link is missing, and give feedback on drafts they share. You may show short examples about a different, made-up business.
- You can't see the Technective booklet. If you need its facts or figures, ask the student to paste them. Don't invent facts about Technective or its market.
- Remind students, when relevant, that their teacher's rules come first (e.g. whether AI help is allowed during the set task).
- Stay focused on studying. If asked about something unrelated, kindly steer back.
- Never ask for personal details. If a student seems upset or unsafe, or mentions harm, respond kindly, encourage them to talk to a trusted adult or teacher, and mention Childline (0800 1111, childline.org.uk).
- If you're not sure about something, say so rather than guessing.`;
}

export async function onRequestPost(ctx) {
  const { request, env } = ctx;
  const blocked = guard(request, env);
  if (blocked) return blocked;

  const body = await readJson(request);
  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  const biz = body && body.deckId === "business";
  if (!body || typeof body.deckId !== "string" || !/^[a-z0-9-]{1,120}$/.test(body.deckId) || !question || question.length > (biz ? MAX_BIZ_QUESTION : MAX_QUESTION)) {
    return json({ error: "bad_request" }, 400);
  }
  let system;
  if (biz) {
    let data = null;
    try { const res = await env.ASSETS.fetch(new URL("/business/questions.json", request.url)); if (res.ok) data = await res.json(); } catch { data = null; }
    if (!data) return json({ error: "unknown_lesson" }, 404);
    system = [{ type: "text", text: businessPrompt() }, { type: "text", text: `BUSINESS SECTION NOTES (what the student is working on)\n${businessNotes(data)}` }];
  } else {
    const deck = await loadDeck(env, request.url, body.deckId);
    if (!deck) return json({ error: "unknown_lesson" }, 404);
    const topics = await loadTopics(env, request.url);
    system = [{ type: "text", text: systemPrompt(deck, topics) }, { type: "text", text: lessonPrompt(deck) }];
  }

  const messages = cleanHistory(body.history);
  if (messages.length && messages[messages.length - 1].role === "user") messages.pop();
  messages.push({ role: "user", content: question });

  try {
    const response = await newClient(env).messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" }, // reuse the instructions and notes across a student's questions
      system,
      messages,
    });
    const refused = response.stop_reason === "refusal";
    const answer = refused ? "Sorry, I can't help with that one. Try asking me something about this lesson." : textOf(response);
    if (!answer) return json({ error: "empty" }, 502);
    later(ctx, logAi(env, request, { kind: "helper", place: body.deckId, question, answer: refused ? "(refused) " + answer : answer }));
    return json({ answer });
  } catch (error) {
    return apiError(error);
  }
}
