import React, { useState } from 'react';
import { addApiKey, validateApiKey } from '../services/apiKeyStore';
import { generateRadnitoPDF } from '../services/pdfGenerator';

interface ApiKeyGuideTabProps {
  onKeySaved?: () => void;
}

export const ApiKeyGuideTab: React.FC<ApiKeyGuideTabProps> = ({ onKeySaved }) => {
  const [keyInput, setKeyInput] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [feedback, setFeedback] = useState<{ success: boolean; message: string } | null>(null);

  const handleQuickSave = async () => {
    if (!keyInput.trim()) {
      setFeedback({ success: false, message: 'Please paste your API key first!' });
      return;
    }
    setVerifying(true);
    setFeedback({ success: true, message: 'Testing key with Google Gemini API...' });

    const isValid = await validateApiKey(keyInput.trim());
    setVerifying(false);

    if (isValid) {
      addApiKey(keyInput.trim());
      setFeedback({ success: true, message: '🎉 Key saved successfully! You are ready to dictate.' });
      if (onKeySaved) onKeySaved();
    } else {
      setFeedback({ success: false, message: 'Invalid API Key. Please make sure you copied the entire key starting with AIzaSy...' });
    }
  };

  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 shadow-xl border border-slate-200 dark:border-slate-700 max-w-3xl mx-auto my-4 space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl p-6 text-white shadow-md flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <span className="inline-block bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-2">
            100% Free & Unlimited
          </span>
          <h2 className="text-2xl font-extrabold">How to Get Your Free Gemini API Key</h2>
          <p className="text-blue-100 text-sm mt-1">
            Follow this 1-minute guide for RADNITO speech dictation!
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-white text-blue-700 hover:bg-blue-50 font-bold px-4 py-2.5 rounded-xl shadow transition-all whitespace-nowrap text-xs flex items-center justify-center space-x-1"
          >
            <span>Get Free Key Now</span>
            <span>↗</span>
          </a>
          <button
            onClick={generateRadnitoPDF}
            className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold px-4 py-2.5 rounded-xl shadow transition-all whitespace-nowrap text-xs flex items-center justify-center space-x-1"
          >
            <span>📄 Download PDF Guide</span>
          </button>
        </div>
      </div>

      {/* Why Add Multiple Keys Callout */}
      <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-300 space-y-1">
        <h4 className="font-bold flex items-center space-x-1 text-sm text-amber-800 dark:text-amber-200">
          <span>⚡ Pro Tip: Add 2 or 3 API Keys for Zero Downtime!</span>
        </h4>
        <p>
          You can add multiple API keys from different Google accounts into RADNITO. RADNITO randomly balances requests across all keys to preserve quota, and automatically failovers if one key hits a rate limit!
        </p>
      </div>

      {/* 4 Step Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Step 1 */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex space-x-3 items-start">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0">
            1
          </div>
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Open Google AI Studio</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Click the button above or visit{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline font-medium"
              >
                aistudio.google.com/app/apikey
              </a>.
            </p>
          </div>
        </div>

        {/* Step 2 */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex space-x-3 items-start">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0">
            2
          </div>
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Sign in with Google</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Log in using any existing Google account. No credit card or payment info is required.
            </p>
          </div>
        </div>

        {/* Step 3 */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex space-x-3 items-start">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0">
            3
          </div>
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Click "Create API Key"</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Click the blue <strong>Create API Key</strong> button, select a project, and copy your key.
            </p>
          </div>
        </div>

        {/* Step 4 */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50 flex space-x-3 items-start">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white font-bold flex items-center justify-center flex-shrink-0">
            4
          </div>
          <div>
            <h4 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Paste Key Below & Save</h4>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
              Paste your key below. It will be stored securely in your browser's local memory.
            </p>
          </div>
        </div>
      </div>

      {/* Quick Paste Form */}
      <div className="bg-blue-50/70 dark:bg-slate-900/80 p-5 rounded-xl border border-blue-200 dark:border-blue-900/50 space-y-3">
        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center space-x-2">
          <span>⚡ Quick Key Setup</span>
        </h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="Paste your API key here (e.g. AIzaSy...)"
            className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            onClick={handleQuickSave}
            disabled={verifying}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-lg text-sm shadow transition-all whitespace-nowrap"
          >
            {verifying ? 'Verifying...' : 'Save & Start Dictating'}
          </button>
        </div>

        {feedback && (
          <p
            className={`text-xs font-semibold ${
              feedback.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            }`}
          >
            {feedback.message}
          </p>
        )}
      </div>
    </div>
  );
};

export default ApiKeyGuideTab;
