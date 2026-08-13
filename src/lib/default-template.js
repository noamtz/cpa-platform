/**
 * Default questionnaire template — matches the original hardcoded steps.
 * Used as the v1 seed when no template exists yet.
 */

export const DEFAULT_STEPS = [
  {
    id: "employee",
    emoji: "💼",
    title: "עבודה כשכיר",
    question: "האם היית שכיר בשנת {year} (בנוסף לפעילות העצמאית)?",
    yes_label: "כן, הייתי שכיר",
    no_label: "לא, לא הייתי שכיר",
    response_type: "upload",
    upload_config: {
      title: "טופס 106",
      description: "יש לפנות למעסיק ולבקש טופס 106 לשנת {year}.\nאם היה יותר ממעסיק אחד — יש לפנות לכל מעסיק בנפרד.",
      upload_label: "העלאת טופס 106",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
    text_config: null,
    enabled: true,
    order: 0,
    is_default: true,
  },
  {
    id: "pension",
    emoji: "🏦",
    title: "פנסיה / קרן השתלמות",
    question: "האם הפקדת כספים לפנסיה או קרן השתלמות כעצמאי בשנת {year}?",
    yes_label: "כן, הפקדתי",
    no_label: "לא הפקדתי (או רק כשכיר)",
    response_type: "upload",
    upload_config: {
      title: "אישורי מס",
      description: "יש לפנות לקופה/קרן ולבקש אישורי מס על ההפקדות לשנת {year}.",
      upload_label: "העלאת אישורי מס",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
    text_config: null,
    enabled: true,
    order: 1,
    is_default: true,
  },
  {
    id: "stocks",
    emoji: "📈",
    title: "שוק ההון",
    question: "האם השקעת בשוק ההון בשנת {year}?",
    yes_label: "כן, יש לי השקעות",
    no_label: "לא, אין לי השקעות",
    response_type: "upload",
    upload_config: {
      title: "טופס 867",
      description: "יש לפנות לבית ההשקעות ולבקש טופס 867 לשנת {year}.",
      upload_label: "העלאת טופס 867",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
    text_config: null,
    enabled: true,
    order: 2,
    is_default: true,
  },
  {
    id: "insurance",
    emoji: "🛡️",
    title: "ביטוח חיים",
    question: "האם יש לך ביטוחי חיים בשנת {year}?",
    yes_label: "כן, יש לי ביטוח חיים",
    no_label: "לא, אין לי ביטוח חיים",
    response_type: "upload",
    upload_config: {
      title: "אישורי מס ביטוח חיים",
      description: "יש לפנות לחברת הביטוח ולבקש אישורי מס על ביטוח חיים לשנת {year}.",
      upload_label: "העלאת אישורי מס",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
    text_config: null,
    enabled: true,
    order: 3,
    is_default: true,
  },
  {
    id: "donations",
    emoji: "❤️",
    title: "תרומות",
    question: "האם תרמת לעמותות עם סעיף 46 בשנת {year}?",
    yes_label: "כן, תרמתי",
    no_label: "לא, לא תרמתי",
    response_type: "upload",
    upload_config: {
      title: "קבלות תרומה",
      description: "יש לצרף קבלות בגין תרומות לשנת {year}.\nקבלות דיגיטליות ניתן להעלות ישירות כאן.",
      upload_label: "העלאת קבלות תרומה",
      accept: ".pdf,.jpg,.jpeg,.png,.heic",
    },
    text_config: null,
    enabled: true,
    order: 4,
    is_default: true,
  },
  {
    id: "additional",
    emoji: "💰",
    title: "הכנסות נוספות",
    question: "האם היו לך הכנסות נוספות בשנת {year}?",
    yes_label: "כן, היו הכנסות נוספות",
    no_label: "לא, לא היו",
    response_type: "text",
    upload_config: null,
    text_config: {
      title: "פרטי הכנסות נוספות",
      description: "נא לתאר בקצרה את ההכנסות הנוספות (שכר דירה, מכירת נכס, ירושה, וכד׳). רואה החשבון יחזור אליך.",
      placeholder: "תאר כאן את ההכנסות הנוספות...",
      rows: 4,
    },
    enabled: true,
    order: 5,
    is_default: true,
  },
];

/**
 * Replace {year} placeholders with the actual tax year.
 */
export function resolveYearPlaceholders(steps, taxYear) {
  const year = String(taxYear);
  const r = (s) => s ? s.replace(/\{year\}/g, year) : s;
  return steps.map((step) => ({
    ...step,
    title: r(step.title),
    question: r(step.question),
    upload_config: step.upload_config
      ? {
          ...step.upload_config,
          title: r(step.upload_config.title),
          description: r(step.upload_config.description),
          upload_label: r(step.upload_config.upload_label),
        }
      : null,
    text_config: step.text_config
      ? {
          ...step.text_config,
          title: r(step.text_config.title),
          description: r(step.text_config.description),
        }
      : null,
  }));
}

/**
 * Parse steps JSON string from entity, with fallback to defaults.
 */
export function parseTemplateSteps(stepsJson) {
  try {
    const parsed = JSON.parse(stepsJson);
    return Array.isArray(parsed) ? parsed : DEFAULT_STEPS;
  } catch {
    return DEFAULT_STEPS;
  }
}

/**
 * Get only enabled steps, sorted by order.
 */
export function getActiveSteps(steps) {
  return steps
    .filter((s) => s.enabled)
    .sort((a, b) => a.order - b.order);
}