import React from "react";

export default function ProgressBar({ current, total }) {
  const percent = Math.round((current / total) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>שלב {current + 1} מתוך {total}</span>
        <span>{percent}% הושלם</span>
      </div>
      <div className="bg-muted rounded-full h-2">
        <div
          className="bg-primary h-2 rounded-full transition-all duration-500"
          style={{ width: `${Math.max(5, percent)}%` }}
        />
      </div>
    </div>
  );
}