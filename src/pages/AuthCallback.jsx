import React, { useEffect, useState } from "react";
import { cognitoAuth } from "@/api/cognito-auth";

export default function AuthCallback() {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    cognitoAuth.completeCallback().catch(() => setFailed(true));
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      {failed ? (
        <div className="text-center space-y-3" dir="rtl">
          <p className="text-sm text-destructive">ההתחברות נכשלה. נסו להתחבר מחדש.</p>
          <button
            type="button"
            className="text-sm text-primary underline"
            onClick={() => window.location.replace("/")}
          >
            חזרה לדף הבית
          </button>
        </div>
      ) : (
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  );
}
