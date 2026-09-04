import React from "react";
import { Button as UntypedButton } from "@/components/ui/button";
import { motion } from "framer-motion";

const Button = /** @type {React.ComponentType<any>} */ (UntypedButton);

export default function WelcomeStep({ client, onStart, isStarting = false }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      {/* Hero card */}
      <div className="bg-white rounded-3xl p-6 border border-border shadow-sm text-center">
        <img
          src="/brand-image.jpg"
          alt="Doron & Doron"
          className="h-20 w-auto object-contain mx-auto mb-4"
        />
        <h1 className="text-2xl font-bold text-foreground mb-2">
          שלום{client?.full_name ? `, ${client.full_name.split(" ")[0]}` : ""}! 👋
        </h1>
        <p className="text-muted-foreground leading-relaxed">
          אנחנו כאן כדי לעזור לך לאסוף את כל המסמכים לדוח השנתי {client?.tax_year || 2024}.
          <br />
          <strong className="text-foreground">זה לוקח כ-5 דקות</strong> ואפשר להפסיק ולחזור בכל עת.
          {client?.pricing != null && (
            <>
              <br />
              <span className="text-sm">עלות הדוח השנתי: <strong className="text-foreground">{Number(client.pricing).toLocaleString("he-IL")} ₪ + מע״מ</strong></span>
            </>
          )}
        </p>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 gap-3">
        {[
          { icon: "🕐", title: "שמירה אוטומטית", desc: "כל מה שתמלא נשמר אוטומטית" },
          { icon: "📎", title: "העלאת קבצים", desc: "אפשר להעלות מהטלפון, סריקה, או PDF" },
          { icon: "💬", title: "שאלות?", desc: "רואה החשבון שלך יראה את ההתקדמות שלך" },
        ].map((item) => (
          <div key={item.title} className="flex items-center gap-4 bg-white rounded-2xl p-4 border border-border">
            <div className="text-2xl w-10 text-center flex-shrink-0">{item.icon}</div>
            <div>
              <p className="font-semibold text-foreground text-sm">{item.title}</p>
              <p className="text-muted-foreground text-xs mt-0.5">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <Button
        onClick={onStart}
        disabled={isStarting}
        size="lg"
        className="w-full bg-primary hover:bg-primary/90 text-white rounded-2xl h-14 text-base font-semibold shadow-sm"
      >
        בואו נתחיל! ✨
      </Button>


    </motion.div>
  );
}
