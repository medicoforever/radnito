import React, { useState, useEffect } from 'react';
import { AppStatus } from './types';
import { BatchProcessor } from './components/BatchProcessor';
import SunIcon from './components/icons/SunIcon';
import MoonIcon from './components/icons/MoonIcon';
import ApiKeyModal from './components/ApiKeyModal';
import ApiKeyGuideTab from './components/ApiKeyGuideTab';
import OnboardingOverlay, { wasOnboardingDismissed, setOnboardingDismissed } from './components/OnboardingOverlay';
import { hasApiKey } from './services/apiKeyStore';
import { generateRadnitoPDF } from './services/pdfGenerator';

const ERROR_CHECK_ENABLED_KEY = 'radiologyErrorCheckEnabled';

const App: React.FC = () => {
  const [keySaved, setKeySaved] = useState<boolean>(() => hasApiKey());
  // Auto-redirect to guide tab if no API key is set
  const [mode, setMode] = useState<'batch' | 'guide'>(() => hasApiKey() ? 'batch' : 'guide');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => !hasApiKey() && !wasOnboardingDismissed());
  // Show a blocking overlay when user tries to go to batch mode without API key
  const [showKeyRequiredAlert, setShowKeyRequiredAlert] = useState<boolean>(false);

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

  const handleBatchTabClick = () => {
    if (!hasApiKey()) {
      setShowKeyRequiredAlert(true);
      return;
    }
    setMode('batch');
  };

  const handleOnboardingComplete = () => {
    setKeySaved(true);
    setShowOnboarding(false);
    setMode('batch');
  };

  const handleOnboardingSkip = () => {
    setShowOnboarding(false);
    setMode('guide');
  };

  const getPageDescription = () => {
    if (mode === 'guide') return 'Step-by-step tutorial to get free Gemini API Keys and load-balance quotas.';
    return 'Transcribe and process multiple radiology audio dictations concurrently in bulk.';
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-slate-900 flex flex-col items-center justify-center p-4 font-sans transition-colors duration-300">
      {/* Onboarding overlay for first-time users */}
      {showOnboarding && (
        <OnboardingOverlay
          onComplete={handleOnboardingComplete}
          onSkipToGuide={handleOnboardingSkip}
        />
      )}

      {/* Key Required Alert Modal */}
      {showKeyRequiredAlert && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 text-center space-y-4">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/50 text-3xl mx-auto">
              🔑
            </div>
            <h3 className="text-xl font-extrabold text-slate-800 dark:text-white">
              API Key Required First!
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              Before you can start dictating, you need to set up a <strong>free Gemini API key</strong>. 
              It only takes 1 minute and no payment is required!
            </p>
            <div className="bg-blue-50 dark:bg-slate-900/80 p-3 rounded-xl border border-blue-200 dark:border-blue-800 text-xs text-left text-slate-600 dark:text-slate-400">
              <p className="font-bold text-blue-700 dark:text-blue-300 mb-1">💡 What is an API key?</p>
              <p>It's a free password from Google that lets RADNITO use AI to process your audio dictations. Your key stays private in your browser only.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <button
                onClick={() => { setShowKeyRequiredAlert(false); setMode('guide'); }}
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-6 py-2.5 rounded-xl text-sm shadow-lg transition-all"
              >
                🔑 Get Free API Key (1 min)
              </button>
              <button
                onClick={() => setShowKeyRequiredAlert(false)}
                className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-semibold px-4 py-2.5 rounded-xl text-sm transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="w-full max-w-4xl mx-auto">
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
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3.5 py-1.5 rounded-xl shadow text-xs flex items-center space-x-1 transition-all"
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
          <p className="text-slate-600 dark:text-slate-400 mt-2 text-sm sm:text-base font-medium">
            {getPageDescription()}
          </p>

          {/* Navigation Tabs */}
          <div className="flex flex-wrap justify-center gap-2 mt-4 p-1.5 bg-slate-200/60 dark:bg-slate-800 rounded-xl">
            <button
              onClick={handleBatchTabClick}
              className={`px-5 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all relative ${
                mode === 'batch'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              📂 Batch Dictation Workspace
              {!keySaved && mode !== 'batch' && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-amber-500 rounded-full text-white text-[8px] flex items-center justify-center font-bold" title="API Key required">🔒</span>
              )}
            </button>
            <button
              onClick={() => setMode('guide')}
              className={`px-5 py-2 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                mode === 'guide'
                  ? 'bg-blue-600 text-white shadow-md'
                  : !keySaved
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-700 animate-pulse hover:bg-amber-200'
                    : 'bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 hover:bg-blue-100'
              }`}
            >
              {!keySaved ? '🔑 Setup API Key (Start Here!)' : '🔑 Free API Key Guide'}
            </button>
          </div>

          {!keySaved && mode === 'guide' && (
            <div className="mt-3 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/50 dark:to-orange-950/50 border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs p-4 rounded-xl flex items-start space-x-3">
              <span className="text-2xl flex-shrink-0 mt-0.5">👇</span>
              <div className="space-y-1">
                <p className="font-bold text-sm">Follow the guide below to get your free API key</p>
                <p className="text-amber-700 dark:text-amber-400">Once you paste and save your key, the Dictation Workspace will unlock automatically!</p>
              </div>
            </div>
          )}

          {!keySaved && mode !== 'guide' && (
            <div className="mt-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs p-3 rounded-xl flex items-center justify-between">
              <span>⚠️ No Gemini API Key configured. Please add your free key to begin dictating.</span>
              <button
                onClick={() => setMode('guide')}
                className="ml-2 bg-amber-600 hover:bg-amber-700 text-white font-bold px-3 py-1 rounded-lg text-xs shadow"
              >
                Get Key Guide
              </button>
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-center items-center gap-x-6 gap-y-2">
            {mode === 'batch' && (
              <div className="flex items-center gap-2">
                <label htmlFor="model-select" className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
                  AI Model:
                </label>
                <select 
                  id="model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="bg-white border border-slate-300 text-slate-900 text-xs sm:text-sm font-medium rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 dark:bg-slate-700 dark:border-slate-600 dark:placeholder-slate-400 dark:text-white shadow-sm"
                >
                  <option value="gemini-3.6-flash">Gemini 3.6 Flash (Recommended)</option>
                  <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                  <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                  <option value="gemini-3.5-flash-lite">Gemini 3.5 Flash Lite</option>
                </select>
              </div>
            )}
            <div className="flex items-center gap-2">
              <label htmlFor="error-check-toggle" className="text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-300">
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

        <main className="bg-white dark:bg-slate-800 rounded-2xl shadow-xl p-4 sm:p-8 min-h-[350px]">
          {mode === 'batch' ? (
            <BatchProcessor 
              selectedModel={selectedModel} 
              isErrorCheckEnabled={isErrorCheckEnabled}
              onBack={() => setMode('guide')} 
            />
          ) : (
            <ApiKeyGuideTab onKeySaved={() => { setKeySaved(true); setMode('batch'); }} />
          )}
        </main>

        <footer className="text-center mt-8 text-xs text-slate-500 dark:text-slate-500 space-y-1">
          <p className="font-bold text-slate-700 dark:text-slate-300">RADNITO • Batch Radiology Dictation</p>
          <p>Powered by Gemini AI • 24/7 Free Uptime</p>
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
