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

  const drawSectionHeader = (title: string, stepNum?: string) => {
    checkPageBreak(12);
    doc.setFillColor(30, 58, 138);
    doc.roundedRect(margin, y, contentWidth, 8, 1.5, 1.5, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    const text = stepNum ? `${stepNum}. ${title}` : title;
    doc.text(text.toUpperCase(), margin + 4, y + 5.5);

    y += 12;
  };

  // TOP HEADER BANNER
  doc.setFillColor(30, 64, 175);
  doc.rect(0, 0, pageWidth, 28, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('RADNITO', margin, 14);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  doc.text('Batch Radiology Dictation Workspace • Complete User Manual', margin, 21);

  y = 34;

  // OFFICIAL WEB APP LINK CARD
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
  doc.link(margin + 4, y + 8, contentWidth - 8, 7, { url: officialUrl });

  y += 24;

  // SECTION 1: OVERVIEW & BATCH DICTATION ARCHITECTURE
  drawSectionHeader('Overview & Batch Architecture', '1');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(51, 65, 85);
  const overviewText = doc.splitTextToSize(
    'RADNITO is an advanced batch radiology dictation and audio processing application built for radiologists. It allows you to upload, record, and process multiple radiology dictations concurrently in bulk. All AI processing runs 100% client-side in your browser using Google Gemini AI, ensuring zero server lag, 24/7 uptime, and absolute privacy.',
    contentWidth
  );
  doc.text(overviewText, margin, y);
  y += overviewText.length * 4.2 + 4;

  // SECTION 2: HOW TO GET FREE GEMINI API KEYS
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

  // SECTION 3: MULTI-KEY LOAD BALANCING
  drawSectionHeader('Multi-API Key Load Balancing & Automatic Failover', '3');

  const multiKeyTextLines = [
    '• Save Multiple API Keys: Add 2, 3, or more Gemini API keys from different Google accounts into RADNITO.',
    '• Randomized Quota Selection: RADNITO randomly selects one of your saved keys for each batch dictation request to balance daily quota.',
    '• Automatic Failover: If any key hits a rate limit (429) or quota error, RADNITO automatically retries using your next saved key seamlessly.',
    '• Client-Side Storage: All keys remain strictly in browser local storage and are never sent to external servers.',
  ];

  let cardHeight = 8;
  const splitLinesArray: string[][] = [];

  multiKeyTextLines.forEach(line => {
    const split = doc.splitTextToSize(line, contentWidth - 8);
    splitLinesArray.push(split);
    cardHeight += split.length * 4.2 + 1.5;
  });

  checkPageBreak(cardHeight + 4);
  doc.setFillColor(254, 243, 199);
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

  // SECTION 4: BATCH FEATURES & AUDIO PRESERVATION
  drawSectionHeader('Batch Workspace Features & Audio Downloads', '4');

  const batchFeatures = [
    '• Bulk Multi-File Transcribing: Upload or record multiple audio files and process them concurrently with Gemini AI.',
    '• Audio Download Buttons: Download original or recorded audio files (.webm/.ogg) anytime directly from each batch item card.',
    '• Model Fallback Advice: If a model hits a quota limit, switch to Gemini 3.5 Flash Lite or Gemini 2.5 Flash in the model dropdown.',
    '• Multi-Format Export: Export all completed batch reports as structured HTML, Text, or PDF documents.',
  ];

  batchFeatures.forEach((feat) => {
    const split = doc.splitTextToSize(feat, contentWidth - 2);
    checkPageBreak(split.length * 4.2 + 4);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(51, 65, 85);
    doc.text(split, margin + 2, y);
    y += split.length * 4.2 + 3;
  });

  y += 4;

  // SECTION 5: SUBSCRIBE TO CHANNELS
  checkPageBreak(44);
  doc.setFillColor(238, 242, 255);
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

    doc.link(margin + 36, linkY - 3, 110, 4.5, { url: ch.url });

    linkY += 5.5;
  });

  const totalPages = doc.internal.pages.length - 1;
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text(`RADNITO Batch Dictation Manual • Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 6, { align: 'center' });
  }

  doc.save('RADNITO_User_Guide.pdf');
};
