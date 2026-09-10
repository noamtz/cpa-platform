import { Wrench } from "lucide-react";

export default function Maintenance() {
  return (
    <main dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Wrench aria-hidden="true" className="h-7 w-7" />
        </div>
        <h1 className="text-2xl font-semibold text-foreground">המערכת נמצאת בתחזוקה קצרה</h1>
        <p className="mt-3 leading-7 text-muted-foreground">
          כדי לשמור על המידע שלך, פעולות עדכון אינן זמינות כרגע. אפשר לנסות שוב בעוד מספר דקות.
        </p>
        <button
          type="button"
          className="mt-6 rounded-lg bg-primary px-5 py-2.5 font-medium text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          נסו שוב
        </button>
      </section>
    </main>
  );
}
