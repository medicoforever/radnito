import { jsPDF } from 'jspdf';

export const generateRadnitoPDF = () => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  let y = 15;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = 15;
    }
  };

  // Header Banner
  doc.setFillColor(30, 64, 175); // Dark blue
  doc.rect(margin, y, contentWidth, 24, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('RADNITO', margin + 6, y + 11);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('AI Radiology Dictation Corrector • User Guide & Documentation', margin + 6, y + 18);

  y += 30;

  // Website Link Section (AT THE START OF PDF)
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(191, 219, 254);
  doc.roundedRect(margin, y, contentWidth, 16, 2, 2, 'FD');

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('🌐 Official Web App URL:', margin + 4, y + 6);

  doc.setTextColor(37, 99, 235);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  const webUrl = 'https://medicoforever.github.io/radiology-dictation-app/';
  doc.textWithLink(webUrl, margin + 4, y + 12, { url: webUrl });

  y += 22;

  // Section 1: Overview
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('1. Overview of RADNITO', margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(51, 65, 85);
  const overviewText = doc.splitTextToSize(
    'RADNITO is an advanced AI-powered radiology speech-to-text dictation corrector. It converts spoken medical findings into clean, structured, and standard radiology reports in real-time. All processing runs 100% client-side in your browser using Google Gemini AI, ensuring zero server lag, 24/7 uptime, and complete privacy.',
    contentWidth
  );
  doc.text(overviewText, margin, y);
  y += overviewText.length * 4.5 + 4;

  // Section 2: How to get API Key
  checkPageBreak(35);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('2. How to Get a Free Gemini API Key (Step-by-Step)', margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);

  const steps = [
    'Step 1: Open Google AI Studio at https://aistudio.google.com/app/apikey',
    'Step 2: Sign in with any Google account (no credit card or payment required).',
    'Step 3: Click the blue "Create API Key" button and copy your generated key.',
    'Step 4: Click "Set Gemini API Key" in RADNITO and paste your key.',
  ];

  steps.forEach((step) => {
    doc.text(step, margin + 2, y);
    y += 5;
  });
  y += 3;

  // Section 3: Multi-Key Load Balancing & Auto-Fallback
  checkPageBreak(40);
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(margin, y, contentWidth, 34, 2, 2, 'FD');

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('🔑 3. Multi-Key Load Balancing & Auto-Fallback', margin + 4, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  const multiKeyDesc = doc.splitTextToSize(
    '• Add 2, 3, or more API keys from different Google accounts.\n' +
    '• Random Selection: RADNITO randomly selects an active key for each request to evenly distribute daily quota.\n' +
    '• Auto-Fallback: If one key hits a rate limit or quota error, RADNITO instantly retries using your next key without interrupting your dictation.',
    contentWidth - 8
  );
  doc.text(multiKeyDesc, margin + 4, y + 13);
  y += 40;

  // Section 4: Model Fallback Advice
  checkPageBreak(30);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('4. Model Selection & Error Handling', margin, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const modelAdvice = doc.splitTextToSize(
    '💡 Tip: If a selected model shows a quota error or rate limit, switch to a lower model in the AI Model dropdown (e.g. Gemini 3.5 Flash Lite or Gemini 2.5 Flash). Lower models process faster and have higher quota limits.',
    contentWidth
  );
  doc.text(modelAdvice, margin, y);
  y += modelAdvice.length * 4.5 + 4;

  // Section 5: Features (Single, Batch, Live)
  checkPageBreak(45);
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('5. Dictation Modes & Audio Preservation', margin, y);
  y += 6;

  const modeFeatures = [
    '• Single Mode: Record findings line-by-line. Download recorded audio files anytime and re-upload saved audio files to re-process dictations without loss.',
    '• Batch Mode: Process multiple audio dictations concurrently in bulk to save valuable time.',
    '• Live Mode (Experimental): Dictate in real-time. (Note: Live Mode is experimental; Single Mode is recommended for critical reports).',
  ];

  modeFeatures.forEach((feat) => {
    const lines = doc.splitTextToSize(feat, contentWidth - 4);
    doc.text(lines, margin + 2, y);
    y += lines.length * 4.5 + 2;
  });

  y += 6;

  // Section 6: Subscription Channels (AT THE END OF PDF)
  checkPageBreak(45);
  doc.setFillColor(240, 253, 244);
  doc.setDrawColor(187, 247, 208);
  doc.roundedRect(margin, y, contentWidth, 38, 2, 2, 'FD');

  doc.setTextColor(22, 101, 52);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('☯️ Subscribe to our channels for more updates:', margin + 4, y + 7);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(37, 99, 235);

  const channels = [
    { text: 'WhatsApp Channel: https://whatsapp.com/channel/0029Vb2S2bW0G0Xq94mR721T', url: 'https://whatsapp.com/channel/0029Vb2S2bW0G0Xq94mR721T' },
    { text: 'YouTube Channel: https://youtube.com/@raddoc96', url: 'https://youtube.com/@raddoc96' },
    { text: 'Telegram Channel: https://t.me/raddocs', url: 'https://t.me/raddocs' },
    { text: 'Telegram Group: https://t.me/radiology_chatgpt', url: 'https://t.me/radiology_chatgpt' },
    { text: 'X (Twitter): https://x.com/raddoc96', url: 'https://x.com/raddoc96' },
  ];

  let channelY = y + 13;
  channels.forEach((ch) => {
    doc.textWithLink(ch.text, margin + 4, channelY, { url: ch.url });
    channelY += 5;
  });

  // Footer Page Numbers
  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`RADNITO User Guide • Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 8, { align: 'center' });
  }

  doc.save('RADNITO_User_Guide.pdf');
};
