import React, { useState } from 'react';
import { addApiKey, validateApiKey } from '../services/apiKeyStore';

interface OnboardingOverlayProps {
  onComplete: () => void;
  onSkipToGuide: () => void;
}

const ONBOARDING_DISMISSED_KEY = 'radnito_onboarding_dismissed';

export const wasOnboardingDismissed = (): boolean => {
  return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === 'true';
};

export const setOnboardingDismissed = (): void => {
  localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
};

const OnboardingOverlay: React.FC<OnboardingOverlayProps> = ({ onComplete, onSkipToGuide }) => {
  const [step, setStep] = useState(0);
  const [keyInput, setKeyInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const handleSaveKey = async () => {
    if (!keyInput.trim()) {
      setFeedback({ success: false, message: 'Please paste your API key first!' });
      return;
    }
    setVerifying(true);
    setFeedback({ success: true, message: 'Testing your key with Google Gemini...' });

    const isValid = await validateApiKey(keyInput.trim());
    setVerifying(false);

    if (isValid) {
      addApiKey(keyInput.trim());
      setFeedback({ success: true, message: '🎉 Your API key works! Setting up RADNITO for you...' });
      setOnboardingDismissed();
      setTimeout(() => onComplete(), 1200);
    } else {
      setFeedback({ success: false, message: '❌ This key doesn\'t seem valid. Make sure you copied the full key starting with AIzaSy...' });
    }
  };

  const handleSkip = () => {
    setOnboardingDismissed();
    onSkipToGuide();
  };

  const steps = [
    // Step 0: Welcome
    <div key="welcome" className="text-center space-y-6 animate-fade-in">
      <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-4xl shadow-xl mb-2">
        🩻
      </div>
      <h1 className="text-3xl sm:text-4xl font-black text-slate-800 dark:text-white">
        Welcome to <span className="text-blue-600 dark:text-blue-400">RADNITO</span>
      </h1>
      <p className="text-slate-600 dark:text-slate-300 text-base sm:text-lg max-w-lg mx-auto leading-relaxed">
        Your free AI-powered radiology dictation assistant. Record or upload audio dictations and get structured radiology reports instantly!
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto mt-4">
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-center">
          <div className="text-2xl mb-1">🎙️</div>
          <p className="text-xs font-bold text-blue-700 dark:text-blue-300">Record / Upload</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">Audio dictations</p>
        </div>
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
          <div className="text-2xl mb-1">🤖</div>
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">AI Processes</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">Gemini transcribes</p>
        </div>
        <div className="p-3 rounded-xl bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800 text-center">
          <div className="text-2xl mb-1">📋</div>
          <p className="text-xs font-bold text-violet-700 dark:text-violet-300">Get Reports</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">Structured output</p>
        </div>
      </div>
      <button
        onClick={() => setStep(1)}
        className="mt-4 bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl text-sm shadow-lg transition-all hover:scale-[1.03] active:scale-95"
      >
        Let's Get Started →
      </button>
    </div>,

    // Step 1: What is an API key?
    <div key="whatiskey" className="text-center space-y-5 animate-fade-in">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/50 text-3xl">
        🔑
      </div>
      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white">
        First, You Need a <span className="text-amber-600 dark:text-amber-400">Free API Key</span>
      </h2>
      <div className="text-left max-w-lg mx-auto space-y-4">
        <div className="bg-blue-50 dark:bg-slate-900/80 p-4 rounded-xl border border-blue-200 dark:border-blue-800 text-sm text-slate-700 dark:text-slate-300">
          <h4 className="font-bold text-blue-700 dark:text-blue-300 mb-2 flex items-center space-x-2">
            <span>💡</span><span>What is an API Key?</span>
          </h4>
          <p className="leading-relaxed text-xs">
            An <strong>API key</strong> is like a <strong>password</strong> that lets RADNITO talk to Google's Gemini AI on your behalf. 
            Think of it as a <strong>free pass</strong> that Google gives you so the AI can listen to your audio and create reports.
          </p>
        </div>

        <div className="bg-emerald-50 dark:bg-slate-900/80 p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 text-sm text-slate-700 dark:text-slate-300">
          <h4 className="font-bold text-emerald-700 dark:text-emerald-300 mb-2 flex items-center space-x-2">
            <span>✅</span><span>Why do I need one?</span>
          </h4>
          <ul className="text-xs space-y-1.5 list-disc pl-4 text-slate-600 dark:text-slate-400">
            <li>It's <strong>100% free</strong> — no credit card or payment needed</li>
            <li>It keeps <strong>your data private</strong> — only you control your key</li>
            <li>It takes less than <strong>1 minute</strong> to get one</li>
            <li>Your key is stored <strong>only in your browser</strong> — we never see it</li>
          </ul>
        </div>

        <div className="bg-rose-50 dark:bg-slate-900/80 p-4 rounded-xl border border-rose-200 dark:border-rose-800 text-sm text-slate-700 dark:text-slate-300">
          <h4 className="font-bold text-rose-700 dark:text-rose-300 mb-2 flex items-center space-x-2">
            <span>⚠️</span><span>Important</span>
          </h4>
          <p className="text-xs leading-relaxed">
            Without an API key, RADNITO <strong>cannot work</strong>. The AI needs this key to process your dictations. 
            But don't worry — getting one is super easy!
          </p>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 justify-center mt-4">
        <button
          onClick={() => setStep(0)}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold px-6 py-2.5 rounded-xl text-sm transition-all"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep(2)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold px-8 py-3 rounded-xl text-sm shadow-lg transition-all hover:scale-[1.03] active:scale-95"
        >
          Show Me How to Get a Key →
        </button>
      </div>
    </div>,

    // Step 2: Get the key + paste it
    <div key="getkey" className="text-center space-y-5 animate-fade-in">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 text-3xl">
        ⚡
      </div>
      <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-800 dark:text-white">
        Get Your Free Key in <span className="text-emerald-600 dark:text-emerald-400">3 Easy Steps</span>
      </h2>

      <div className="max-w-lg mx-auto space-y-3 text-left">
        {/* Mini step cards */}
        <div className="flex items-start space-x-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-sm">1</div>
          <div>
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">Open Google AI Studio</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Click the button below to open Google's free AI key page</p>
          </div>
        </div>
        <div className="flex items-start space-x-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-sm">2</div>
          <div>
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">Sign in & Click "Create API Key"</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Use any Google account. Select any project and click Create.</p>
          </div>
        </div>
        <div className="flex items-start space-x-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0 text-sm">3</div>
          <div>
            <p className="font-bold text-slate-800 dark:text-slate-100 text-sm">Copy the key & Paste it below</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Your key looks like: <code className="bg-slate-200 dark:bg-slate-700 px-1 py-0.5 rounded text-[10px]">AIzaSy...</code></p>
          </div>
        </div>
      </div>

      {/* Open Google AI Studio button */}
      <a
        href="https://aistudio.google.com/app/apikey"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center space-x-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold px-8 py-3 rounded-xl text-sm shadow-lg transition-all hover:scale-[1.03] active:scale-95"
      >
        <span>🔗 Open Google AI Studio (Free)</span>
        <span>↗</span>
      </a>

      {/* Paste key input */}
      <div className="max-w-lg mx-auto bg-emerald-50/70 dark:bg-slate-900/80 p-5 rounded-xl border border-emerald-200 dark:border-emerald-800 space-y-3">
        <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm text-left">📋 Paste your API key here:</h4>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => { setKeyInput(e.target.value); setFeedback(null); }}
            placeholder="Paste your API key here (e.g. AIzaSy...)"
            className="flex-1 px-4 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
          />
          <button
            onClick={handleSaveKey}
            disabled={verifying}
            className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-6 py-3 rounded-lg text-sm shadow transition-all whitespace-nowrap"
          >
            {verifying ? '⏳ Verifying...' : '✅ Save & Start'}
          </button>
        </div>

        {feedback && (
          <p className={`text-xs font-semibold text-left ${
            feedback.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
          }`}>
            {feedback.message}
          </p>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 justify-center mt-2">
        <button
          onClick={() => setStep(1)}
          className="text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 font-semibold px-6 py-2.5 rounded-xl text-sm transition-all"
        >
          ← Back
        </button>
        <button
          onClick={handleSkip}
          className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xs underline transition-all"
        >
          I'll set it up later — skip for now
        </button>
      </div>
    </div>,
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 p-4 overflow-y-auto">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-200/30 dark:bg-blue-900/20 blur-3xl"></div>
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-indigo-200/30 dark:bg-indigo-900/20 blur-3xl"></div>
      </div>

      <div className="relative w-full max-w-2xl mx-auto">
        {/* Step indicator */}
        <div className="flex justify-center space-x-2 mb-6">
          {[0, 1, 2].map(i => (
            <button
              key={i}
              onClick={() => setStep(i)}
              className={`h-2 rounded-full transition-all duration-300 ${
                step === i ? 'w-8 bg-blue-600' : 'w-2 bg-slate-300 dark:bg-slate-600 hover:bg-slate-400'
              }`}
              aria-label={`Step ${i + 1}`}
            />
          ))}
        </div>

        {/* Content card */}
        <div className="bg-white/80 dark:bg-slate-800/90 backdrop-blur-xl rounded-3xl shadow-2xl p-6 sm:p-10 border border-white/50 dark:border-slate-700/50">
          {steps[step]}
        </div>
      </div>
    </div>
  );
};

export default OnboardingOverlay;
