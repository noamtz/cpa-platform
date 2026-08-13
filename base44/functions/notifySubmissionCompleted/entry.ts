import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const payload = await req.json();
    const { event, data } = payload;

    // Only trigger on Submission update events
    if (event?.type !== 'update' || event?.entity_name !== 'Submission') {
      return Response.json({ skipped: 'not a submission update' });
    }

    const submission = data || {};
    
    // Only send alert if:
    // 1. This is the FIRST time the status became "completed" (progress = 100)
    // 2. There's no previous alert sent flag (alert_sent)
    // 3. The submission is freshly completed (not already having cpa_status)

    // Check if submission just became completed and hasn't triggered alert yet
    const isNewlyCompleted = submission.step_completed > 0 && !submission.alert_sent;
    
    if (!isNewlyCompleted) {
      return Response.json({ skipped: 'not newly completed' });
    }

    // Get client info for the alert message
    const client = await base44.asServiceRole.entities.Client.read(submission.client_id);
    if (!client) {
      return Response.json({ error: 'Client not found' }, { status: 404 });
    }

    // Build Telegram message
    const taxYear = submission.tax_year || 2024;
    const message = `
✅ *הגשה מוכנה לסקירה*

👤 ${client.full_name}
📅 שנת מס: ${taxYear}
🏢 סוג עוסק: ${client.osek_type || 'לא מוגדר'}

→ [בדוק בדשבורד](${process.env.APP_URL || 'https://your-app.com'}?client=${client.id})
    `.trim();

    // Send to Telegram (using your bot token and group ID from environment)
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (!botToken || !chatId) {
      return Response.json({ 
        warning: 'Telegram not configured', 
        message: 'Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in environment variables' 
      });
    }

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return Response.json({ error: 'Telegram API failed', details: error }, { status: 500 });
    }

    // Mark alert as sent so it only triggers once
    await base44.asServiceRole.entities.Submission.update(submission.id, { 
      alert_sent: true 
    });

    return Response.json({ 
      success: true, 
      message: `Alert sent for ${client.full_name}` 
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});