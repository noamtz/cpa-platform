import React, { useState } from "react";
import { UserCheck } from "lucide-react";

/**
 * Shows a small "filled by CPA" badge under a step item.
 * Clicking it expands to show audit details.
 */
export default function CpaAuditBadge({ auditEntries }) {
  const [expanded, setExpanded] = useState(false);

  if (!auditEntries || auditEntries.length === 0) return null;

  const latest = auditEntries[auditEntries.length - 1];
  const date = new Date(latest.timestamp).toLocaleDateString("he-IL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="mt-1">
      <button
        onClick={(e) => { e.stopPropagation(); setExpanded((v) => !v); }}
        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
        title='מולא ע"י רו"ח'
      >
        <UserCheck className="w-3 h-3" />
        מולא ע"י רו"ח
      </button>
      {expanded && (
        <div className="mt-1 bg-purple-50 border border-purple-200 rounded-lg px-2 py-1.5 text-xs text-purple-800 space-y-0.5">
          {auditEntries.map((entry, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <span className="font-medium">{entry.cpa_name || entry.cpa_email}</span>
              <span className="text-purple-500">·</span>
              <span className="text-purple-600">
                {new Date(entry.timestamp).toLocaleDateString("he-IL", {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}