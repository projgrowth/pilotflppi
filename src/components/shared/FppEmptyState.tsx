import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface FppEmptyStateProps {
  icon: LucideIcon;
  headline: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export default function FppEmptyState({ icon: Icon, headline, body, ctaLabel, onCta }: FppEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-12 w-12 text-fpp-gray-400 mb-4" />
      <h3 className="text-2xl font-semibold text-foreground mb-2">{headline}</h3>
      <p className="text-sm text-fpp-gray-600 max-w-md">{body}</p>
      {ctaLabel && onCta && (
        <Button onClick={onCta} className="mt-6">
          {ctaLabel}
        </Button>
      )}
    </div>
  );
}
