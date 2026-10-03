import { config } from '../../config.js';
import { fetchJson } from '../../utils/http.js';
import type { GlossaryEntry } from './types.js';
import type { PreparedLine } from './prepare.js';

/**
 * The interpretive half. The dictionary supplies the facts; this supplies the
 * reading — which line is a plain statement and which is carrying four hundred
 * years of Sufi imagery on its back.
 */

export interface ExplainInput {
  title?: string;
  artist?: string;
  lines: PreparedLine[];
  glossary: GlossaryEntry[];
}

export interface ExplainOutput {
  summary: string;
  tradition?: string;
  poet?: string;
  themes: string[];
  lines: Array<{ n: number; matlab: string; note?: string }>;
  terms: Array<{ word: string; matlab: string }>;
}

const SYSTEM = `Tum South Asia ki Sufi, qawwali, ghazal, kafi, nazm aur folk shayari ke jaankaar ho.
Tumhara kaam: har line ka matlab samjhana, aur jahan gehraai ho wahan uski tehdaari kholna.

ZABAAN — ye sabse zaroori hai:
- Sab kuch HINGLISH mein likho: Hindustani zabaan, Roman (English) letters mein.
- Jaise: "Iska matlab ye hai ki aashiq apne mehboob ki judaai mein tadap raha hai."
- Devanagari ya Urdu script mein MAT likho. Pure English mein bhi MAT likho.
- Shayari ke technical lafz (hijr, visaal, fana, saaqi, tajalli) waise hi rakho, aur pehli baar
  aaye to Hinglish mein chhota sa matlab bata do.

NIYAM:
- "matlab": ek ya do line, seedhi baat — line keh kya rahi hai.
- Dictionary ke meaning LITERAL hote hain. Shayari mein unka istemaal alag ho sakta hai:
  "vasl" ka dictionary matlab jismani milan hai, lekin qawwali mein wo Khuda se milan hai;
  "sharaab" peene ki cheez nahi, ishq ka nasha hai. Context padho, dictionary ki nakal mat karo.
- "poet": sirf tab bharo jab pakka pata ho ki ye kalaam kis shayar ka hai. Zara bhi shak ho to
  khaali chhod do — galat shayar ka naam dena sabse buri galti hai.

"NOTE" — ye is feature ki jaan hai:
Sufi kalaam, qawwali aur ghazal mein har teesri-chauthi line koi image ya ishaara leke chalti hai.
Jahan ho, wahan note zaroor do. Note tab banta hai jab line mein:
- koi isti'ara (metaphor) ho — zulf, sharaab, saaqi, shama-parwana, safina, sahra, qafas
- Quran, hadees, kisi nabi, sahabi, sant ya Sufi buzurg ka hawala ho
- koi classical mazmoon ho — ishq-e-haqeeqi aur majazi ka farq, fana, baqa, visaal, hijr, tawassul
- lafzi khel ho, ya ek lafz ke do matlab nikalte hon
- kisi mashhoor sher, rivayat ya waqiye ka ishaara ho
Note MAT do jab line sirf dohraav ho ya seedhi baat ho — aisi line ke liye note mein khaali
string "" bhejo. Har line ke liye "note" field bhejna zaroori hai: ya to asli gehri baat, ya "".
Zabardasti gehraai mat nikalo — lekin asli gehraai chhod dena bhi utni hi badi galti hai.
Agar poore kalaam mein ek bhi note nahi bana, to samajh lo kuch miss kiya hai: Sufi kalaam mein
ishaare hamesha hote hain.

MISAAL — aise likho:
line: "ae kaatib-e-taqdeer madina likh de"
  matlab: "Aye taqdeer likhne wale, meri kismat mein Madina likh de."
  note: "Kaatib-e-taqdeer yaani Khuda khud, jo har insaan ki taqdeer likhta hai. Shayar jannat
  nahi maang raha — pichhli line mein kehta hai jannat bhi gawara hai, par maangta Madina hai.
  Aashiq ke liye mehboob ka shehar jannat se bhi upar hai; yahi ishq-e-Rasool ka urooj hai."

line: "jeet le jaye koi mujhko naseebon wala"
  matlab: "Koi khushnaseeb aakar mujhe jeet le jaye."
  note: ""   <- seedhi baat hai, isliye khaali`;

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING', description: 'Poore gaane ka matlab, Hinglish mein, 3-5 lines' },
    tradition: { type: 'STRING', description: 'qawwali / ghazal / kafi / nazm / folk — pata ho tabhi' },
    poet: { type: 'STRING', description: 'Shayar ka naam, yakeen ho tabhi' },
    themes: { type: 'ARRAY', items: { type: 'STRING' } },
    lines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER' },
          matlab: { type: 'STRING' },
          note: {
            type: 'STRING',
            description: 'Gehri baat jahan image ya hawala ho, warna khaali string ""',
          },
        },
        propertyOrdering: ['n', 'matlab', 'note'],
        required: ['n', 'matlab', 'note'],
      },
    },
    terms: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { word: { type: 'STRING' }, matlab: { type: 'STRING' } },
        required: ['word', 'matlab'],
      },
    },
  },
  required: ['summary', 'themes', 'lines'],
};

function buildPrompt(input: ExplainInput): string {
  const parts: string[] = [];

  const who = [input.title, input.artist].filter(Boolean).join(' — ');
  if (who) parts.push(`GAANA: ${who}`);

  if (input.glossary.length > 0) {
    parts.push(
      '\nLUGHAT (Rekhta dictionary se — ye literal matlab hain, shayari mein farq ho sakta hai):',
      ...input.glossary.map(
        (entry) =>
          `- ${entry.word}${entry.roman ? ` (${entry.roman})` : ''}${entry.origin ? ` [${entry.origin}]` : ''}: ${entry.senses.join('; ')}`,
      ),
    );
  }

  parts.push(
    '\nLINES (har line ka number diya hai — isi number se jawab do).',
    'Jo line gaane mein baar-baar aati hai wo yahan ek hi baar hai.',
    '',
    ...input.lines.map((line) => `${line.n}. ${line.text}`),
  );

  return parts.join('\n');
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

function parseOutput(text: string): ExplainOutput {
  // Models occasionally wrap JSON in a fence even when asked not to.
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const parsed = JSON.parse(cleaned) as ExplainOutput;

  if (!parsed.summary || !Array.isArray(parsed.lines)) {
    throw new Error('model returned JSON without a summary or lines');
  }
  return {
    ...parsed,
    themes: Array.isArray(parsed.themes) ? parsed.themes : [],
    terms: Array.isArray(parsed.terms) ? parsed.terms : [],
  };
}

export async function explainWithGemini(input: ExplainInput): Promise<ExplainOutput> {
  if (!config.geminiApiKey) {
    throw new Error('No GEMINI_API_KEY set — add one to server/.env to explain songs.');
  }

  const model = config.meaningModel;
  // The key travels in a header: a key in the query string ends up in error
  // messages, access logs and screenshots, and this one already has.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(input) }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      responseSchema: SCHEMA,
      // Enough room to think about imagery, not enough to ramble.
      ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 1024 } } : {}),
    },
  };

  const response = await fetchJson<GeminiResponse>(url, {
    json: body,
    headers: { 'x-goog-api-key': config.geminiApiKey },
    timeoutMs: 120_000,
    skipThrottle: true,
    // 503 means the model is busy, not that the song is unexplainable.
    retries: 3,
  });

  if (response.promptFeedback?.blockReason) {
    throw new Error(`Gemini refused the request (${response.promptFeedback.blockReason}).`);
  }

  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (!text.trim()) {
    const reason = response.candidates?.[0]?.finishReason ?? 'empty response';
    throw new Error(`Gemini returned nothing (${reason}).`);
  }

  const usage = response.usageMetadata;
  console.log(
    `[meaning] ${model}: ${usage?.promptTokenCount ?? '?'} in / ${usage?.candidatesTokenCount ?? '?'} out`,
  );

  return parseOutput(text);
}
