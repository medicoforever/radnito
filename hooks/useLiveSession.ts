import { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import { GEMINI_FLASH_LITE_MODEL, LIVE_DICTATION_FLASH_LITE_PROMPT } from '../constants';
import { getStoredApiKey } from '../services/apiKeyStore';

export function processLiveTranscript(rawTextOrFindings: string | string[]): string[] {
  let inputLines: string[] = [];
  if (Array.isArray(rawTextOrFindings)) {
    inputLines = rawTextOrFindings;
  } else if (typeof rawTextOrFindings === 'string') {
    inputLines = [rawTextOrFindings];
  }

  const resultLines: string[] = [];

  for (const rawText of inputLines) {
    if (!rawText) continue;

    let text = rawText;

    // Natural Language Voice Commands handling
    text = text
      .replace(/\b(move to the next line|move to next line|go to the next line|go to next line|next line|new line|line break|new paragraph|next paragraph)\b/gi, '\n')
      .replace(/\b(full stop|period)\b/gi, '. ')
      .replace(/\b(comma)\b/gi, ', ')
      .replace(/\b(colon)\b/gi, ': ')
      .replace(/\b(semi-colon|semicolon)\b/gi, '; ')
      .replace(/\b(question mark)\b/gi, '? ')
      .replace(/\b(new finding|next finding|separate finding)\b/gi, '\nBOLD::')
      .replace(/\b(mark as bold|make this bold)\b/gi, ' BOLD::')
      .replace(/\b(impression section|start impression|new impression)\b/gi, '\nIMPRESSION:###');

    // Split into sub-lines
    const splitSubLines = text.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of splitSubLines) {
      // Smart finding boundary split on period followed by typical radiology starters
      const findingBoundaryRegex = /(\.|\?|!)\s+(?=(In the\b|On the\b|There is\b|There are\b|No evidence of\b|Note is made of\b|No significant\b|Serial axial\b|The [a-z]+|Visualized [a-z]+|Impression:|Clinical Profile:|Finding \d|Point \d|First finding|Second finding|Third finding|Next finding|Also\b|Lungs\b|Heart\b|Brain\b|Liver\b|Spleen\b|Kidneys\b|Pancreas\b|Bones\b|Spine\b|Ventricles\b|C\.P\. Angles\b|Basal cisterns\b|Sella\b|Midline\b))/gi;

      const subSegments = line.replace(findingBoundaryRegex, '$1\n').split('\n').map(s => s.trim()).filter(Boolean);

      for (const segment of subSegments) {
        if (!segment) continue;

        let formatted = segment;
        if (formatted.startsWith('BOLD::')) {
          const rest = formatted.slice(6).trim();
          formatted = `BOLD::${rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : ''}`;
        } else if (formatted.startsWith('*')) {
          const rest = formatted.slice(1).trim();
          formatted = `*${rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : ''}`;
        } else if (formatted.toUpperCase().startsWith('IMPRESSION:')) {
          formatted = formatted.toUpperCase();
        } else {
          formatted = `BOLD::${formatted.charAt(0).toUpperCase() + formatted.slice(1)}`;
        }
        resultLines.push(formatted);
      }
    }
  }

  return resultLines;
}

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    findings: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: "Array of transcribed medical finding lines."
    }
  }
};

export const useLiveSession = () => {
  const [status, setStatus] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const mimeTypeRef = useRef<string>('audio/webm');
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const activePromptRef = useRef<string>('');
  const onTranscriptUpdateRef = useRef<((lines: string[]) => void) | null>(null);
  const isProcessingRef = useRef<boolean>(false);

  const isPausedRef = useRef(isPaused);
  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  const stopAudio = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
      recognitionRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop(); } catch (e) {}
      mediaRecorderRef.current = null;
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  }, []);

  const processAudioWithGemini = useCallback(async (currentAudioBlob: Blob, customPrompt?: string) => {
    if (isProcessingRef.current || currentAudioBlob.size < 500) return;
    isProcessingRef.current = true;

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          resolve(res.split(',')[1] || '');
        };
        reader.onerror = reject;
        reader.readAsDataURL(currentAudioBlob);
      });

      const base64Audio = await base64Promise;
      if (!base64Audio) return;

      const apiKey = getStoredApiKey();
      if (!apiKey) {
        setError("Gemini API Key is missing. Please click 'Set API Key' in the top bar to add your key.");
        return;
      }
      const ai = new GoogleGenAI({ apiKey: apiKey });

      let systemPrompt = LIVE_DICTATION_FLASH_LITE_PROMPT;
      if (customPrompt) {
        systemPrompt += `\n\nCustom Instructions:\n${customPrompt}`;
      }

      const response = await ai.models.generateContent({
        model: GEMINI_FLASH_LITE_MODEL,
        contents: {
          parts: [
            { text: systemPrompt },
            {
              inlineData: {
                mimeType: currentAudioBlob.type || 'audio/webm',
                data: base64Audio,
              }
            }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: responseSchema,
        }
      });

      const jsonString = response.text;
      if (jsonString) {
        const cleaned = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed && Array.isArray(parsed.findings)) {
          const formatted = processLiveTranscript(parsed.findings);
          if (onTranscriptUpdateRef.current && formatted.length > 0) {
            onTranscriptUpdateRef.current(formatted);
          }
        }
      }
    } catch (err) {
      console.warn("Live dictation processing chunk error:", err);
    } finally {
      isProcessingRef.current = false;
    }
  }, []);

  const startSession = useCallback(async (
    onTranscriptUpdate: (lines: string[]) => void,
    customPrompt?: string
  ) => {
    stopAudio();
    setError(null);
    setStatus('Connecting live session with Gemini 3.5 Flash-Lite...');
    audioChunksRef.current = [];
    activePromptRef.current = customPrompt || '';
    onTranscriptUpdateRef.current = onTranscriptUpdate;
    onTranscriptUpdate([]);
    setIsPaused(false);

    try {
      if (streamRef.current) {
        try { streamRef.current.getTracks().forEach(t => t.stop()); } catch (e) {}
        streamRef.current = null;
      }

      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        });
      } catch (firstErr) {
        console.warn("Live dictation getUserMedia attempt 1 failed, retrying basic constraint:", firstErr);
        await new Promise(r => setTimeout(r, 150));
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }

      streamRef.current = stream;

      const supportedTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg', 'audio/mp4'];
      const supportedMime = supportedTypes.find(type => MediaRecorder.isTypeSupported(type)) || 'audio/webm';
      mimeTypeRef.current = supportedMime;

      const mediaRecorder = new MediaRecorder(stream, { mimeType: supportedMime });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(500);
      setIsSessionActive(true);
      setStatus('⚡ Live (Gemini 3.5 Flash-Lite). Listening...');

      // Setup periodic Gemini 3.5 Flash-Lite AI processing every 1.5s
      timerRef.current = setInterval(() => {
        if (!isPausedRef.current && audioChunksRef.current.length > 0) {
          const currentBlob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
          processAudioWithGemini(currentBlob, activePromptRef.current);
        }
      }, 1500);

      // Web Speech API fallback for instant character-by-character preview
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: any) => {
          if (isPausedRef.current) return;
          let speechText = '';
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            speechText += event.results[i][0].transcript;
          }
          if (speechText.trim() && !isProcessingRef.current) {
            const formattedInterim = processLiveTranscript(speechText);
            if (onTranscriptUpdateRef.current && formattedInterim.length > 0) {
              onTranscriptUpdateRef.current(formattedInterim);
            }
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("Speech recognition warning:", event.error);
        };

        recognition.onend = () => {
          if (streamRef.current && !isPausedRef.current) {
            try { recognition.start(); } catch (e) {}
          }
        };

        try { recognition.start(); } catch (e) {}
        recognitionRef.current = recognition;
      }

    } catch (err) {
      console.error("Failed to start live session:", err);
      const msg = err instanceof Error ? err.message : 'Microphone access denied or not supported.';
      setError(`Error starting live dictation: ${msg}`);
      setStatus('Session failed.');
      stopAudio();
      setIsSessionActive(false);
    }
  }, [stopAudio, processAudioWithGemini]);

  const pauseSession = useCallback(() => {
    setIsPaused(true);
    setStatus('Live session paused.');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.pause(); } catch (e) {}
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch (e) {}
    }
  }, []);

  const resumeSession = useCallback(() => {
    setIsPaused(false);
    setStatus('⚡ Live (Gemini 3.5 Flash-Lite). Listening...');
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'paused') {
      try { mediaRecorderRef.current.resume(); } catch (e) {}
    }
    if (recognitionRef.current) {
      try { recognitionRef.current.start(); } catch (e) {}
    }
  }, []);

  const stopSession = useCallback(() => {
    setStatus('Finalizing live transcription...');
    setIsSessionActive(false);
    setIsPaused(false);

    let finalAudioBlob: Blob | null = null;
    if (audioChunksRef.current.length > 0) {
      finalAudioBlob = new Blob(audioChunksRef.current, { type: mimeTypeRef.current });
    }

    stopAudio();

    return {
      transcript: '',
      audioBlob: finalAudioBlob,
    };
  }, [stopAudio]);

  useEffect(() => {
    return () => {
      stopAudio();
    };
  }, [stopAudio]);

  return {
    status,
    error,
    isSessionActive,
    isPaused,
    activeModel: GEMINI_FLASH_LITE_MODEL,
    startSession,
    stopSession,
    pauseSession,
    resumeSession,
  };
};
