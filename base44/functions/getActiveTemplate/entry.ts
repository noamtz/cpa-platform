import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_STEPS = [
  {
    id: "employee",
    title: "שכיר",
    emoji: "💼",
    question: "האם היית שכיר בשנת {TAX_YEAR}?",
    yes_label: "כן, הייתי שכיר",
    no_label: "לא, לא הייתי שכיר",
    response_type: "upload",
    is_active: true,
    order: 1,
    upload_config: {
      title: "העלאת טופס 106",
      description: "אנא העלה את טופס 106 שקיבלת מהמעסיק/ים שלך.\nניתן להעלות מספר קבצים.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "pension",
    title: "פנסיה עצמאית",
    emoji: "🏦",
    question: "האם הפקדת לפנסיה/קרן השתלמות כעצמאי בשנת {TAX_YEAR}?",
    yes_label: "כן, הפקדתי",
    no_label: "לא, לא הפקדתי",
    response_type: "upload",
    is_active: true,
    order: 2,
    upload_config: {
      title: "אישורי מס פנסיה",
      description: "אנא העלה את אישורי המס מקרן הפנסיה/קרן ההשתלמות.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "stock",
    title: "שוק ההון",
    emoji: "📈",
    question: "האם השקעת בשוק ההון בשנת {TAX_YEAR}?",
    yes_label: "כן, השקעתי",
    no_label: "לא, לא השקעתי",
    response_type: "upload",
    is_active: true,
    order: 3,
    upload_config: {
      title: "העלאת טופס 867",
      description: "אנא העלה את טופס 867 מהבנק/ברוקר שלך.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "insurance",
    title: "ביטוח חיים",
    emoji: "🛡️",
    question: "האם יש לך ביטוח חיים?",
    yes_label: "כן, יש לי ביטוח חיים",
    no_label: "לא, אין לי ביטוח חיים",
    response_type: "upload",
    is_active: true,
    order: 4,
    upload_config: {
      title: "אישורי ביטוח חיים",
      description: "אנא העלה את אישורי תשלום פרמיות ביטוח החיים.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "donations",
    title: "תרומות",
    emoji: "❤️",
    question: "האם תרמת לעמותות עם סעיף 46 בשנת {TAX_YEAR}?",
    yes_label: "כן, תרמתי",
    no_label: "לא, לא תרמתי",
    response_type: "upload",
    is_active: true,
    order: 5,
    upload_config: {
      title: "קבלות תרומה",
      description: "אנא העלה קבלות תרומה לעמותות מוכרות.",
      upload_label: "לחץ להעלאת קובץ",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
  },
  {
    id: "additional_income",
    title: "הכנסות נוספות",
    emoji: "💰",
    question: "האם היו לך הכנסות נוספות בשנת {TAX_YEAR}?",
    yes_label: "כן, היו לי הכנסות נוספות",
    no_label: "לא, לא היו לי הכנסות נוספות",
    response_type: "text",
    is_active: true,
    order: 6,
    text_config: {
      title: "פרטי הכנסות נוספות",
      description: "אנא פרט את ההכנסות הנוספות שהיו לך (שכירות, פרילנס, ייעוץ וכו׳)",
      placeholder: "לדוגמה: הכנסות שכירות מדירה, עבודה כפרילנסר בתחום...",
      rows: 4,
    },
  },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const templates = await base44.asServiceRole.entities.QuestionnaireTemplate.filter({ is_active: true });

    if (templates && templates.length > 0) {
      const latest = templates.sort((a, b) => b.version - a.version)[0];
      const steps = typeof latest.steps === 'string' ? JSON.parse(latest.steps) : latest.steps;
      return Response.json({ template: { ...latest, steps } });
    }

    // No template exists — create default
    const newTemplate = await base44.asServiceRole.entities.QuestionnaireTemplate.create({
      version: 1,
      is_active: true,
      steps: JSON.stringify(DEFAULT_STEPS),
    });

    return Response.json({ template: { ...newTemplate, steps: DEFAULT_STEPS } });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});