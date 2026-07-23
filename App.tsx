


import React, { useState, useCallback, useEffect } from 'react';
import AudioRecorder from './components/AudioRecorder';
import ResultsDisplay from './components/ResultsDisplay';
import { AppStatus, IdentifiedError } from './types';
import { processAudio, createChat, blobToBase64, base64ToBlob, createChatFromText, identifyPotentialErrors } from './services/geminiService';
import Spinner from './components/ui/Spinner';
import { Chat } from '@google/genai';
import { saveAudioBlob, getAudioBlob, deleteAudioBlob } from './services/audioStorage';
// FIX: Changed import to a named import based on the error message.
import { BatchProcessor } from './components/BatchProcessor';
import LiveDictation from './components/LiveDictation';
import WaveformIcon from './components/icons/WaveformIcon';
import SunIcon from './components/icons/SunIcon';
import MoonIcon from './components/icons/MoonIcon';
import CustomPromptInput from './components/ui/CustomPromptInput';
import ApiKeyModal from './components/ApiKeyModal';
import ApiKeyGuideTab from './components/ApiKeyGuideTab';
import { hasApiKey } from './services/apiKeyStore';
import { generateRadnitoPDF } from './services/pdfGenerator';

interface ChatMessage {
  author: 'You' | 'AI';
  text: string;
}

const SINGLE_MODE_STORAGE_KEY = 'radiologyDictationSingleMode';
const ERROR_CHECK_ENABLED_KEY = 'radiologyErrorCheckEnabled';

const getCleanMimeType = (blob: Blob): string => {
    let mimeType = blob.type;
    if (!mimeType) {
        return 'audio/ogg';
    }
    if (mimeType.startsWith('audio/webm') || mimeType.startsWith('video/webm')) {
        return 'audio/webm';
    }
    return mimeType.split(';')[0];
};

const App: React.FC = () => {
  const [mode, setMode] = useState<'single' | 'batch' | 'live' | 'guide'>('single');
  const [status, setStatus] = useState<AppStatus>(AppStatus.Idle);
  const [findings, setFindings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [chat, setChat] = useState<Chat | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatting, setIsChatting] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [customImages, setCustomImages] = useState<Array<{ data: string; mimeType: string }>>([]);
  const [identifiedErrors, setIdentifiedErrors] = useState<IdentifiedError[]>([]);
  const [errorCheckStatus, setErrorCheckStatus] = useState<'idle' | 'checking' | 'complete'>('idle');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [keySaved, setKeySaved] = useState<boolean>(() => hasApiKey());

  const [theme, setTheme] = useState(() => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
      return storedTheme;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [isErrorCheckEnabled, setIsErrorCheckEnabled] = useState(() => {
    const saved = localStorage.getItem(ERROR_CHECK_ENABLED_KEY);
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [theme]);
  
  useEffect(() => {
    localStorage.setItem(ERROR_CHECK_ENABLED_KEY, JSON.stringify(isErrorCheckEnabled));
  }, [isErrorCheckEnabled]);

  const toggleTheme = () => {
    setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
  };

  const [isRestored, setIsRestored] = useState(false);

  useEffect(() => {
    const loadState = async () => {
      try {
        const savedStateJSON = localStorage.getItem(SINGLE_MODE_STORAGE_KEY);
        if (savedStateJSON) {
          const savedState = JSON.parse(savedStateJSON);
          if (savedState.findings && savedState.findings.length > 0) {
            let blob: Blob | null = await getAudioBlob('single_mode_audio');
            if (blob && (!(blob instanceof Blob) || blob.size === 0)) {
              blob = null;
            }
            
            setFindings(savedState.findings);
            setAudioBlob(blob);
            setSelectedModel(savedState.selectedModel || 'gemini-3.6-flash');
            setCustomPrompt(savedState.customPrompt || '');
            setCustomImages(savedState.customImages || []);
            setIdentifiedErrors(savedState.identifiedErrors || []);
            setErrorCheckStatus(savedState.errorCheckStatus || 'idle');
            
            if (savedState.chatHistory && savedState.chatHistory.length > 0) {
              setChatHistory(savedState.chatHistory);
              if (blob) {
                const base64 = await blobToBase64(blob);
                const cleanMime = getCleanMimeType(blob);
                const newChat = await createChat(base64, cleanMime, savedState.selectedModel, savedState.customPrompt);
                setChat(newChat);
              } else {
                const fullTextReport = savedState.findings.join('\n');
                const newChat = await createChatFromText(fullTextReport, savedState.selectedModel, savedState.customPrompt);
                setChat(newChat);
              }
            }
            setStatus(AppStatus.Success);
          }
        }
      } catch (e) {
        console.error("Failed to load state from localStorage/IndexedDB", e);
      } finally {
        setIsRestored(true);
      }
    };
    loadState();
  }, []);

  useEffect(() => {
    if (!isRestored) return;

    const saveState = async () => {
      if (status === AppStatus.Success && findings.length > 0) {
        const stateToSave = {
          findings,
          selectedModel,
          customPrompt,
          customImages,
          identifiedErrors,
          errorCheckStatus,
          chatHistory
        };
        localStorage.setItem(SINGLE_MODE_STORAGE_KEY, JSON.stringify(stateToSave));
        if (audioBlob) {
          await saveAudioBlob('single_mode_audio', audioBlob);
        }
      } else {
        localStorage.removeItem(SINGLE_MODE_STORAGE_KEY);
        await deleteAudioBlob('single_mode_audio');
      }
    };

    saveState();
  }, [status, findings, audioBlob, selectedModel, customPrompt, customImages, identifiedErrors, errorCheckStatus, chatHistory, isRestored]);

  const handleRecordingComplete = useCallback(async (blob: Blob) => {
    setAudioBlob(blob);
    setStatus(AppStatus.Processing);
    setError(null);
    setChat(null);
    setChatHistory([]);
    setIdentifiedErrors([]);
    setErrorCheckStatus('idle');

    try {
      const resultFindings = await processAudio(blob, selectedModel, customPrompt, customImages);
      setFindings(resultFindings);
      setStatus(AppStatus.Success);

      const base64 = await blobToBase64(blob);
      const cleanMime = getCleanMimeType(blob);
      const newChat = await createChat(base64, cleanMime, selectedModel, customPrompt);
      setChat(newChat);

      if (isErrorCheckEnabled && resultFindings.length > 0) {
        setErrorCheckStatus('checking');
        identifyPotentialErrors(resultFindings)
          .then(errors => {
            setIdentifiedErrors(errors);
            setErrorCheckStatus('complete');
          })
          .catch(err => {
            console.error("Failed to identify errors:", err);
            setErrorCheckStatus('idle');
          });
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during transcription.');
      setStatus(AppStatus.Error);
    }
  }, [selectedModel, customPrompt, customImages, isErrorCheckEnabled]);

  const handleLiveDictationComplete = useCallback(async (liveFindings: string[]) => {
    if (liveFindings.length === 0) {
      setMode('single');
      return;
    }
    setAudioBlob(null);
    setFindings(liveFindings);
    setStatus(AppStatus.Success);
    setMode('single');
    setError(null);
    setChat(null);
    setChatHistory([]);
    setIdentifiedErrors([]);
    setErrorCheckStatus('idle');

    try {
      const fullTextReport = liveFindings.join('\n');
      const newChat = await createChatFromText(fullTextReport, selectedModel, customPrompt);
      setChat(newChat);
    } catch (err) {
      console.warn("Failed to initialize chat for live dictation session:", err);
    }
  }, [selectedModel, customPrompt]);

  const resetSingleMode = () => {
    setStatus(AppStatus.Idle);
    setFindings([]);
    setError(null);
    setAudioBlob(null);
    setChat(null);
    setChatHistory([]);
    setCustomPrompt('');
    setCustomImages([]);
    setIdentifiedErrors([]);
    setErrorCheckStatus('idle');
    localStorage.removeItem(SINGLE_MODE_STORAGE_KEY);
    deleteAudioBlob('single_mode_audio');
  };

  const renderSingleModeContent = () => {
    switch (status) {
      case AppStatus.Idle:
      case AppStatus.Recording:
        return (
          <AudioRecorder
            status={status}
            setStatus={setStatus}
            onRecordingComplete={handleRecordingComplete}
          />
        );
      case AppStatus.Processing:
        return (
          <div className="flex flex-col items-center justify-center p-8 space-y-4">
            <Spinner />
            <p className="text-slate-600 dark:text-slate-300 font-medium">Processing dictation with RADNITO AI...</p>
          </div>
        );
      case AppStatus.Error:
        return (
          <div className="flex flex-col items-center justify-center p-8 space-y-4 text-center">
            <div className="text-rose-500 text-4xl">⚠️</div>
            <p className="text-rose-600 dark:text-rose-400 font-semibold">{error}</p>
            <p className="text-xs text-slate-500 max-w-md">
              💡 Tip: If a model hits a quota limit, try switching to a lower model like Gemini 3.5 Flash Lite or adding another API key.
            </p>
            <button
              onClick={resetSingleMode}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded-lg transition-colors text-sm"
            >
              Try Again
            </button>
          </div>
        );
      case AppStatus.Success:
        return (
          <div className="space-y-6">
            <ResultsDisplay
              findings={findings}
              audioBlob={audioBlob}
              chat={chat}
              chatHistory={chatHistory}
              setChatHistory={setChatHistory}
              isChatting={isChatting}
              setIsChatting={setIsChatting}
              onFindingsChange={setFindings}
              selectedModel={selectedModel}
              onModelChange={setSelectedModel}
              customPrompt={customPrompt}
              identifiedErrors={identifiedErrors}
              errorCheckStatus={errorCheckStatus}
              isErrorCheckEnabled={isErrorCheckEnabled}
            />
            <div className="flex justify-center gap-4 flex-wrap">
              {audioBlob && (
                <button
                  onClick={() => {
                    const url = URL.createObjectURL(audioBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `RADNITO_Dictation_${Date.now()}.webm`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2 px-5 rounded-lg transition-colors text-sm flex items-center space-x-1"
                >
                  <span>⬇️ Download Audio Recording</span>
                </button>
              )}
              <button
                onClick={resetSingleMode}
                className="bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200 font-bold py-2 px-6 rounded-lg hover:bg-slate-300 dark:hover:bg-slate-600 transition-colors text-sm"
              >
                Start New Recording
              </button>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (mode) {
      case 'single':
        return renderSingleModeContent();
      case 'batch':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-800 dark:text-blue-300 flex items-center justify-between">
              <span>📂 <strong>Batch Mode:</strong> Upload and transcribe multiple audio files concurrently in bulk to save time.</span>
            </div>
            <BatchProcessor 
              selectedModel={selectedModel} 
              isErrorCheckEnabled={isErrorCheckEnabled}
              onBack={() => {
                resetSingleMode();
                setMode('single');
              }} 
            />
          </div>
        );
      case 'live':
        return (
          <div className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300">
              ⚡ <strong>Experimental Feature Notice:</strong> Live Dictation is currently experimental. For long or critical radiology reports, Single Mode with recording is recommended.
            </div>
            <LiveDictation onComplete={handleLiveDictationComplete} onBack={() => setMode('single')} />
          </div>
        );
      case 'guide':
        return <ApiKeyGuideTab onKeySaved={() => { setKeySaved(true); setMode('single'); }} />;
      default:
        return renderSingleModeContent();
    }
  };

  const getPageDescription = () => {
    if (mode === 'batch') return 'Manage and transcribe multiple radiology dictations concurrently in bulk.';
    if (mode === 'live') return 'Real-time dictation preview (Experimental mode).';
    if (mode === 'guide') return 'Step-by-step tutorial to get free Gemini API Keys and load-balance quotas.';
    return 'Record or upload your findings, and let RADNITO AI produce clean, structured report findings.';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4 font-sans transition-colors duration-300">
      <div className="w-full max-w-3xl mx-auto">
        <header className="text-center mb-6 relative">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => setIsApiKeyModalOpen(true)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all shadow-sm flex items-center space-x-1.5 ${
                keySaved
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 hover:bg-emerald-200'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-300 dark:border-rose-800 hover:bg-rose-200 animate-pulse'
              }`}
            >
              <span>{keySaved ? '🟢 Gemini API Key Active' : '🔴 Set Gemini API Key'}</span>
            </button>

            <div className="flex items-center space-x-2">
              <button
                onClick={generateRadnitoPDF}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-xl shadow text-xs flex items-center space-x-1 transition-all"
                title="Download complete RADNITO PDF guide"
              >
                <span>📄 PDF Guide</span>
              </button>

              <button
                onClick={toggleTheme}
                className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                aria-label="Toggle theme"
              >
                {theme === 'light' ? <MoonIcon className="w-5 h-5" /> : <SunIcon className="w-5 h-5" />}
              </button>
            </div>
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-blue-700 dark:text-blue-400 drop-shadow-sm">
            RADNITO
          </h1>
          <p className="text-slate-600 dark:text-slate-400 mt-2 text-sm">
            {getPageDescription()}
          </p>

          {/* Navigation Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mt-4 p-1 bg-slate-200/60 dark:bg-slate-800 rounded-xl">
            <button
              onClick={() => setMode('single')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                mode === 'single'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              🎙️ Single Mode
            </button>
            <button
              onClick={() => setMode('batch')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                mode === 'batch'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              📂 Batch Mode
            </button>
            <button
              onClick={() => setMode('live')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                mode === 'live'
                  ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              ⚡ Live Mode (Experimental)
            </button>
            <button
              onClick={() => setMode('guide')}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold rounded-lg transition-all ${
                mode === 'guide'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 hover:bg-blue-100'
              }`}
            >
              🔑 Free API Key Guide
            </button>
          </div>

          {!keySaved && mode !== 'guide' && (
            <div className="mt-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs p-3 rounded-xl flex items-center justify-between">
              <span>⚠️ No Gemini API Key configured. Please add your key to dictate.</span>
              <button
                onClick={() => setMode('guide')}
                className="ml-2 bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded-lg text-xs"
              >
                Get Key Guide
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-center items-center gap-x-6 gap-y-2">
            {status === AppStatus.Idle && (mode === 'single' || mode === 'batch') && (
              <div className="flex flex-col items-center">
                <div className="flex items-center gap-2">
                  <label htmlFor="model-select" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    AI Model:
                  </label>
                  <select 
                    id="model-select"
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="bg-white border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 dark:bg-slate-700 dark:border-slate-600 dark:placeholder-slate-400 dark:text-white"
                  >
                    <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                  </select>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  💡 Tip: If a model shows error or quota limit, switch to a lower model (e.g. Gemini 3.5 Flash Lite or Gemini 2.5 Flash).
                </p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="error-check-toggle" className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Automatic Error Finding
              </label>
              <button
                onClick={() => setIsErrorCheckEnabled(!isErrorCheckEnabled)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                  isErrorCheckEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-600'
                }`}
                role="switch"
                aria-checked={isErrorCheckEnabled}
                id="error-check-toggle"
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isErrorCheckEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          </div>
        </header>

        <main className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-4 sm:p-8 min-h-[300px]">
          {renderContent()}
        </main>

        <footer className="text-center mt-8 text-sm text-slate-500 dark:text-slate-500 space-y-1">
          <p className="font-bold text-slate-700 dark:text-slate-300">RADNITO • High Speed Radiology Dictation</p>
          <p className="text-xs">Powered by Gemini AI • 24/7 Free Uptime</p>
        </footer>

        <ApiKeyModal
          isOpen={isApiKeyModalOpen}
          onClose={() => setIsApiKeyModalOpen(false)}
          onKeyChange={() => setKeySaved(hasApiKey())}
        />
      </div>
    </div>
  );
};

export default App;
