/**
 * RecordDeliveryDialog — captures HOW and WHEN a comment letter snapshot was
 * actually delivered to the contractor / AHJ. Phase 3 of the audit added the
 * delivery_* columns; before this, "sent" only meant "snapshotted in our DB".
 * Florida statutes care about the date the AHJ / contractor was put on notice
 * — that's what we record here.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAhjRecipients, useUpsertAhjRecipient } from "@/hooks/useAhjRecipients";

type DeliveryMethod =
  | "email"
  | "portal"
  | "hand_delivered"
  | "certified_mail"
  | "fax"
  | "other";

interface Props {
  snapshotId: string | null;
  planReviewId: string;
  defaultRecipient?: string;
  /** Jurisdiction string used to scope AHJ address-book autocomplete. */
  jurisdiction?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RecordDeliveryDialog({
  snapshotId,
  planReviewId,
  defaultRecipient,
  jurisdiction,
  open,
  onOpenChange,
}: Props) {
  const qc = useQueryClient();
  const [method, setMethod] = useState<DeliveryMethod>("email");
  const [deliveredAt, setDeliveredAt] = useState<string>(() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16); // local datetime-local format
  });
  const [confirmation, setConfirmation] = useState("");
  const [notes, setNotes] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [contactName, setContactName] = useState("");

  const { data: ahjOptions = [] } = useAhjRecipients(jurisdiction);
  const upsertAhj = useUpsertAhjRecipient();

  const applySuggestion = (id: string) => {
    const hit = ahjOptions.find((r) => r.id === id);
    if (!hit) return;
    if (hit.email) setRecipientEmail(hit.email);
    if (hit.contact_name) setContactName(hit.contact_name);
  };

  const save = useMutation({
    mutationFn: async () => {
      if (!snapshotId) throw new Error("No snapshot selected");
      const { error } = await supabase
        .from("comment_letter_snapshots")
        .update({
          delivery_method: method,
          delivered_at: new Date(deliveredAt).toISOString(),
          delivery_confirmation: confirmation.slice(0, 500) || null,
          delivery_notes: notes.slice(0, 2000) || null,
        })
        .eq("id", snapshotId);
      if (error) throw error;

      // Persist to AHJ address book for future autocomplete (best-effort).
      if (jurisdiction && (recipientEmail.trim() || contactName.trim())) {
        try {
          await upsertAhj.mutateAsync({
            jurisdiction,
            email: recipientEmail.trim() || null,
            contact_name: contactName.trim() || null,
          });
        } catch {
          /* non-blocking */
        }
      }
    },
    onSuccess: () => {
      toast.success("Delivery recorded");
      qc.invalidateQueries({ queryKey: ["letter_snapshots", planReviewId] });
      onOpenChange(false);
    },
    onError: (e) =>
      toast.error(
        `Failed to record delivery: ${e instanceof Error ? e.message : String(e)}`,
      ),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Record letter delivery</DialogTitle>
          <DialogDescription>
            Capture how and when this letter was delivered
            {defaultRecipient ? ` to ${defaultRecipient}` : ""}. This is the
            date the statutory notice clock acknowledges.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          {ahjOptions.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="ahj_pick" className="text-xs">
                AHJ contact (autocomplete from your address book{jurisdiction ? ` for ${jurisdiction}` : ""})
              </Label>
              <Select onValueChange={applySuggestion}>
                <SelectTrigger id="ahj_pick" className="h-9">
                  <SelectValue placeholder="Pick a saved contact…" />
                </SelectTrigger>
                <SelectContent>
                  {ahjOptions.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {[r.contact_name, r.email, r.department].filter(Boolean).join(" · ") || r.jurisdiction}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="contact_name" className="text-xs">Contact name</Label>
              <Input
                id="contact_name"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                maxLength={200}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact_email" className="text-xs">Contact email</Label>
              <Input
                id="contact_email"
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                maxLength={200}
                className="h-9"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="method">Delivery method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as DeliveryMethod)}>
              <SelectTrigger id="method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="portal">AHJ portal upload</SelectItem>
                <SelectItem value="certified_mail">Certified mail</SelectItem>
                <SelectItem value="hand_delivered">Hand delivered</SelectItem>
                <SelectItem value="fax">Fax</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="delivered_at">Delivered at</Label>
            <Input
              id="delivered_at"
              type="datetime-local"
              value={deliveredAt}
              onChange={(e) => setDeliveredAt(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="confirmation">
              Confirmation reference (optional)
            </Label>
            <Input
              id="confirmation"
              placeholder="Tracking #, message-id, portal ticket…"
              maxLength={500}
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="notes">Notes (optional)</Label>
            <Textarea
              id="notes"
              rows={2}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => save.mutate()}
            disabled={save.isPending || !snapshotId}
          >
            {save.isPending ? "Saving…" : "Record delivery"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
