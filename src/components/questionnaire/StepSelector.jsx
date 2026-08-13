import React, { useState } from "react";
import { ChevronDown } from "lucide-react";

export default function StepSelector({ steps, currentStepId, completedSteps, incompleteSteps = [], onSelectStep }) {
  const [open, setOpen] = useState(false);

  const currentIndex = steps.findIndex(s => s.id === currentStepId);
  const currentStep = steps[currentIndex];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2 rounded-xl border border-border bg-white hover:bg-muted flex items-center justify-between gap-2 text-sm font-medium text-right transition-colors"
      >
        {currentStep && (
          <>
            <ChevronDown className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} />
            <span className="text-muted-foreground">{currentStep.emoji}</span>
            <span className="flex-1">{currentStep.title}</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full mt-2 w-full bg-white border border-border rounded-xl shadow-lg z-50">
          {steps.map((step, idx) => {
            const isCompleted = completedSteps.includes(step.id);
            const isIncomplete = incompleteSteps.includes(step.id);
            const isCurrent = step.id === currentStepId;
            const isReachable = idx <= currentIndex; // any step user has reached

            return (
              <button
                key={step.id}
                onClick={() => {
                  onSelectStep(idx + 1); // +1 because step 0 is welcome
                  setOpen(false);
                }}
                className={`w-full px-4 py-3 text-right flex items-center gap-3 text-sm transition-colors ${
                  isCurrent
                    ? "bg-primary/10 border-r-2 border-primary text-foreground font-medium"
                    : isCompleted
                    ? "hover:bg-muted text-foreground cursor-pointer"
                    : isIncomplete
                    ? "hover:bg-muted text-foreground cursor-pointer bg-amber-50"
                    : "hover:bg-muted text-foreground cursor-pointer"
                }`}
              >
                <span className="text-lg">{step.emoji}</span>
                <span className="flex-1">{step.title}</span>
                {isCurrent && <span className="text-xs text-primary font-semibold">עכשיו</span>}
                {isCompleted && !isCurrent && <span className="text-green-600">✓</span>}
                {isIncomplete && !isCurrent && <span className="text-amber-500" title="לא הושלם">⚠</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}