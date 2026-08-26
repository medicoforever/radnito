import { GoogleGenAI, Type, GenerateContentResponse, Chat } from "@google/genai";
import { DEFAULT_GEMINI_PROMPT, REPROCESS_GEMINI_PROMPT, TEMPLATE_GEMINI_PROMPT, STRICT_CUSTOM_TEMPLATE_GEMINI_PROMPT, REPORT_TEMPLATES, ERROR_IDENTIFIER_PROMPT, INITIAL_AGENT_PROMPT, REFINEMENT_AGENT_PROMPT, SYNTHESIZER_AGENT_PROMPT } from '../constants';
import { IdentifiedError } from "../types";
import { getRandomApiKey, getFallbackApiKey, getStoredApiKeys } from './apiKeyStore';
import { extractTextFromDocxBlob } from './docxService';
import { buildDocumentAstFromDocx, applyAstMutationsToDocx, AstMutation, AstInsertion, mergeFindingsIntoDocxWithAstEngine } from './docxAstService';

import { isRAGStyleMatchingEnabled, getRelevantStyleTemplates, augmentPromptWithStyleTemplates } from './reportStyleRAG';
import { findCrossModalitySkills } from './templateCatalog';

export const getAiClient = (lastFailedKey?: string) => {
  const keys = getStoredApiKeys();
  if (keys.length === 0) {
    throw new Error("No Gemini API Key found. Please click 'Set API Key' in the top bar or check our Free API Key Guide.");
  }
  const selectedKey = lastFailedKey ? getFallbackApiKey(lastFailedKey) : getRandomApiKey();
  return {
    client: new GoogleGenAI({ apiKey: selectedKey }),
    key: selectedKey,
  };
};


export const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    if (!blob || !(blob instanceof Blob) || blob.size === 0) {
      return reject(new Error("Audio file parameter is missing or not a valid Blob. Please re-record or upload a valid audio file."));
    }
    try {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        if (!base64data) {
          return reject(new Error("Failed to read audio file contents."));
        }
        resolve(base64data.split(',')[1] || base64data);
      };
      reader.onerror = () => reject(new Error("FileReader error while reading audio file."));
      reader.readAsDataURL(blob);
    } catch (e) {
      reject(new Error("Audio file parameter is not a valid Blob. Please re-record or upload a valid audio file."));
    }
  });
};

export const base64ToBlob = (base64: string, mimeType: string): Blob => {
  try {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (e) {
    console.error("Failed to convert base64 to Blob:", e);
    // Return an empty blob on error
    return new Blob([], { type: mimeType });
  }
};

export const isDocxBlob = (blob: Blob, fileName?: string): boolean => {
  const name = (fileName || (blob as any).name || '').toLowerCase();
  if (name.endsWith('.docx') || name.endsWith('.doc')) return true;
  if (blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || blob.type === 'application/msword') return true;
  return false;
};

export const isTextBlob = (blob: Blob, fileName?: string): boolean => {
  const name = (fileName || (blob as any).name || '').toLowerCase();
  if (name.endsWith('.txt') || name.endsWith('.csv') || name.endsWith('.json') || name.endsWith('.md') || name.endsWith('.rtf') || name.endsWith('.log')) return true;
  if (blob.type.startsWith('text/') || blob.type === 'application/json' || blob.type === 'text/csv' || blob.type === 'text/plain') return true;
  return false;
};

// User's strictly configured model list in exact order down to gemini-2.5-flash (excluding gemini-3.5-flash-lite)
export const USER_CONFIGURED_MODELS = [
  'gemini-3.5-flash',
  'gemini-3.7-flash',
  'gemini-3-flash-preview',
  'gemini-3.6-flash',
  'gemini-2.5-flash',
];

/**
 * Universal Cascading Gemini API caller with Exponential Backoff & Model Switching
 * If the selected model hits rate limits or server errors, automatically cascades
 * sequentially down the exact configured model list until gemini-2.5-flash level.
 */
export async function generateContentWithRetry(
  params: any,
  maxRetriesPerModel: number = 2
): Promise<GenerateContentResponse> {
  const requestedModel = params.model || 'gemini-3.5-flash';
  const startModel = getValidModelName(requestedModel);

  // Build cascade queue starting from requested model down to gemini-2.5-flash, then wrapping around
  const startIndex = USER_CONFIGURED_MODELS.indexOf(startModel);
  let modelCascade: string[] = [];

  if (startIndex !== -1) {
    modelCascade = [
      ...USER_CONFIGURED_MODELS.slice(startIndex),
      ...USER_CONFIGURED_MODELS.slice(0, startIndex)
    ];
  } else {
    modelCascade = [startModel, ...USER_CONFIGURED_MODELS.filter(m => m !== startModel)];
  }

  let lastError: any = null;
  let currentKey: string | undefined = undefined;

  for (const modelToTry of modelCascade) {
    // Strictly do not cascade to gemini-3.5-flash-lite unless user explicitly selected it
    if (modelToTry === 'gemini-3.5-flash-lite' && startModel !== 'gemini-3.5-flash-lite') {
      continue;
    }

    const currentParams = {
      ...params,
      model: getValidModelName(modelToTry)
    };

    for (let attempt = 0; attempt < maxRetriesPerModel; attempt++) {
      try {
        const clientWrapper = getAiClient(currentKey);
        currentKey = clientWrapper.key;
        return await clientWrapper.client.models.generateContent(currentParams);
      } catch (err: any) {
        lastError = err;
        const errStr = String(err?.message || err);
        const isRateLimitOrTransient =
          errStr.includes('429') ||
          errStr.includes('RESOURCE_EXHAUSTED') ||
          errStr.includes('quota') ||
          errStr.includes('rate limit') ||
          errStr.includes('503') ||
          errStr.includes('UNAVAILABLE') ||
          errStr.includes('high demand') ||
          errStr.includes('overloaded') ||
          errStr.includes('fetch failed');

        if (!isRateLimitOrTransient) {
          console.warn(`[Gemini API] Non-retryable error on model ${modelToTry}:`, errStr);
          break;
        }

        console.warn(`[Gemini API] Model ${modelToTry} attempt ${attempt + 1} hit rate limit / transient error (${errStr}). Retrying with next key / next model in cascade...`);
        currentKey = getFallbackApiKey(currentKey);
        await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
      }
    }

    console.warn(`[Gemini API] Model ${modelToTry} exhausted retries. Cascading down to next model in order...`);
  }

  throw lastError || new Error("All configured Gemini models in cascade failed.");
}
/**
 * Local Deterministic Emergency Fallback
 * Guarantees zero data loss if Google API is completely unavailable.
 */
function generateLocalMergedFallback(
  transcribedText: string,
  selectedTemplate: { name: string; lines?: string[] }
): string[] {
  const lines: string[] = [];
  lines.push(selectedTemplate.name.toUpperCase());
  lines.push('*Clinical Profile:*');

  const baselineLines = selectedTemplate.lines || [];
  let inserted = false;

  for (const bl of baselineLines) {
    if (bl.toUpperCase().startsWith('IMPRESSION:') || bl.toUpperCase().startsWith('CONCLUSION:')) {
      if (!inserted) {
        lines.push(`BOLD::${transcribedText}`);
        inserted = true;
      }
      lines.push(bl);
    } else {
      lines.push(bl);
    }
  }

  if (!inserted) {
    lines.push(`BOLD::${transcribedText}`);
    lines.push(`IMPRESSION:###${transcribedText.replace(/[•\-\*]/g, '').trim()}`);
  }

  return lines;
}

export function normalizeClinicalProfileAndTechnique(lines: string[]): string[] {
  if (!lines || lines.length === 0) return lines;
  const result: string[] = [...lines];

  // Helper to extract clean text without markdown or prefixes
  const getRawText = (s: string) => {
    if (!s) return '';
    return s.replace(/^BOLD::\s*/, '')
      .replace(/^[\*\_#\s\u00a0\u200b]+/, '')
      .replace(/[\*\_#\s\u00a0\u200b]+$/, '')
      .trim();
  };

  // 1. Conjoined line at index 0 (e.g. "MRI SCAN OF RIGHT KNEE JOINTClinical profile: C/o...")
  const firstLine = result[0] || '';
  const firstRaw = getRawText(firstLine);
  if (firstRaw.includes('Clinical profile:') || firstRaw.includes('Clinical Profile:')) {
    const parts = firstLine.split(/(?=(?:Clinical profile:|Clinical Profile:))/i);
    if (parts.length > 1) {
      result[0] = parts[0].trim();
      const rest = parts.slice(1).join('').trim();
      result.splice(1, 0, rest);
    }
  }

  // 2. Case 1: "Clinical profile: C/o..." conjoined with "Technique: ..." in line 1 or 2
  for (let i = 1; i < Math.min(result.length, 5); i++) {
    const raw = getRawText(result[i]);
    const isCP = raw.toLowerCase().startsWith('clinical profile:') || raw.toLowerCase().startsWith('clinical history:');
    if (isCP && (raw.includes('Technique:') || raw.includes('Scanning technique:') || raw.includes('Protocol:'))) {
      const parts = result[i].split(/(?=(?:Technique:|Scanning technique:|Protocol:))/i);
      if (parts.length > 1) {
        result[i] = parts[0].trim();
        result.splice(i + 1, 0, parts.slice(1).join('').trim());
        break;
      }
    }
  }

  // 3. Case 2 & 3: Clinical profile header followed by conjoined technique & history
  for (let i = 1; i < Math.min(result.length - 1, 5); i++) {
    const lineI = result[i];
    const rawI = getRawText(lineI);
    const lineNext = result[i + 1];
    const rawNext = getRawText(lineNext);

    // Case 2: Line i is empty header "Clinical profile:", Line i+1 is "Technique: PD fs... C/o..."
    if (rawI.toLowerCase() === 'clinical profile:' || rawI.toLowerCase() === 'clinical history:') {
      const isTech = rawNext.toLowerCase().startsWith('technique:') || rawNext.toLowerCase().startsWith('scanning technique:');
      if (isTech && (rawNext.includes('C/o') || rawNext.includes('c/o') || rawNext.includes('H/o') || rawNext.includes('h/o') || rawNext.includes('pain') || rawNext.includes('swelling'))) {
        const splitMatch = lineNext.match(/^((?:BOLD::)?(?:\*|_)?(?:Technique|Scanning technique|Protocol):\s*[^.]+?\.)\s+(.+)$/i);
        if (splitMatch) {
          const techPart = splitMatch[1].trim();
          const historyPart = splitMatch[2].trim();
          result[i] = `Clinical profile: ${historyPart}`;
          result[i + 1] = techPart;
          break;
        }
      }
    }

    // Case 3: Line i is "Clinical profile:", Line i+1 is "Technique:", and line i+2 has conjoined text
    if (i + 2 < result.length && (rawI.toLowerCase() === 'clinical profile:' || rawI.toLowerCase() === 'clinical history:')) {
      if (rawNext.toLowerCase() === 'technique:' || rawNext.toLowerCase() === 'scanning technique:') {
        const lineAfter = result[i + 2];
        const rawAfter = getRawText(lineAfter);
        if (rawAfter.includes('C/o') || rawAfter.includes('c/o') || rawAfter.includes('pain') || rawAfter.includes('swelling')) {
          result[i] = `Clinical profile: ${rawAfter}`;
          result.splice(i + 2, 1);
          break;
        }
      }
    }
  }

  return result;
}

const getCleanMimeType = (blob: Blob, fileName?: string): string => {
    let mimeType = blob.type;
    const name = (fileName || (blob as any).name || '').toLowerCase();
    
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.mp3')) return 'audio/mp3';
    if (name.endsWith('.wav')) return 'audio/wav';
    if (name.endsWith('.m4a')) return 'audio/m4a';
    if (name.endsWith('.aac')) return 'audio/aac';
    if (name.endsWith('.flac')) return 'audio/flac';
    if (name.endsWith('.ogg')) return 'audio/ogg';
    if (name.endsWith('.mp4')) return 'video/mp4';
    if (name.endsWith('.mov')) return 'video/quicktime';
    if (name.endsWith('.avi')) return 'video/x-msvideo';
    if (name.endsWith('.png')) return 'image/png';
    if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
    if (name.endsWith('.webp')) return 'image/webp';
    if (name.endsWith('.gif')) return 'image/gif';

    if (!mimeType) {
        return 'audio/ogg';
    }
    if (mimeType.startsWith('audio/webm') || mimeType.startsWith('video/webm')) {
        return 'audio/webm';
    }
    return mimeType.split(';')[0];
};

export const prepareFileContentPart = async (blob: Blob, fileName?: string): Promise<{ textPart?: { text: string }; inlinePart?: { inlineData: { mimeType: string; data: string } } }> => {
  const name = fileName || (blob as any).name || '';
  if (isDocxBlob(blob, name)) {
    const text = await extractTextFromDocxBlob(blob);
    return {
      textPart: {
        text: `[Attached Word DOCX Context - ${name || 'Document'}]:\n${text || '(No readable text extracted)'}\n`
      }
    };
  }
  if (isTextBlob(blob, name)) {
    try {
      const text = await blob.text();
      return {
        textPart: {
          text: `[Attached Text Document Context - ${name || 'Document'}]:\n${text}\n`
        }
      };
    } catch {
      // Fallback
    }
  }
  const base64 = await blobToBase64(blob);
  const mimeType = getCleanMimeType(blob, name);
  return {
    inlinePart: {
      inlineData: {
        mimeType: mimeType,
        data: base64,
      }
    }
  };
};


const responseSchema = {
    type: Type.OBJECT,
    properties: {
        findings: {
            type: Type.ARRAY,
            items: {
                type: Type.STRING
            },
            description: "An array of strings, where each string is a corrected sentence or paragraph of the radiology findings."
        }
    }
};

export const getValidModelName = (model?: string): string => {
  if (!model) return 'gemini-3.5-flash';
  const m = model.toLowerCase().trim();
  
  if (m.includes('3.5-flash-lite') || m === 'gemini-3.5-flash-lite') {
    return 'gemini-3.5-flash-lite';
  }
  if (m.includes('3.5') || m === 'gemini-3.5-flash') {
    return 'gemini-3.5-flash';
  }
  if (m.includes('3.7') || m === 'gemini-3.7-flash') {
    return 'gemini-3.7-flash';
  }
  if (m.includes('3.6') || m === 'gemini-3.6-flash') {
    return 'gemini-3.6-flash';
  }
  if (m.includes('3.5-flash-lite') || m === 'gemini-3.5-flash-lite') {
    return 'gemini-3.5-flash-lite';
  }
  if (m.includes('3.5') || m === 'gemini-3.5-flash') {
    return 'gemini-3.5-flash';
  }
  if (m.includes('3-flash') || m === 'gemini-3-flash-preview') {
    return 'gemini-3-flash-preview';
  }
  if (m.includes('3.1-pro') || m === 'gemini-3.1-pro-preview') {
    return 'gemini-3.1-pro-preview';
  }
  if (m === 'gemini-2.5-flash' || m === 'gemini-2.5-pro' || m === 'gemini-2.0-flash' || m === 'gemini-2.0-flash-lite') {
    return m;
  }
  return model;
};

const audioTranscriptCache = new WeakMap<Blob, string>();

export const getCachedAudioTranscript = (audioBlob: Blob): string | undefined => {
  return audioTranscriptCache.get(audioBlob);
};

export const processAudioWithDocx = async (
  audioBlob: Blob, 
  model: string, 
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  existingFindings?: string[],
  batchName?: string,
  selectedTemplate?: { id?: string; name: string; category?: string; modality?: string; lines?: string[]; docxBase64?: string; skillPrompt?: string } | null,
  skillEnabled: boolean = true,
  activeSkillPrompt?: string
): Promise<{ findings: string[]; docxBlob?: Blob }> => {
  const isReprocessing = existingFindings && existingFindings.length > 0;

  // 2-STEP PIPELINE: When a template is selected for audio dictation
  if (selectedTemplate && selectedTemplate.lines && selectedTemplate.lines.length > 0 && !isReprocessing) {
    let transcribedText = audioTranscriptCache.get(audioBlob);
    if (!transcribedText || !transcribedText.trim()) {
      // Step 1: Transcribe audio to verbatim clinical text
      transcribedText = await transcribeAudioForPrompt(audioBlob, model);
      if (transcribedText) {
        audioTranscriptCache.set(audioBlob, transcribedText);
      }
    }

    if (!transcribedText || !transcribedText.trim()) {
      return { findings: selectedTemplate.lines };
    }

    // Step 2: Merge transcribed findings directly using mergeFindingsWithAst (identical to Merge Only mode)
    try {
      const astResult = await mergeFindingsWithAst(
        transcribedText,
        selectedTemplate,
        model,
        customPrompt,
        customImages,
        skillEnabled,
        activeSkillPrompt || (selectedTemplate as any).skillPrompt
      );
      if (astResult && astResult.findings && astResult.findings.length > 0) {
        return astResult;
      }
      const fallbackFindings = await mergeFindingsWithTemplate(transcribedText, selectedTemplate, model, customPrompt, customImages);
      return { findings: fallbackFindings };
    } catch (step2Error: any) {
      console.warn('AST merge failed, trying mergeFindingsWithTemplate fallback:', step2Error);
      try {
        const fallbackFindings = await mergeFindingsWithTemplate(transcribedText, selectedTemplate, model, customPrompt, customImages);
        return { findings: fallbackFindings };
      } catch (fallbackErr) {
        console.warn('Generating emergency local merged fallback:', fallbackErr);
        return { findings: generateLocalMergedFallback(transcribedText, selectedTemplate) };
      }
    }
  }

  // Fallback direct audio pipeline
  const directFindings = await processAudio(audioBlob, model, customPrompt, customImages, existingFindings, batchName, selectedTemplate);
  return { findings: directFindings };
};


export const processAudio = async (
  audioBlob: Blob, 
  model: string, 
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  existingFindings?: string[],
  batchName?: string,
  selectedTemplate?: { id?: string; name: string; category?: string; modality?: string; lines?: string[] } | null
): Promise<string[]> => {
  const isReprocessing = existingFindings && existingFindings.length > 0;

  // 2-STEP PIPELINE: When a template is selected for audio dictation
  if (selectedTemplate && selectedTemplate.lines && selectedTemplate.lines.length > 0 && !isReprocessing) {
    let transcribedText = audioTranscriptCache.get(audioBlob);
    if (!transcribedText || !transcribedText.trim()) {
      // Step 1: Transcribe audio to verbatim clinical text
      transcribedText = await transcribeAudioForPrompt(audioBlob, model);
      if (transcribedText) {
        audioTranscriptCache.set(audioBlob, transcribedText);
      }
    }

    if (!transcribedText || !transcribedText.trim()) {
      return selectedTemplate.lines;
    }

    // Step 2: Merge transcribed findings using the exact AST-based merger (identical to Merge Only Mode)
    try {
      const { findings } = await mergeFindingsWithAst(
        transcribedText,
        selectedTemplate,
        model,
        customPrompt,
        customImages,
        true,
        (selectedTemplate as any).skillPrompt
      );
      if (findings && findings.length > 0) {
        return findings;
      }
      return await mergeFindingsWithTemplate(transcribedText, selectedTemplate, model, customPrompt, customImages);
    } catch (step2Error: any) {
      console.warn('AST merge failed, trying mergeFindingsWithTemplate fallback:', step2Error);
      try {
        return await mergeFindingsWithTemplate(transcribedText, selectedTemplate, model, customPrompt, customImages);
      } catch (fallbackErr) {
        console.warn('Generating emergency local merged fallback:', fallbackErr);
        return generateLocalMergedFallback(transcribedText, selectedTemplate);
      }
    }
  }

  const fileName = (audioBlob as any).name;
  const fileContent = await prepareFileContentPart(audioBlob, fileName);

  const hasCustomImages = customImages && customImages.length > 0;
  const hasCustomText = customPrompt && customPrompt.trim().length > 0;

  let basePrompt: string;

  if (isReprocessing) {
      basePrompt = REPROCESS_GEMINI_PROMPT;
  } else if (hasCustomImages || hasCustomText) {
      basePrompt = STRICT_CUSTOM_TEMPLATE_GEMINI_PROMPT;
      if (hasCustomText) {
          basePrompt += `\n\n--- MANDATORY REPORT TEMPLATE & CUSTOM INSTRUCTIONS ---\n${customPrompt}\n--- END TEMPLATE ---`;
      }
  } else {
      basePrompt = DEFAULT_GEMINI_PROMPT;
  }

  // Augment base prompt with matching real-world report exemplars from 100K+ report dataset (NEWWWWW.zip)
  try {
    if (isRAGStyleMatchingEnabled()) {
      const hintText = [batchName, customPrompt, existingFindings ? existingFindings.join(' ') : ''].filter(Boolean).join(' ');
      const styleTemplates = await getRelevantStyleTemplates(hintText || 'Radiology Scan');
      if (styleTemplates.length > 0) {
        basePrompt = augmentPromptWithStyleTemplates(basePrompt, styleTemplates);
      }
    }
  } catch (err) {
    console.warn('RAG style matching lookup failed:', err);
  }
  
  const prompt = basePrompt;

  const parts: any[] = [];

  if (hasCustomImages) {
    for (const customImage of customImages) {
        parts.push({
            inlineData: {
                mimeType: customImage.mimeType,
                data: customImage.data,
            },
        });
    }
    parts.push({
      text: `STRICT VISUAL LAYOUT DIRECTIVE: The user provided ${customImages.length > 1 ? 'images' : 'an image'} of their exact report template structure above. You MUST strictly follow the exact layout, headings, and formatting shown in ${customImages.length > 1 ? 'these images' : 'this image'} to structure your response.`
    });
  }
  
  if (isReprocessing) {
    parts.push({ text: `Here is the existing transcript to start from:\n\n${JSON.stringify({ findings: existingFindings })}` });
  }

  parts.push({ text: prompt });
  if (fileContent.textPart) {
    parts.push(fileContent.textPart);
  }
  if (fileContent.inlinePart) {
    parts.push(fileContent.inlinePart);
  }

  
  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName(model),
      contents: parts,
      config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
      }
    });

    const jsonString = response.text;
    if (!jsonString) {
      throw new Error("API returned an empty response.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return result.findings;
    } else {
      throw new Error("Invalid data structure in API response. Expected a 'findings' array.");
    }
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to process audio: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API.");
  }
};

export const continueAudioDictation = async (existingText: string, audioBlob: Blob, customPrompt?: string): Promise<string> => {
  const base64Audio = await blobToBase64(audioBlob);

  let prompt = `You are an expert medical transcriptionist specializing in radiology. A user is adding to their dictation.
The existing text is: "${existingText}".

Your task is to transcribe and correct ONLY the new audio provided. Your transcription should be a direct continuation of the existing text.

Follow these strict instructions to produce a clean and accurate continuation:
1. Analyze each word from the new audio for its contextual meaning within radiology and replace any incorrect words with the proper medical terminology. For example, a speech-to-text tool might misinterpret 'radiology findings' as something unrelated.
2. **Specific Transcription Rules**:
    - Transcribe "few" exactly as "few", not "a few".
    - Replace the dictated word "query" with a question mark symbol "?".
    - Transcribe "status post" as the abbreviation "S/p".
    - Format dictated dimensions like "8 mm into 9 mm" as "8 x 9 mm".
    - For comparative phrases like "right more than left", use the format "(R > L)". Similarly, for "left more than right", use "(L > R)".
    - Abbreviate "complaints of" to "C/o".
    - Abbreviate "history of" to "H/o".
3. Completely ignore all non-verbal sounds (like coughing, sneezing) and any irrelevant side-conversations from the new audio. However, you MUST include any dictation related to the clinical profile or patient information.
4. If the new audio includes languages other than English, transcribe and translate the relevant medical findings into proper English.
5. Do not repeat any of the existing text in your output.
6. Your final output must be ONLY the newly corrected text, with no additional commentary, introductions, or explanations. Do not use any markdown formatting (like asterisks for bolding).`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions:\n${customPrompt}`;
  }

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };

  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName('gemini-2.0-flash-lite'),
      contents: [textPart, audioPart],
    });

    const resultText = response.text?.trim();
    if (!resultText) {
      throw new Error("API returned an empty response for audio continuation.");
    }
    return resultText;
  } catch (error) {
    console.error("Error calling Gemini API for audio continuation:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to process audio continuation: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for audio continuation.");
  }
};

export const modifyFindingWithAudio = async (originalText: string, audioBlob: Blob, customPrompt?: string): Promise<string> => {
  const base64Audio = await blobToBase64(audioBlob);

  let prompt = `You are an expert medical transcriptionist assistant. You will be given an existing medical finding text and an audio recording. The audio contains instructions and/or additional dictation to modify the original finding.

Your task is to return a single, updated string that intelligently incorporates the changes from the audio.
- If the audio provides additional details, integrate them coherently and grammatically into the existing text.
- If the audio provides an explicit instruction (e.g., "change 'normal' to 'unremarkable'", "remove the last sentence"), apply that instruction precisely.
- Correct any speech-to-text errors in the new dictation, following these specific transcription rules:
    - Transcribe "few" exactly as "few", not "a few".
    - Replace the dictated word "query" with a question mark symbol "?".
    - Transcribe "status post" as the abbreviation "S/p".
    - Format dictated dimensions like "8 mm into 9 mm" as "8 x 9 mm".
    - For comparative phrases like "right more than left", use the format "(R > L)". Similarly, for "left more than right", use "(L > R)".
    - Abbreviate "complaints of" to "C/o".
    - Abbreviate "history of" to "H/o".
- Your final output must be ONLY the modified text, with no additional commentary, introductions, or explanations. Do not use any markdown formatting.

Existing Finding:
"${originalText}"

Now, listen to the audio and provide the single, updated finding text.`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions:\n${customPrompt}`;
  }

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };

  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName('gemini-2.5-flash'),
      contents: [textPart, audioPart],
    });

    const resultText = response.text?.trim();
    if (!resultText) {
      throw new Error("API returned an empty response for finding modification.");
    }
    return resultText;
  } catch (error) {
    console.error("Error calling Gemini API for finding modification:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to process finding modification: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for finding modification.");
  }
};

export const modifyReportWithAudio = async (
  currentFindings: string[], 
  audioBlob: Blob, 
  model: string, 
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null
): Promise<string[]> => {
  const base64Audio = await blobToBase64(audioBlob);

  let prompt = `You are an expert medical transcriptionist assistant. You are given an existing medical report in JSON format and an audio recording containing instructions to modify it. Your task is to intelligently interpret the audio instructions and return a single, updated report in the exact same JSON format.

**Core Instructions:**

1.  **Preserve by Default:** Your primary goal is to modify the existing report. **You MUST preserve all original findings unless the audio instruction explicitly tells you to remove, replace, or merge them.** Do not discard existing information.

2.  **Formatting for Boldness**:
    *   **Adding New Findings**: When the audio instruction is to add a new clinical finding (e.g., "Add a finding: There is a small lesion..."), you MUST prefix the new finding string with the special marker \`BOLD::\`.
    *   **Preserving Existing Boldness**: When editing an existing finding, if the original finding in the JSON already starts with \`BOLD::\`, the modified finding MUST also start with \`BOLD::\`. If the original did not have the prefix, do not add it.
    *   **Exceptions**: Do NOT add the \`BOLD::\` prefix to the "Clinical Profile" string or the "IMPRESSION" string, as they have their own special formatting rules.

3.  **Interpret Instructions Accurately:** Carefully listen to the audio to understand the user's intent. Instructions can be about:
    *   **Editing:** "Change 'normal' to 'unremarkable' everywhere."
    *   **Removing:** "Remove the sentence about the bony structures."
    *   **Adding:** "Add a new finding: The patient has a history of hypertension." (This will be a new line with the \`BOLD::\` prefix).
    *   **Reordering:** "Move the lung findings to the top."
    *   **Synthesizing/Summarizing:** "Create an impression based on the findings." or "Summarize the key findings."

4.  **Impression Generation and Formatting:** If an audio instruction involves creating, generating, or modifying an "IMPRESSION", you MUST follow these rules:
    *   **Generation from Findings:** If asked to generate an impression from the findings, first analyze the entire report. Then, formulate the new impression points based on these strict criteria:
        *   Impressions must be concise and formulated without using verbs (e.g., "Patches of contusion" instead of "There are patches of contusion").
        *   Combine multiple related findings, including all their key descriptors (like diffusion restriction, enhancement patterns, etc.), into single, coherent impression points to ensure the summary is both concise and complete.
        *   List unrelated findings (e.g., hepatomegaly and splenomegaly) as separate points.
        *   Impressions must NOT contain any numerical values or measurements.
        *   If clinically relevant, you may add concluding phrases like "likely infective etiology" or "likely inflammatory etiology" or "likely neoplastic etiology” or “likely reactive” or “suggested clinical correlation/ review as indicated” or similar phrases. Avoid vague, non-committal conclusions when a more specific diagnosis is possible.
    *   **Formatting:** The entire impression MUST be a single string in the "findings" array. It must start with "IMPRESSION:" (all caps), followed by '###', then each point separated by '###'.
    *   **Adding/Replacing:** Add the newly generated impression as the last finding. If an impression already exists, replace it with the new one.

5.  **Special Clinical Profile Formatting:** If a clinical profile is present, added, or modified, it MUST be a single string that starts with "Clinical Profile:" and is wrapped in single asterisks (e.g., "*Clinical Profile: ...*").

6.  **Format Output Correctly:**
    *   Your final output must be ONLY the modified report, in the same JSON object format as the original, with a key named "findings" whose value is an array of strings.
    *   Do not add any commentary, explanations, or markdown formatting (like \`\`\`json).
    *   Correct any speech-to-text errors from the instruction audio itself before applying the changes, following these rules:
        - Abbreviate "complaints of" to "C/o".
        - Abbreviate "history of" to "H/o".

**Example Scenario:**

*   **Existing Report Input:**
    \`\`\`json
    {
      "findings": [
        "The cardiomediastinal silhouette is within normal limits.",
        "Lungs are clear without evidence of focal consolidation."
      ]
    }
    \`\`\`
*   **Audio Instruction:** "Create an impression: No acute abnormalities."
*   **Correct JSON Output:**
    \`\`\`json
    {
      "findings": [
        "The cardiomediastinal silhouette is within normal limits.",
        "Lungs are clear without evidence of focal consolidation.",
        "IMPRESSION:###No acute abnormalities."
      ]
    }
    \`\`\`
*   **Audio Instruction (Multi-Point):** "Create an impression. First point, hepatomegaly. Second point, splenomegaly."
*   **Correct JSON Output (replaces any existing impression):**
    \`\`\`json
    {
      "findings": [
        "The cardiomediastinal silhouette is within normal limits.",
        "Lungs are clear without evidence of focal consolidation.",
        "IMPRESSION:###Hepatomegaly.###Splenomegaly."
      ]
    }
    \`\`\`

**Existing Report:**
${JSON.stringify({ findings: currentFindings })}
`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions when processing the request:\n${customPrompt}`;
  }

  const parts: any[] = [];
  
  if (customImages && customImages.length > 0) {
    for (const customImage of customImages) {
        parts.push({
          inlineData: {
            mimeType: customImage.mimeType,
            data: customImage.data
          }
        });
    }
    parts.push({ text: `The user has provided ${customImages.length > 1 ? 'images' : 'an image'} of a report template. If the audio instruction is to reformat the report, use ${customImages.length > 1 ? 'these images' : 'this image'} as a strict visual guide.` });
  }

  parts.push({ text: prompt });
  parts.push({
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  });
  
  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName(model),
      contents: parts,
      config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
      }
    });

    const jsonString = response.text;
    if (!jsonString) {
      throw new Error("API returned an empty response for report modification.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return result.findings;
    } else {
      throw new Error("Invalid data structure in API response. Expected a 'findings' array.");
    }
  } catch (error) {
    console.error("Error calling Gemini API for report modification:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to modify report: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for report modification.");
  }
};

export const modifyReportWithText = async (
  currentFindings: string[], 
  instructionText: string, 
  model: string, 
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null
): Promise<string[]> => {
  let prompt = `You are an expert medical transcriptionist assistant. You are given an existing medical report in JSON format and written instructions to modify it. Your task is to intelligently interpret the instructions and return a single, updated report in the exact same JSON format.

**Core Instructions:**
1.  **Preserve by Default:** Your primary goal is to modify the existing report. **You MUST preserve all original findings unless the instruction explicitly tells you to remove, replace, or merge them.** Do not discard existing information.
2.  **Formatting for Boldness**:
    *   **Adding New Findings**: When the instruction is to add a new clinical finding, prefix the new finding string with the special marker \`BOLD::\`.
    *   **Preserving Existing Boldness**: When editing an existing finding, if the original finding in the JSON already starts with \`BOLD::\`, the modified finding MUST also start with \`BOLD::\`.
    *   **Exceptions**: Do NOT add the \`BOLD::\` prefix to the "Clinical Profile" string or the "IMPRESSION" string.
3.  **Interpret Instructions Accurately:** (e.g., editing specific phrases, removing findings, adding findings, reordering, synthesizing impression).
4.  **Impression Generation:** If an instruction involves creating or modifying an IMPRESSION, formulate concise impression points without verbs or numerical values, formatted as a single string starting with "IMPRESSION:###point 1###point 2...".
5.  **Special Clinical Profile Formatting:** If present or added, format as "*Clinical Profile: ...*".
6.  **Format Output Correctly:** Return ONLY a JSON object with a key named "findings" whose value is an array of strings.

**Existing Report:**
${JSON.stringify({ findings: currentFindings })}

**User Instruction:**
"${instructionText}"
`;

  if (customPrompt) {
    prompt += `\n\nAdditionally, follow these custom instructions when processing the request:\n${customPrompt}`;
  }

  const parts: any[] = [];
  
  if (customImages && customImages.length > 0) {
    for (const customImage of customImages) {
        parts.push({
          inlineData: {
            mimeType: customImage.mimeType,
            data: customImage.data
          }
        });
    }
    parts.push({ text: `The user has provided ${customImages.length > 1 ? 'images' : 'an image'} of a report template. If the instruction is to reformat the report, use ${customImages.length > 1 ? 'these images' : 'this image'} as a strict visual guide.` });
  }

  parts.push({ text: prompt });
  
  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName(model),
      contents: parts,
      config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema
      }
    });

    const jsonString = response.text;
    if (!jsonString) {
      throw new Error("API returned an empty response for report modification.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return result.findings;
    } else {
      throw new Error("Invalid data structure in API response. Expected a 'findings' array.");
    }
  } catch (error) {
    console.error("Error calling Gemini API for text report modification:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to modify report: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for text report modification.");
  }
};

export const mergeFindingsWithAst = async (
  findingsText: string,
  selectedTemplate: { id?: string; name: string; category?: string; modality?: string; lines?: string[]; docxBase64?: string; skillPrompt?: string },
  model: string,
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  skillEnabled: boolean = true,
  activeSkillPrompt?: string
): Promise<{ findings: string[]; docxBlob?: Blob }> => {
  if (!selectedTemplate.docxBase64) {
    const findings = await mergeFindingsWithTemplate(findingsText, selectedTemplate, model, customPrompt, customImages, skillEnabled, activeSkillPrompt);
    return { findings };
  }

  try {
    const { ast, xmlDoc, zipEntries, pMap, cellMap, impressionHeaderId, impressionSlotIds } = await buildDocumentAstFromDocx(selectedTemplate.docxBase64);

    // Cross-Modality Auto-Skill Discovery for AST Merger
    const secondarySkills = (skillEnabled !== false)
      ? findCrossModalitySkills(findingsText, selectedTemplate.id)
      : [];

    let crossSkillBlock = '';
      crossSkillBlock = `\n\n### ⚡ CROSS-MODALITY & INCIDENTAL PATHOLOGY CONSULTANT DIRECTIVES (Auto-Detected Secondary Skills):\nThe radiologist's dictation includes clinical findings related to adjacent or incidental organ systems. You MUST cross-reference the following specialized consultant directives for those findings:\n` + secondarySkills.map(s => `[CROSS-MODALITY SKILL: ${s.name} (${s.category || 'Specialized'})]:\n${s.skillPrompt}`).join('\n\n') + `\n*Directive for Cross-Modality Findings*: Use the exact consultant grading, AST pathological translation, and diagnostic criteria from the matching secondary skill above.`;

    const titleNode = ast.find(n => n.type === 'title');
    const docTitle = titleNode?.current_text?.trim() || selectedTemplate.lines?.[0] || selectedTemplate.name;

    const astPrompt = `You are an expert radiology report integration engine.
Your task is to merge the radiologist's findings into the target document's exact Abstract Syntax Tree (AST) nodes.

### ZERO CONVERSATIONAL FILLER MANDATE:
Do NOT output any conversational preamble, commentary, AI pleasantries, or sign-offs. Produce ONLY pure clinical data in the JSON schema.

## TARGET DOCUMENT AST NODES:
${JSON.stringify(ast, null, 2)}

---

## RADIOLOGIST'S DICTATED / PROVIDED FINDINGS:
"""
${findingsText}
"""

---

## STRICT AST SURGERY & 100% CLINICAL FIDELITY RULES:
1. **100% Comprehensive Clinical Ingestion**:
   - EVERY observation, measurement, pathology, and clinical history dictated by the radiologist MUST be completely included in the final report.
2. **Surgical Node Updates, Clinical Profile Placement & Contradiction Removal**:
   - Map each clinical finding to its most appropriate anatomical node_id.
   - **Clinical Profile / History Placement**: Always map the clinical history / patient complaint to the "Clinical profile:" or "Indication:" node at the top of the report (written as "Clinical profile: ..."). NEVER insert Clinical Profile at the bottom.
   - **Baseline Normal Sentence Overwrite**: When an anatomical structure is dictated with an abnormal finding (e.g. SI joint degenerative changes, facet arthropathy, disc bulge), you MUST target the baseline normal template node for that structure (e.g. "SI joints and pubic symphysis appears normal" or "No disc bulge or protrusion is seen") in "updates" to overwrite it with the abnormal finding. NEVER leave the baseline normal sentence untouched or duplicated alongside the abnormal finding.
   - **Mingled Sentence Handling**: If a baseline template node combines multiple anatomical concepts (e.g. "The basal cisterns, cortical sulci and sylvian fissures are normal") and only one structure is abnormal (e.g. cortical sulcal prominence), rewrite that node so the normal structures are retained (e.g. "The basal cisterns are normal.") and the abnormal finding is accurately documented.
   - **Automatic Contradiction Removal**: If an abnormal finding supersedes, covers, or contradicts an existing baseline normal node (e.g. ventricular atrophy finding supersedes normal ventricular system node, or disc bulge finding supersedes 'no significant disc bulge' node), you MUST include that superseded normal node in "updates" with "new_text": "" (empty string) so it is cleanly removed from the Word document with zero leftover contradictory text.
   - For unaffected normal nodes, do NOT include them in "updates" (they remain 100% intact with their original template styles).
3. **5-Layer Structural DNA & BOLD Protocol**:
   - Update Clinical Profile node if history/indication is dictated (written as "Clinical profile: ...").
   - In "display_findings", produce the full ordered report array:
     Layer 1: Exact Template Title: "${docTitle}" (MUST preserve the exact template document title verbatim without changing, shortening, or removing any words like MRI/CT) -> "Clinical profile: ..." (or "Clinical profile:") -> Technique -> Findings (prefix modified lines with "BOLD::", preserve normal lines verbatim without "BOLD::") -> Synthesized Impression starting with "IMPRESSION:###".
4. **TABLE & MEASUREMENT GRID POPULATION MANDATE**:
   - When the target template contains table cells (nodes with type: "table_cell" and IDs like "tbl_X_r_Y_c_Z", pulmonary artery dimension tables, PE clot load matrices, cardiac functional parameter tables, etc.):
     a) In "updates": You MUST map every dictated measurement, dimension, or segmental pathology directly to its exact table_cell node_id with the dictated value (e.g. {"node_id": "tbl_0_r_1_c_1", "new_text": "3.4 cm", "bold": true}) and set "bold": true for modified/abnormal values.
     b) In "display_findings": You MUST output the complete report retaining all table rows in pipe-delimited format (e.g. "BOLD::MPA | 3.4 cm", "BOLD::Apical (RA1) | + | - | - | - | - | - | -"), filling in all dictated measurements and positive signs into their respective row and column slots. Unaffected baseline table rows must be retained verbatim without BOLD:: (e.g. "LPA | " or "Posterior (RA3) | - | - | - | - | - | - | -"). NEVER omit table rows or leave dictated table cells blank.
5. **Vague Dictation Translation**:
   - Translate colloquial phrases into formal consultant terminology: "fuzzy liver thing" -> "Ill-defined focal lesion in segment VI...", "whited out left base" -> "Homogeneous dense opacification of the left hemithorax base...", "dirty fat around appendix" -> "Blind-ending thickened appendix with surrounding fat stranding...", "bright spot on dwi" -> "Focal area of acute restricted diffusion on DWI...", "torn meniscus" -> "Linear high signal intensity... consistent with meniscal tear", "broken hip ball" -> "Displaced subcapital fracture of femoral neck".
6. **RADS Scoring Standards**:
   - BI-RADS (0-6), PI-RADS v2.1 (PZ vs TZ sequence dominance, categories 1-5), TI-RADS (TR1-TR5), LI-RADS (LR-1 to LR-5), Lung-RADS v2022 (Categories 1-4X), CAD-RADS 2.0 (0-5 with modifiers).
7. **Cross-Template Contamination Isolation**:
   - Restrict findings strictly to the active template's anatomical domain. Do NOT merge mismatched organ findings into unrelated template nodes.
8. **Non-Verb Impression Synthesis**:
   - Synthesize concise, non-verb bullet points under "impression": ["Point 1", "Point 2"].
   - In "display_findings", format impression as: "IMPRESSION:###Point 1###Point 2".
   - If all findings normal: "IMPRESSION:###Normal study.###No significant abnormality detected."
9. **TITLE IMMUTABILITY MANDATE**:
   - The document title belongs strictly to the template document and MUST NOT be altered, shortened, or replaced by outside UI names or abbreviations. Do NOT include any title node in "updates".
10. **BRAND-NEW / INCIDENTAL FINDINGS MANDATE ("insertions")**:
   - If the radiologist dictates a pathology, measurement, or incidental finding that does NOT have a corresponding baseline node in the template AST (e.g. pleural effusion, atelectasis, lymphadenopathy, incidental cysts, fractures), you MUST include it in "insertions" specifying:
     { "after_node_id": "<id of the preceding paragraph or paragraph immediately before IMPRESSION>", "text": "Exact clinical finding text", "bold": false }
   - Also ensure it is present in "display_findings" at that exact same sequential position.
11. Return JSON schema:
{
  "updates": [
    { "node_id": "node_...", "new_text": "...", "bold": true }
  ],
  "insertions": [
    { "after_node_id": "node_...", "text": "...", "bold": false }
  ],
  "impression": ["..."],
  "display_findings": ["..."]
}
${(skillEnabled && (activeSkillPrompt || (selectedTemplate as any).skillPrompt)) ? `\n=== PRIMARY CONSULTANT SKILL DIRECTIVES ===\n${activeSkillPrompt || (selectedTemplate as any).skillPrompt}\n` : ''}
${customPrompt ? `\nAdditional Instructions:\n${customPrompt}` : ''}
`;

    const parts: any[] = [];
    if (customImages && customImages.length > 0) {
      for (const customImage of customImages) {
        parts.push({
          inlineData: {
            mimeType: customImage.mimeType,
            data: customImage.data,
          },
        });
      }
    }
    parts.push({ text: astPrompt });

    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName(model),
      contents: parts,
      config: {
        responseMimeType: "application/json",
      },
    });

    const jsonString = response.text;
    if (jsonString) {
      const cleaned = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
      const result = JSON.parse(cleaned);

      const updates: AstMutation[] = Array.isArray(result.updates) ? result.updates : [];
      const rawInsertions: any[] = Array.isArray(result.insertions)
        ? result.insertions
        : (Array.isArray(result.inserted_findings) ? result.inserted_findings : []);
      let impression: string[] = Array.isArray(result.impression) ? result.impression : [];
      const displayFindings: string[] = Array.isArray(result.display_findings) && result.display_findings.length > 0
        ? result.display_findings
        : [];

      // Fallback: If result.impression is empty, extract bullet points directly from displayFindings
      if (impression.length === 0 && displayFindings.length > 0) {
        let inImp = false;
        for (const line of displayFindings) {
          const u = line.trim().toUpperCase();
          if (u === 'IMPRESSION:' || u.startsWith('IMPRESSION:') || u === 'CONCLUSION:' || u.startsWith('CONCLUSION:')) {
            inImp = true;
            if (line.includes('###')) {
              const parts = line.split('###').slice(1);
              for (const p of parts) {
                const cleanP = p.replace(/^BOLD::\s*/, '').replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
                if (cleanP) impression.push(cleanP);
              }
            }
            continue;
          }
          if (inImp) {
            const cleanP = line.replace(/^BOLD::\s*/, '').replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim();
            if (cleanP) impression.push(cleanP);
          }
        }
      }

      // Ensure all impression items have BOLD:: stripped from text
      impression = impression.map(item => item.replace(/^BOLD::\s*/, '').replace(/^[\s\u00a0\u200b\u2022\u2023\u2043\u2219\u25cf\u25cb\u25e6\u2013\u2014\-\u2022\*\d\.]+/gu, '').trim()).filter(Boolean);

      // Filter out any mutation targeting the title node or impression header so template structure is 100% protected
      const safeUpdates = updates.filter(u => {
        const targetNode = ast.find(n => n.id === u.node_id);
        return targetNode?.type !== 'title' && targetNode?.type !== 'impression_header';
      });

      // Ensure displayFindings[0] uses the exact template document title verbatim
      if (displayFindings.length > 0 && docTitle) {
        displayFindings[0] = docTitle;
      }

      const rawFinalFindings = displayFindings.length > 0 ? displayFindings : (selectedTemplate.lines || [selectedTemplate.name]);
      const finalFindings = normalizeClinicalProfileAndTechnique(rawFinalFindings);

      // Convert rawInsertions to typed AstInsertion[]
      const explicitInsertions: AstInsertion[] = rawInsertions
        .filter((ins: any) => ins && (ins.text || ins.new_text))
        .map((ins: any) => ({
          after_node_id: ins.after_node_id,
          text: (ins.text || ins.new_text || '').replace(/^BOLD::\s*/, ''),
          bold: ins.bold ?? (ins.text || ins.new_text || '').startsWith('BOLD::'),
        }));

      // Auto-detect any additional / incidental findings present in displayFindings but missing from safeUpdates & insertions
      const autoInsertions: AstInsertion[] = [];
      const knownInsertedTexts = new Set(explicitInsertions.map(ins => ins.text.toLowerCase().trim()));

      let inImpSection = false;
      for (let i = 1; i < finalFindings.length; i++) {
        const line = finalFindings[i];
        if (!line) continue;
        const cleanLine = line.replace(/^BOLD::\s*/, '').trim();
        const upper = cleanLine.toUpperCase();
        if (upper.startsWith('IMPRESSION:') || upper.startsWith('CONCLUSION:')) {
          inImpSection = true;
          continue;
        }
        if (inImpSection) continue;
        if (cleanLine.toLowerCase().startsWith('clinical profile:') || cleanLine.toLowerCase().startsWith('technique:')) continue;
        if (cleanLine.endsWith(':') && cleanLine.length < 50) continue; // Section heading
        if (cleanLine.includes('|')) continue; // Table row

        // Check if this finding was matched to any node in safeUpdates
        const wasUpdated = safeUpdates.some(u => {
          const uClean = (u.new_text || '').replace(/^BOLD::\s*/, '').trim();
          return uClean === cleanLine || uClean.includes(cleanLine) || cleanLine.includes(uClean);
        });

        // Check if this finding matches an unchanged baseline template node
        const isBaselineNormal = ast.some(n => {
          if (n.type === 'table_cell' || n.type === 'title' || n.type === 'impression_header' || n.type === 'impression_item') return false;
          const nClean = n.current_text.trim();
          return nClean.toLowerCase() === cleanLine.toLowerCase();
        });

        if (!wasUpdated && !isBaselineNormal && !knownInsertedTexts.has(cleanLine.toLowerCase())) {
          knownInsertedTexts.add(cleanLine.toLowerCase());
          autoInsertions.push({
            after_node_id: undefined,
            text: cleanLine,
            bold: line.startsWith('BOLD::'),
          });
        }
      }

      const allSafeInsertions: AstInsertion[] = [...explicitInsertions, ...autoInsertions];

      // Build DOCX: Use API's structured node_id mutations directly (covers table cells and incidental findings),
      // then fall back to text-based merger if the direct approach produces no mutations.
      let docxBlob: Blob;
      if (safeUpdates.length > 0 || allSafeInsertions.length > 0 || impression.length > 0) {
        try {
          docxBlob = await applyAstMutationsToDocx(
            xmlDoc,
            zipEntries,
            pMap,
            cellMap,
            safeUpdates,
            impression,
            impressionSlotIds,
            impressionHeaderId,
            allSafeInsertions
          );
        } catch (directErr) {
          console.warn('Direct AST mutation failed, falling back to text-based merger:', directErr);
          docxBlob = await mergeFindingsIntoDocxWithAstEngine(
            selectedTemplate.docxBase64,
            finalFindings
          );
        }
      } else {
        docxBlob = await mergeFindingsIntoDocxWithAstEngine(
          selectedTemplate.docxBase64,
          finalFindings
        );
      }
      return { findings: finalFindings, docxBlob };
    }
  } catch (astErr) {
    console.warn('AST merge failed, falling back to standard merger:', astErr);
  }

  const findings = await mergeFindingsWithTemplate(findingsText, selectedTemplate, model, customPrompt, customImages, skillEnabled, activeSkillPrompt);
  return { findings };
};


export const mergeFindingsWithTemplate = async (
  findingsText: string,
  selectedTemplate: { id?: string; name: string; category?: string; modality?: string; lines?: string[]; docxBase64?: string; skillPrompt?: string },
  model: string,
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  skillEnabled: boolean = true,
  activeSkillPrompt?: string
): Promise<string[]> => {
  const normalFindingsText = selectedTemplate.lines && selectedTemplate.lines.length > 0
    ? selectedTemplate.lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
    : selectedTemplate.name;

  const templateDocTitle = selectedTemplate.lines && selectedTemplate.lines.length > 0
    ? selectedTemplate.lines[0]
    : selectedTemplate.name;

    const consultantSkill = (skillEnabled !== false && (activeSkillPrompt || selectedTemplate.skillPrompt)) 
    ? (activeSkillPrompt || selectedTemplate.skillPrompt)
    : '';

  const prompt = `You are an expert radiologist and medical transcriptionist.
Your task is to merge the radiologist's findings directly into the target standard radiology report template.

### ZERO CONVERSATIONAL FILLER MANDATE:
Do NOT include any conversational preamble, pleasantries, commentary, or sign-offs. Produce ONLY pure clinical report strings within the JSON array.

## TARGET REPORT TEMPLATE:
Title: ${templateDocTitle}
Modality: ${selectedTemplate.modality || selectedTemplate.category || 'Radiology'}
Category: ${selectedTemplate.category || 'Standard'}

Normal Template Structure & Sections:
${normalFindingsText}

${consultantSkill ? `\n--- \n## ⚡ CONSULTANT SKILL DIRECTIVES (${selectedTemplate.name}):\n${consultantSkill}\n---` : ''}

---

## RADIOLOGIST'S DICTATED / PROVIDED FINDINGS:
"""
${findingsText}
"""

---

## STRICT 5-LAYER MERGING AND INTEGRATION RULES:
1. **5-Layer Structural Hierarchy**:
   - Layer 1: Title: ${templateDocTitle} (Use the EXACT title from the template document verbatim. NEVER alter, truncate, or replace with outside text)
   - Layer 2: Clinical Profile: format as "*Clinical Profile: C/o [complaint] with H/o [history].*" or "*Clinical Profile:*" if none provided.
   - Layer 3: Scanning Technique: preserve the template's technique line.
   - Layer 4: Anatomical Findings: organized by anatomical subsystem.
   - Layer 5: Synthesized Impression: starting with "IMPRESSION:###".
2. **Deterministic Baseline Preservation & BOLD Marker Protocol**:
   - For any organ/structure where abnormal or dictated findings were provided, replace or update the normal description with the patient's actual finding and prefix that abnormal/dictated line with "BOLD::".
   - For all other structures where no abnormality was mentioned, keep the standard normal baseline line from the template VERBATIM, without "BOLD::".
3. **Vague Dictation Translation & RADS Scoring**:
   - Translate colloquial radiologist dictation into formal board-certified terminology ("fuzzy liver thing" -> "Ill-defined focal lesion in segment VI...", "whited out base" -> "Homogeneous dense opacification...", "dirty fat" -> "perilesional fat stranding...").
   - Apply standardized scoring criteria for BI-RADS, PI-RADS v2.1, TI-RADS, LI-RADS, Lung-RADS v2022, CAD-RADS 2.0.
4. **Contamination Isolation Gate**:
   - Strictly map findings to the active template's anatomical domain. Do NOT overwrite baseline normal organs with mismatched organ findings. Place out-of-domain incidental findings in a distinct paragraph before the impression.
5. **TABLE & MEASUREMENT GRID POPULATION MANDATE**:
   - When the template contains tables, measurement grids, or pipe-separated rows (|) (such as CTPA arterial measurements, segmental PE matrices, cardiac parameters):
     a) You MUST populate each matching table row and column with the patient's dictated measurements and findings (e.g. "BOLD::MPA | 3.4 cm", "BOLD::Apical (RA1) | + | - | - | - | - | - | -").
     b) Preserve unaffected normal table rows verbatim. Prefix modified or abnormal rows with "BOLD::". NEVER omit table rows or leave dictated cells blank.
6. **Non-Verb Impression Synthesis**:
   - Format: "IMPRESSION:###Point 1###Point 2". Non-verb, concise summaries. No extraneous numbers/measurements.
   - If all findings normal: "IMPRESSION:###Normal study.###No significant abnormality detected."
7. Output JSON format: { "findings": string[] }.
${customPrompt ? `\nAdditional Instructions:\n${customPrompt}` : ''}
`;

  const parts: any[] = [];
  if (customImages && customImages.length > 0) {
    for (const customImage of customImages) {
      parts.push({
        inlineData: {
          mimeType: customImage.mimeType,
          data: customImage.data,
        },
      });
    }
    parts.push({
      text: `Use the provided image as a strict visual guide for the layout and structure.`
    });
  }

  parts.push({ text: prompt });

  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName(model),
      contents: parts,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
      },
    });

    const jsonString = response.text;
    if (!jsonString) {
      throw new Error("API returned an empty response.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
      return normalizeClinicalProfileAndTechnique(result.findings);
    } else {
      throw new Error("Invalid data structure in API response. Expected a 'findings' array.");
    }
  } catch (error) {
    console.error("Error in mergeFindingsWithTemplate:", error);
    if (error instanceof Error) {
      throw new Error(`Failed to merge findings into template: ${error.message}`);
    }
    throw new Error("An unknown error occurred while merging findings into template.");
  }
};

export const processTextFindings = async (
  rawText: string,
  model: string,
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  selectedTemplate?: { id: string; name: string; category?: string; modality?: string; lines: string[]; docxBase64?: string; skillPrompt?: string } | null
): Promise<{ findings: string[]; docxBlob?: Blob }> => {
  if (selectedTemplate) {
    if (selectedTemplate.docxBase64) {
      try {
        const astRes = await mergeFindingsWithAst(
          rawText,
          selectedTemplate as any,
          model,
          customPrompt,
          customImages,
          true,
          selectedTemplate.skillPrompt
        );
        if (astRes && astRes.findings && astRes.findings.length > 0) {
          return astRes;
        }
      } catch (e) {
        console.warn('AST text merge error, falling back:', e);
      }
    }
    const findings = await mergeFindingsWithTemplate(rawText, selectedTemplate, model, customPrompt, customImages);
    return { findings };
  }

  const baseBlob = new Blob([rawText], { type: 'text/plain' });
  (baseBlob as any).name = 'pasted_dictation.txt';
  const directFindings = await processAudio(baseBlob, model, customPrompt, customImages, undefined, undefined, selectedTemplate);
  return { findings: directFindings };
};

export const transcribeAudioForPrompt = async (audioBlob: Blob, modelName = 'gemini-2.5-flash'): Promise<string> => {
  const base64Audio = await blobToBase64(audioBlob);

  const prompt = `You are an expert medical transcriptionist specializing in radiology dictation.
Transcribe the following radiology dictation audio with 100% precision.
- Capture all anatomical observations, measurements, organ descriptions, clinical history, technique, and impression verbatim.
- Format numbers, units (cm, mm, HU, %), and medical terms accurately.
- Provide ONLY the transcribed text without conversational filler or markdown code blocks.`;

  const textPart = { text: prompt };
  const audioPart = {
    inlineData: {
      mimeType: getCleanMimeType(audioBlob),
      data: base64Audio,
    },
  };
  
  try {
    const response: GenerateContentResponse = await generateContentWithRetry({
      model: getValidModelName(modelName),
      contents: [textPart, audioPart],
    });

    const resultText = response.text?.trim();
    return resultText || "";
  } catch (error) {
    console.error("Error calling Gemini API for transcription:", error);
    if (error instanceof Error) {
        throw new Error(`Failed to transcribe audio: ${error.message}`);
    }
    throw new Error("An unknown error occurred while communicating with the API for transcription.");
  }
};


export const createChat = async (
  audioBlob: Blob, 
  initialFindings: string[], 
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  model: string = 'gemini-2.5-flash'
): Promise<Chat> => {
  const fileName = (audioBlob as any).name;
  const fileContent = await prepareFileContentPart(audioBlob, fileName);
  const targetModel = getValidModelName(model);
  
  const userMessageParts: any[] = [];

  if (customImages && customImages.length > 0) {
    for (const customImage of customImages) {
        userMessageParts.push({
          inlineData: {
            mimeType: customImage.mimeType,
            data: customImage.data
          }
        });
    }
    userMessageParts.push({ text: `This is the report template${customImages.length > 1 ? 's' : ''} I provided.` });
  }

  if (fileContent.textPart) {
    userMessageParts.push(fileContent.textPart);
  }
  if (fileContent.inlinePart) {
    userMessageParts.push(fileContent.inlinePart);
  }
  userMessageParts.push({ text: `This is the file / clinical context I provided.` });
  

  const modelResponsePart = { text: `This is the transcript you requested:\n\n${initialFindings.join('\n\n')}` };


  let systemInstruction = 'You are a helpful AI assistant for a radiologist. The user has provided an audio dictation and you have transcribed it. Now, answer the user\'s follow-up questions based on the content of the audio and the transcript.';
  if (customPrompt) {
      systemInstruction += `\n\nAdditionally, follow these custom instructions from the user:\n${customPrompt}`;
  }

  const chat = getAiClient().client.chats.create({
    model: targetModel,
    config: {
      systemInstruction: systemInstruction,
    },
    history: [
      { role: 'user', parts: userMessageParts },
      { role: 'model', parts: [modelResponsePart] },
    ],
  });
  return chat;
};

export const createChatFromText = async (
  initialFindings: string[], 
  customPrompt?: string,
  customImages?: Array<{ data: string; mimeType: string }> | null,
  model: string = 'gemini-2.5-flash'
): Promise<Chat> => {
  const targetModel = getValidModelName(model);
  const userMessageParts: any[] = [];
  
  if (customImages && customImages.length > 0) {
    for (const customImage of customImages) {
        userMessageParts.push({
          inlineData: {
            mimeType: customImage.mimeType,
            data: customImage.data
          }
        });
    }
    userMessageParts.push({ text: `This is the report template${customImages.length > 1 ? 's' : ''} I provided.` });
  }

  userMessageParts.push({ text: `This is the transcript I generated.` });

  const modelResponsePart = { text: `This is the transcript you requested:\n\n${initialFindings.join('\n\n')}` };
  
  let systemInstruction = 'You are a helpful AI assistant for a radiologist. The user has provided a transcript from a live dictation. Now, answer the user\'s follow-up questions based on the content of the transcript.';
  if (customPrompt) {
      systemInstruction += `\n\nAdditionally, follow these custom instructions from the user:\n${customPrompt}`;
  }

  const chat = getAiClient().client.chats.create({
    model: targetModel,
    config: {
      systemInstruction: systemInstruction,
    },
    history: [
      { role: 'user', parts: userMessageParts },
      { role: 'model', parts: [modelResponsePart] },
    ],
  });
  return chat;
};

const errorSchema = {
    type: Type.OBJECT,
    properties: {
        errors: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    originalText: { type: Type.STRING, description: "The exact phrase or word from the report that contains the error or ambiguity." },
                    suggestion: { type: Type.STRING, description: "The proposed correction or clarification. For ambiguity, phrase as a question." },
                    type: { type: Type.STRING, enum: ["potential_error", "clarification"], description: "Use 'potential_error' for clear typos/grammar issues. Use 'clarification' for medical ambiguities." },
                    reason: { type: Type.STRING, description: "A brief, one-sentence explanation for why this was flagged." }
                },
                required: ["originalText", "suggestion", "type", "reason"]
            }
        }
    },
    required: ["errors"]
};

export const identifyPotentialErrors = async (findings: string[], model: string): Promise<IdentifiedError[]> => {
    const textPart = {
        text: `${ERROR_IDENTIFIER_PROMPT}\n\nReport to analyze:\n${JSON.stringify({ findings })}`,
    };

    try {
        const response: GenerateContentResponse = await generateContentWithRetry({
            model: getValidModelName(model),
            contents: [textPart],
            config: {
                responseMimeType: "application/json",
                responseSchema: errorSchema
            }
        });

        const jsonString = response.text;
        if (!jsonString) {
            return [];
        }

        const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        const result = JSON.parse(cleanedJsonString);

        if (result && Array.isArray(result.errors)) {
            return result.errors as IdentifiedError[];
        } else {
            console.warn("Invalid data structure in error identification response.");
            return [];
        }
    } catch (error) {
        console.error("Error calling Gemini API for error identification:", error);
        // Don't throw, just return empty array as this is a background task.
        return [];
    }
};

export async function runAgenticAnalysis(content: string, selectedModel: string = 'gemini-2.5-flash'): Promise<{ finalResult: string; agenticSteps: string; enhancementText: string; }> {
    let agenticSteps = "### Agentic Workflow Log\n\n";
    let initialAnalyses: string[] = [];
    let refinedAnalyses: string[] = [];
    const DELAY_MS = 250;
    const targetModel = getValidModelName(selectedModel);

    try {
        // --- PRIMARY PATH: PARALLEL EXECUTION ---
        agenticSteps += "--- ATTEMPTING PARALLEL EXECUTION ---\n\n";
        
        // Step 1: Parallel Initial Analysis
        agenticSteps += "--- STEP 1: Initial Analysis (Fact-Checker Agents) ---\n\n";
        const initialPromises = Array.from({ length: 3 }, () => 
            generateContentWithRetry({
                model: targetModel,
                contents: `${INITIAL_AGENT_PROMPT}\n\n--- CONTENT TO ANALYZE ---\n\n${content}`,
                config: { tools: [{ googleSearch: {} }] }
            })
        );
        const initialResponses = await Promise.all(initialPromises);
        initialAnalyses = initialResponses.map(res => res.text);
        initialAnalyses.forEach((text, i) => {
            agenticSteps += `**Agent 1.${i + 1} Output:**\n\`\`\`\n${text}\n\`\`\`\n\n`;
        });

        // Step 2: Parallel Refinement
        agenticSteps += "--- STEP 2: Refinement (Peer Reviewer Agents) ---\n\n";
        const refinementPromises = initialAnalyses.map(analysis => 
            generateContentWithRetry({
                model: targetModel,
                contents: `${REFINEMENT_AGENT_PROMPT}\n\n--- ORIGINAL CONTENT ---\n\n${content}\n\n--- INITIAL ANALYSIS TO REFINE ---\n\n${analysis}`,
                config: { tools: [{ googleSearch: {} }] }
            })
        );
        const refinedResponses = await Promise.all(refinementPromises);
        refinedAnalyses = refinedResponses.map(res => res.text);
        refinedAnalyses.forEach((text, i) => {
            agenticSteps += `**Agent 2.${i + 1} Output:**\n\`\`\`\n${text}\n\`\`\`\n\n`;
        });

    } catch (err) {
        // --- FALLBACK PATH: SEQUENTIAL EXECUTION ---
        const isRateLimitError = err instanceof Error && (err.message.includes('429') || /rate limit/i.test(err.message));
        
        if (isRateLimitError) {
            agenticSteps += "\n---!! PARALLEL EXECUTION FAILED DUE TO RATE LIMITING !! ---\n";
            agenticSteps += `---!! SWITCHING TO SEQUENTIAL EXECUTION WITH DELAYS !! ---\n\n`;
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            initialAnalyses = [];
            refinedAnalyses = [];

            // Step 1: Sequential Initial Analysis
            agenticSteps += "--- STEP 1: Initial Analysis (Fact-Checker Agents) [SEQUENTIAL] ---\n\n";
            for (let i = 0; i < 3; i++) {
                const response = await generateContentWithRetry({
                    model: targetModel,
                    contents: `${INITIAL_AGENT_PROMPT}\n\n--- CONTENT TO ANALYZE ---\n\n${content}`,
                    config: { tools: [{ googleSearch: {} }] }
                });
                initialAnalyses.push(response.text);
                agenticSteps += `**Agent 1.${i + 1} Output:**\n\`\`\`\n${response.text}\n\`\`\`\n\n`;
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }

            // Step 2: Sequential Refinement
            agenticSteps += "--- STEP 2: Refinement (Peer Reviewer Agents) [SEQUENTIAL] ---\n\n";
            for (let i = 0; i < initialAnalyses.length; i++) {
                const analysis = initialAnalyses[i];
                const response = await generateContentWithRetry({
                    model: targetModel,
                    contents: `${REFINEMENT_AGENT_PROMPT}\n\n--- ORIGINAL CONTENT ---\n\n${content}\n\n--- INITIAL ANALYSIS TO REFINE ---\n\n${analysis}`,
                    config: { tools: [{ googleSearch: {} }] }
                });
                refinedAnalyses.push(response.text);
                agenticSteps += `**Agent 2.${i + 1} Output:**\n\`\`\`\n${response.text}\n\`\`\`\n\n`;
                await new Promise(resolve => setTimeout(resolve, DELAY_MS));
            }
        } else {
            console.error("Agentic analysis failed:", err);
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during agentic analysis.";
            agenticSteps += `\n---!! WORKFLOW FAILED !! ---\n${errorMessage}`;
            return {
                finalResult: `${content}\n\n**Error:** The agentic analysis failed. Please try again.`,
                agenticSteps,
                enhancementText: `**Error:** The agentic analysis failed. ${errorMessage}`
            };
        }
    }

    try {
        // Step 3: Final Synthesis
        agenticSteps += "--- STEP 3: Final Synthesis (Master Editor Agent) ---\n\n";
        const synthesizerResponse = await generateContentWithRetry({
            model: targetModel,
            contents: `${SYNTHESIZER_AGENT_PROMPT}\n\n--- ORIGINAL CONTENT ---\n\n${content}\n\n--- REFINED ANALYSES ---\n\n${refinedAnalyses.join('\n\n---\n\n')}`,
            config: {
                tools: [{ googleSearch: {} }]
            }
        });
        const enhancementText = synthesizerResponse.text;
        agenticSteps += `**Agent 3.1 (Synthesizer) Output:**\n\`\`\`\n${enhancementText}\n\`\`\`\n\n`;

        let finalResult = '';
        if (enhancementText.toLowerCase().includes("no significant errors or omissions found")) {
            finalResult = content;
        } else {
            let sourcesText = '';
            const groundingChunks = synthesizerResponse.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks && groundingChunks.length > 0) {
                const urls = new Set<string>();
                groundingChunks.forEach(chunk => {
                    if (chunk.web?.uri) {
                        urls.add(chunk.web.uri);
                    }
                });
                if (urls.size > 0) {
                    sourcesText = `\n\n## Sources\n${Array.from(urls).map(url => `- ${url}`).join('\n')}`;
                }
            }
            finalResult = `${content}\n\n${enhancementText}${sourcesText}`;
        }

        return { finalResult, agenticSteps, enhancementText };
    } catch (err) {
        console.error("Agentic analysis failed (post-parallel/sequential):", err);
        const errorMessage = err instanceof Error ? err.message : "An unknown error occurred during the final synthesis step.";
        agenticSteps += `\n---!! WORKFLOW FAILED !! ---\n${errorMessage}`;
        return {
            finalResult: `${content}\n\n**Error:** The agentic analysis failed. Please try again.`,
            agenticSteps,
            enhancementText: `**Error:** The agentic analysis failed. ${errorMessage}`
        };
    }
}

export async function runComplexImpressionGeneration(currentFindings: string[], additionalFindings: string, selectedModel: string = 'gemini-2.5-flash'): Promise<{ findings: string[]; expertNotes: string; }> {
    const content = currentFindings.join('\n\n') + (additionalFindings ? `\n\n${additionalFindings}` : '');
    const targetModel = getValidModelName(selectedModel);

    const { finalResult: expertNotesContent } = await runAgenticAnalysis(content, targetModel);

    const findingsWithoutImpression = currentFindings.filter(f => !f.toUpperCase().startsWith('IMPRESSION:'));

    const impressionPrompt = `You are an expert radiologist AI. You are given a set of findings from a dictation and some expert notes from an analysis agent. Your task is to generate a concise, clinically relevant impression based on ALL available information.

**STRICT INSTRUCTIONS:**
1.  **DO NOT MODIFY THE ORIGINAL FINDINGS.** Preserve them exactly as they are provided below.
2.  Use the "Expert Notes" as a knowledge base to deeply understand the context, potential inaccuracies, and missing information. Use this deeper understanding to create a highly accurate and comprehensive impression based on the original findings.
3.  Synthesize a new impression based on the findings. If an impression already exists in the original findings, you MUST REPLACE it with your new one.
4.  Formulate the impression based on these strict criteria:
    - The impression must be concise and formulated without using verbs. For instance, instead of "There are patches of contusion", write "Patches of contusion".
    - Combine multiple related findings, including all their key descriptors into single, coherent impression points to ensure the summary is both concise and complete.
    - List unrelated findings as separate points. For example, hepatomegaly and splenomegaly should be separate points if not related to a primary diagnosis.
    - The impression must NOT contain any numerical values or measurements.
    -  If clinically relevant, you may add concluding phrases like "likely infective etiology" or "likely inflammatory etiology" or "likely neoplastic etiology” or “likely reactive” or “suggested clinical correlation/ review as indicated” or similar phrases. Avoid vague, non-committal conclusions when a more specific diagnosis is possible.
5.  The entire impression MUST be formatted as a single string in the "findings" array. It must start with "IMPRESSION:" (all caps), followed by '###', then each point separated by '###'.
6.  Your final output must be a JSON object with a single key "findings", containing the complete, updated list of findings (original findings + your new impression) as an array of strings.

**ORIGINAL FINDINGS (DO NOT CHANGE):**
${JSON.stringify(findingsWithoutImpression)}

**EXPERT NOTES (USE FOR CONTEXT):**
${expertNotesContent}

Now, generate the complete report including the new impression in the specified JSON format.`;

    const response = await generateContentWithRetry({
        model: targetModel,
        contents: impressionPrompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema,
        }
    });

    const jsonString = response.text;
    if (!jsonString) {
        throw new Error("Complex impression generation returned an empty response.");
    }

    const cleanedJsonString = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleanedJsonString);

    if (result && Array.isArray(result.findings)) {
        return { findings: result.findings, expertNotes: enhancementText };
    } else {
        throw new Error("Invalid data structure in complex impression response.");
    }
}
