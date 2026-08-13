import React, { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Users, Mail, Trash2 } from "lucide-react";

export default function TeamSection() {
  const [teamMembers, setTeamMembers] = useState([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    loadTeamData();
  }, []);

  const loadTeamData = async () => {
    setLoading(true);
    try {
      const user = await base44.auth.me();
      setCurrentUser(user);
      const users = await base44.entities.User.list();
      const teamUsers = users.filter((u) => u.role === "admin");
      setTeamMembers(teamUsers);
    } catch (err) {
      console.error("Error loading team:", err);
    }
    setLoading(false);
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setInviting(true);
    try {
      await base44.users.inviteUser(inviteEmail, "admin");
      toast({ title: "הזמנה נשלחה", description: `הזמנה נשלחה אל ${inviteEmail}` });
      setInviteEmail("");
      loadTeamData();
    } catch (err) {
      toast({ title: "שגיאה", description: err.message, variant: "destructive" });
    }
    setInviting(false);
  };



  if (loading) {
    return (
      <div className="bg-white rounded-2xl p-6 border border-border">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-muted rounded w-1/3" />
          <div className="h-10 bg-muted rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl p-6 border border-border space-y-5">
      <div className="flex items-center gap-2">
        <Users className="w-5 h-5 text-primary" />
        <h2 className="font-bold text-foreground text-lg">צוות</h2>
      </div>

      {/* Invite form */}
      <form onSubmit={handleInvite} className="space-y-3 pb-5 border-b border-border">
        <label className="text-sm font-medium text-foreground block">הזמן רואה חשבון</label>
        <p className="text-xs text-muted-foreground mb-3">הוא יקבל הזמנה במייל שלו עם לינק הצטרפות</p>
        <div className="flex gap-2">
          <Input
            type="email"
            placeholder="example@email.com"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="rounded-xl border-border flex-1"
          />
          <Button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            className="bg-primary hover:bg-primary/90 text-white rounded-xl"
          >
            {inviting ? "שולח..." : "הזמן"}
          </Button>
        </div>
      </form>

      {/* Team members list */}
      <div>
        <h3 className="text-sm font-semibold text-foreground mb-3">חברי צוות ({teamMembers.length})</h3>
        {teamMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">עדיין אין חברי צוות. הזמן את הרואה החשבון שלך!</p>
        ) : (
          <div className="space-y-2">
            {teamMembers.map((member) => (
              <div key={member.id} className="flex items-center justify-between p-3 bg-muted/50 rounded-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <Mail className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{member.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                  </div>
                </div>
                {currentUser?.role === "admin" && member.id !== currentUser.id && (
                  <button className="text-destructive hover:text-destructive/80 p-1 flex-shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}