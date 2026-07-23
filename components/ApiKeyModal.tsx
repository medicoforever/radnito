import React, { useState, useEffect } from 'react';
import { getStoredApiKey, setStoredApiKey, removeStoredApiKey, validateApiKey } from '../services/apiKeyStore';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onKeyChange?: () => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({ isOpen, onClose, onKeyChange }) => {
  const [inputKey, setInputKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const current = getStoredApiKey();
      setInputKey(current);
      setIsSaved(!!current);
      setStatusMsg(current ? { type: 'success', text: 'Gemini API Key is active and saved in your browser storage.' } : null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!inputKey.trim()) {
      setStatusMsg({ type: 'error', text: 'Please enter a valid Gemini API Key.' });
      return;
    }
    setTesting(true);
    setStatusMsg({ type: 'info', text: 'Validating key with Google Gemini API...' });

    const isValid = await validateApiKey(inputKey.trim());
    setTesting(false);

    if (isValid) {
      setStoredApiKey(inputKey.trim());
      setIsSaved(true);
      setStatusMsg({ type: 'success', text: '✅ API Key verified and saved successfully!' });
      if (onKeyChange) onKeyChange();
      setTimeout(() => {
        onClose();
      }, 1200);
    } else {
      setStatusMsg({ type: 'error', text: '❌ Invalid API Key. Please check your key from Google AI Studio and try again.' });
    }
  };

  const handleRemove = () => {
    removeStoredApiKey();
    setInputKey('');
    setIsSaved(false);
    setStatusMsg({ type: 'info', text: 'API Key removed from this browser.' });
    if (onKeyChange) onKeyChange();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-700 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xl font-bold p-1 rounded-lg transition-colors"
          aria-label="Close modal"
        >
          ✕
        </button>

        <div className="flex items-center space-x-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xl font-bold">
            🔑
          </div>
          <div>
            <h3 className="text-xl font-bold">Gemini API Key Settings</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">Stored locally & securely in your browser</p>
          </div>
        </div>

        <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
          Enter your personal Google Gemini API key to use all AI features. Your key is never shared or stored on any server.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
              Your Gemini API Key
            </label>
            <input
              type="password"
              value={inputKey}
              onChange={(e) => setInputKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-blue-500 focus:outline-none transition-all font-mono"
            />
          </div>

          {statusMsg && (
            <div
              className={`p-3 rounded-lg text-xs font-medium ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800'
                  : statusMsg.type === 'error'
                  ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                  : 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
              }`}
            >
              {statusMsg.text}
            </div>
          )}

          <div className="flex flex-col gap-2 pt-2">
            <button
              onClick={handleSave}
              disabled={testing}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold py-2.5 px-4 rounded-lg shadow-md transition-all flex items-center justify-center space-x-2 text-sm"
            >
              {testing ? (
                <>
                  <span className="animate-spin text-base">⏳</span>
                  <span>Verifying Key...</span>
                </>
              ) : (
                <span>{isSaved ? 'Save / Update Key' : 'Save API Key'}</span>
              )}
            </button>

            {isSaved && (
              <button
                onClick={handleRemove}
                disabled={testing}
                className="w-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-950/60 text-rose-600 dark:text-rose-400 font-semibold py-2 px-4 rounded-lg transition-all text-xs"
              >
                Remove Saved Key
              </button>
            )}

            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-center text-xs text-blue-600 dark:text-blue-400 hover:underline pt-1 flex items-center justify-center space-x-1"
            >
              <span>Need a free key? Get it from Google AI Studio</span>
              <span>↗</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ApiKeyModal;
