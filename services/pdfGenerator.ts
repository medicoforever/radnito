import { jsPDF } from 'jspdf';

export const generateRadnitoPDF = () => {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 14;

  const checkPageBreak = (neededHeight: number) => {
    if (y + neededHeight > pageHeight - margin) {
      doc.addPage();
      y = 14;
    }
  };

  // Helper to draw a section header badge
  const drawSectionHeader = (title: string, stepNum?: string) => {
    checkPageBreak(12);
    doc.setFillColor(30, 58, 138); // Deep indigo
    doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const text = stepNum ? `${stepNum}. ${title}` : title;
    doc.text(text.toUpperCase(), margin + 4, y + 5.5);

    y += 12;
  };

  // ==========================================
  // TOP HEADER BANNER
  // ==========================================
  doc.setFillColor(30, 64, 175); // Royal Blue
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('RADNITO', margin, 14);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text('AI Radiology Dictation Corrector • Complete User Manual & Guide', margin, 21);

  y = 34;

  // ==========================================
  // OFFICIAL WEB APP LINK CARD (START OF PDF)
  // ==========================================
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(191, 219, 254);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentWidth, 18, 2, 2, 'FD');

  doc.setTextColor(30, 58, 138);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('OFFICIAL WEB APP URL (CLICK TO OPEN):', margin + 4, y + 6);

  const officialUrl = 'https://medicoforever.github.io/radnito/';
  doc.setTextColor(37, 99, 235);
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.text(officialUrl, margin + 4, y + 12.5);

  // Add explicit clickable link annotation box
  doc.link(margin + 4, y + 8, contentWidth - 8, 7, { url: officialUrl });

  y += 24;

  // ==========================================
  // SECTION 1: OVERVIEW
  // ==========================================
  drawSectionHeader('Overview & Architecture', '1');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const overviewText = doc.splitTextToSize(
    'RADNITO is an advanced AI-powered radiology speech-to-text dictation corrector designed for radiologists and medical professionals. It transforms raw, misheard spoken dictations into clean, structured, line-by-line radiology report findings in real-time. All AI processing runs 100% client-side in your browser using Google Gemini AI, ensuring zero server lag, 24/7 uptime, and absolute privacy.',
    contentWidth
  );
  doc.text(overviewText, margin, y);
  y += overviewText.length * 4.2 + 4;

  // ==========================================
  // SECTION 2: HOW TO GET FREE GEMINI API KEYS
  // ==========================================
  drawSectionHeader('How to Get a Free Gemini API Key (Step-by-Step)', '2');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.8);
  doc.setTextColor(51, 65, 85);

  const steps = [
    { title: 'Step 1: Open Google AI Studio', desc: 'Visit https://aistudio.google.com/app/apikey (100% Free).', link: 'https://aistudio.google.com/app/apikey' },
    { title: 'Step 2: Sign in with Google', desc: 'Log in with any existing Google account. No credit card required.' },
    { title: 'Step 3: Create API Key', desc: 'Click the blue "Create API Key" button and copy your generated key string.' },
    { title: 'Step 4: Paste into RADNITO', desc: 'Click "Set Gemini API Key" in RADNITO header and paste your key.' },
  ];

  steps.forEach((s) => {
    checkPageBreak(12);
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(margin, y, contentWidth, 10, 1.5, 1.5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 58, 138);
    doc.text(s.title, margin + 3, y + 4);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(s.desc, margin + 3, y + 8);

    if (s.link) {
      doc.link(margin + 3, y + 5, contentWidth - 6, 4, { url: s.link });
    }

    y += 12;
  });

  y += 2;

  // ==========================================
  // SECTION 3: MULTI-KEY LOAD BALANCING & FALLBACK
  // ==========================================
  drawSectionHeader('Multi-API Key Load Balancing & Automatic Failover', '3');

  const multiKeyTextLines = [
    '• Add Multiple API Keys: You can add 2, 3, or more Gemini API keys from different Google accounts into RADNITO.',
    '• Randomized Quota Selection: RADNITO randomly selects one of your saved keys for each dictation request to distribute daily quota evenly.',
    '• Automatic Failover: If any key encounters a rate limit (429) or quota error, RADNITO automatically retries using your next saved key without failing your dictation!',
    '• Privacy First: All saved keys are stored strictly in your browser local storage and never sent to any third-party server.',
  ];

  let cardHeight = 8;
  const splitLinesArray: string[][] = [];

  multiKeyTextLines.forEach(line => {
    const split = doc.splitTextToSize(line, contentWidth - 8);
    splitLinesArray.push(split);
    cardHeight += split.length * 4.2 + 1.5;
  });

  checkPageBreak(cardHeight + 4);
  doc.setFillColor(254, 243, 199); // Warm Amber/Yellow
  doc.setDrawColor(251, 191, 36);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentWidth, cardHeight, 2, 2, 'FD');

  doc.setTextColor(146, 64, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('PRO TIP: WHY YOU SHOULD ADD 2 OR MORE KEYS', margin + 4, y + 6);

  let innerY = y + 11;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(120, 53, 15);

  splitLinesArray.forEach(split => {
    doc.text(split, margin + 4, innerY);
    innerY += split.length * 4.2 + 1.5;
  });

  y += cardHeight + 6;

  // ==========================================
  // SECTION 4: MODEL SELECTION & LOWER MODEL FALLBACK
  // ==========================================
  drawSectionHeader('Model Selection & Error Fallback Instructions', '4');

  const modelText = doc.splitTextToSize(
    'RADNITO includes high-speed Flash models (Gemini 3.6 Flash, Gemini 3.5 Flash, Gemini 3 Flash, Gemini 2.5 Flash, Gemini 3.5 Flash Lite).\n\n' +
    '💡 Lower Model Fallback Advice: If a selected model shows a quota error or rate limit, switch to a lower model in the AI Model dropdown (e.g. Gemini 3.5 Flash Lite or Gemini 2.5 Flash). Lower models process audio faster and have significantly higher quota limits.',
    contentWidth - 6
  );

  const modelCardHeight = modelText.length * 4.2 + 8;
  checkPageBreak(modelCardHeight + 4);

  doc.setFillColor(240, 253, 244); // Light Emerald
  doc.setDrawColor(187, 247, 208);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentWidth, modelCardHeight, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(22, 101, 52);
  doc.text(modelText, margin + 3, y + 6);

  y += modelCardHeight + 6;

  // ==========================================
  // SECTION 5: DICTATION MODES & AUDIO PRESERVATION
  // ==========================================
  drawSectionHeader('Dictation Modes & Audio Preservation', '5');

  const modeDescriptions = [
    '• Single Mode: Record audio findings line-by-line. Your audio recording is preserved safely. Click "Download Audio Recording" anytime to save recorded audio (.webm/.ogg), or drag-and-drop saved audio files to re-process dictations without loss.',
    '• Batch Mode: Upload and transcribe multiple dictation audio files concurrently in bulk to save time.',
    '• Live Mode (Experimental Notice): Dictate in real-time. Note: Live Mode is experimental; Single Mode with audio recording is recommended for critical or lengthy reports.',
  ];

  modeDescriptions.forEach((modeText) => {
    const split = doc.splitTextToSize(modeText, contentWidth - 2);
    checkPageBreak(split.length * 4.2 + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(split, margin + 2, y);
    y += split.length * 4.2 + 3;
  });

  y += 4;

  // ==========================================
  // SECTION 6: SUBSCRIBE TO OUR CHANNELS (END OF PDF)
  // ==========================================
  checkPageBreak(44);
  doc.setFillColor(238, 242, 255); // Indigo Tint
  doc.setDrawColor(199, 210, 254);
  doc.setLineWidth(0.5);
  doc.roundedRect(margin, y, contentWidth, 42, 2, 2, 'FD');

  doc.setTextColor(49, 46, 129);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('SUBSCRIBE TO OUR CHANNELS FOR MORE UPDATES & ANNOUNCEMENTS:', margin + 4, y + 6);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(37, 99, 235);

  const channelLinks = [
    { label: 'WhatsApp Channel:', urlText: 'https://whatsapp.com/channel/0029Vb2S2bW0G0Xq94mR721T', url: 'https://whatsapp.com/channel/0029Vb2S2bW0G0Xq94mR721T' },
    { label: 'YouTube Channel:', urlText: 'https://youtube.com/@raddoc96', url: 'https://youtube.com/@raddoc96' },
    { label: 'Telegram Channel:', urlText: 'https://t.me/raddocs', url: 'https://t.me/raddocs' },
    { label: 'Telegram Group:', urlText: 'https://t.me/radiology_chatgpt', url: 'https://t.me/radiology_chatgpt' },
    { label: 'X (Twitter):', urlText: 'https://x.com/raddoc96', url: 'https://x.com/raddoc96' },
  ];

  let linkY = y + 12;
  channelLinks.forEach((ch) => {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(ch.label, margin + 4, linkY);

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(ch.urlText, margin + 36, linkY);

    // Make URL clickable
    doc.link(margin + 36, linkY - 3, 110, 4.5, { url: ch.url });

    linkY += 5.5;
  });

  // Footer Page Numbers
  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`RADNITO User Manual • Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  doc.save('RADNITO_User_Guide.pdf');
};
